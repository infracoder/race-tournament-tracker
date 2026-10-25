const { randomUUID } = require('node:crypto');
const { LETTERS, generateChampionshipSchedule } = require('./championship-schedule');
const { scoreIndividual, scoreTeam, calculateStandings, POINTS_SCALE } = require('./championship-scoring');

function requireRule(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function createChampionshipService(database) {
  const activeId = async tx => (await tx.get('SELECT championship_id FROM championship_app_state WHERE id = 1'))?.championship_id || null;

  async function snapshot(tx, id) {
    if (!id) return { initialized: false, score_scale: POINTS_SCALE };
    const championship = await tx.get(`SELECT id, title, seed, status, paused, cursor, revision,
      winner_id, winner_source, created_at, completed_at FROM championships WHERE id = ?`, [id]);
    requireRule(championship, 'Tournament not found.', 404);
    championship.paused = Boolean(championship.paused);
    const players = await tx.all('SELECT id, letter, name FROM championship_players WHERE championship_id = ? ORDER BY letter', [id]);
    const slots = await tx.all('SELECT id, position, category FROM event_slots WHERE championship_id = ? ORDER BY position', [id]);
    const participants = await tx.all('SELECT slot_id, player_id, controller, side FROM slot_participants WHERE championship_id = ? ORDER BY controller', [id]);
    const rounds = await tx.all('SELECT id, slot_id, mode, round_order, completed, winning_side FROM event_rounds WHERE championship_id = ? ORDER BY round_order', [id]);
    const results = await tx.all('SELECT round_id, player_id, rank, score_units FROM round_results WHERE championship_id = ? ORDER BY rank, player_id', [id]);
    const playerById = new Map(players.map(p => [p.id, p]));
    for (const slot of slots) {
      slot.participants = participants.filter(p => p.slot_id === slot.id).map(p => ({
        player_id: p.player_id, controller: p.controller, side: p.side,
        name: playerById.get(p.player_id).name, letter: playerById.get(p.player_id).letter
      }));
      slot.rounds = rounds.filter(r => r.slot_id === slot.id).map(r => ({
        id: r.id, mode: r.mode, order: r.round_order, completed: Boolean(r.completed), winning_side: r.winning_side,
        results: results.filter(result => result.round_id === r.id).map(({ player_id, rank, score_units }) => ({ player_id, rank, score_units }))
      }));
      slot.completed = slot.rounds.length > 0 && slot.rounds.every(r => r.completed);
    }
    const standings = calculateStandings(players.filter(p => p.name !== null), slots);
    const active_slot = championship.status === 'running' ? slots.find(s => s.position === championship.cursor) || null : null;
    return {
      initialized: true, championship, revision: championship.revision, players, slots, standings,
      score_scale: POINTS_SCALE, registered: players.filter(p => p.name !== null).length,
      active_slot, active_round: active_slot?.rounds.find(r => !r.completed) || null,
      up_next: championship.status === 'registration' ? slots[0] : championship.status === 'running' ? slots.find(s => s.position === championship.cursor + 1) || null : null,
      slots_completed: slots.filter(s => s.completed).length,
      rounds_completed: slots.flatMap(s => s.rounds).filter(r => r.completed).length,
      winner: championship.status === 'completed' ? standings.find(p => p.id === championship.winner_id) || null : null
    };
  }

  async function current() {
    return database.readTransaction(async tx => snapshot(tx, await activeId(tx)));
  }

  async function mutate(id, expectedRevision, action) {
    return database.transaction(async tx => {
      requireRule(await activeId(tx) === id, 'This tournament has changed. Refresh before continuing.', 409);
      const state = await snapshot(tx, id);
      requireRule(Number.isSafeInteger(expectedRevision), 'An observed tournament revision is required.');
      requireRule(state.revision === expectedRevision, 'The tournament changed while you were editing. Review the latest results.', 409);
      const changed = await action(tx, state);
      if (changed !== false) await tx.run('UPDATE championships SET revision = revision + 1 WHERE id = ?', [id]);
      return snapshot(tx, id);
    });
  }

  async function create({ expectedActiveId, seed = randomUUID() }) {
    requireRule(typeof seed === 'string' && seed.length > 0, 'Invalid schedule seed.');
    const generated = generateChampionshipSchedule(seed);
    return database.transaction(async tx => {
      requireRule(expectedActiveId === await activeId(tx), 'Another tournament is now active. Refresh before creating one.', 409);
      const id = randomUUID();
      await tx.run('INSERT INTO championships (id, title, seed) VALUES (?, ?, ?)', [id, 'Tolsma 3rd Annual Mario Kart Tournament', generated.seed]);
      for (const letter of LETTERS) await tx.run('INSERT INTO championship_players (championship_id, id, letter) VALUES (?, ?, ?)', [id, letter, letter]);
      for (const slot of generated.slots) {
        await tx.run('INSERT INTO event_slots (championship_id, id, position, category) VALUES (?, ?, ?, ?)', [id, slot.id, slot.position, slot.category]);
        for (const p of slot.participants) await tx.run('INSERT INTO slot_participants (championship_id, slot_id, player_id, controller, side) VALUES (?, ?, ?, ?, ?)', [id, slot.id, p.player_id, p.controller, p.side]);
        for (const round of slot.rounds) await tx.run('INSERT INTO event_rounds (championship_id, id, slot_id, mode, round_order) VALUES (?, ?, ?, ?, ?)', [id, round.id, slot.id, round.mode, round.order]);
      }
      await tx.run('UPDATE championship_app_state SET championship_id = ? WHERE id = 1', [id]);
      return snapshot(tx, id);
    });
  }

  async function register(id, { name, registrationToken }) {
    requireRule(typeof name === 'string' && name.trim().length > 0, 'Please enter your name.');
    requireRule(typeof registrationToken === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(registrationToken), 'Invalid registration request.');
    return database.transaction(async tx => {
      requireRule(await activeId(tx) === id, 'A different tournament is active. Use its join link.', 409);
      let player = await tx.get('SELECT id, letter, name FROM championship_players WHERE championship_id = ? AND registration_token = ?', [id, registrationToken]);
      if (!player) {
        const event = await tx.get('SELECT status FROM championships WHERE id = ?', [id]);
        requireRule(event?.status === 'registration', 'Registration is closed. Select your existing name instead.', 409);
        player = await tx.get('SELECT id, letter FROM championship_players WHERE championship_id = ? AND name IS NULL ORDER BY letter LIMIT 1', [id]);
        requireRule(player, 'All nine player spots are filled. Select your existing name instead.', 409);
        await tx.run('UPDATE championship_players SET name = ?, registration_token = ? WHERE championship_id = ? AND id = ?', [name.trim(), registrationToken, id, player.id]);
        await tx.run('UPDATE championships SET revision = revision + 1 WHERE id = ?', [id]);
        player.name = name.trim();
      }
      return { player, snapshot: await snapshot(tx, id) };
    });
  }

  const start = (id, body) => mutate(id, body.expectedRevision, async (tx, state) => {
    requireRule(state.championship.status === 'registration', 'This tournament has already started.', 409);
    requireRule(state.registered === 9, 'All nine players must register before play starts.', 409);
    await tx.run("UPDATE championships SET status = 'running', cursor = 1, paused = 0 WHERE id = ?", [id]);
  });

  const saveResult = (id, roundId, body) => mutate(id, body.expectedRevision, async (tx, state) => {
    const slot = state.slots.find(s => s.rounds.some(r => r.id === roundId));
    const round = slot?.rounds.find(r => r.id === roundId);
    requireRule(round, 'Round not found.', 404);
    requireRule(round.completed || state.active_round?.id === roundId, 'Enter the current round or correct a saved result.', 409);
    let scored;
    try {
      scored = round.mode === 'renegade' ? scoreTeam(slot.participants, body.winningSide) : scoreIndividual(body.groups, round.mode !== 'race');
    } catch (error) { throw Object.assign(error, { status: 400 }); }
    requireRule(scored.map(r => r.player_id).sort().join(',') === slot.participants.map(p => p.player_id).sort().join(','), 'Results must include exactly the four scheduled players.');
    const canonical = list => JSON.stringify([...list].sort((a, b) => a.player_id.localeCompare(b.player_id)));
    if (round.completed && canonical(round.results) === canonical(scored)) return false;
    await tx.run('DELETE FROM round_results WHERE championship_id = ? AND round_id = ?', [id, roundId]);
    for (const r of scored) await tx.run('INSERT INTO round_results (championship_id, round_id, slot_id, player_id, rank, score_units) VALUES (?, ?, ?, ?, ?, ?)', [id, roundId, slot.id, r.player_id, r.rank, r.score_units]);
    await tx.run('UPDATE event_rounds SET completed = 1, winning_side = ? WHERE championship_id = ? AND id = ?', [round.mode === 'renegade' ? body.winningSide : null, id, roundId]);
    if (state.championship.status === 'completed') await tx.run("UPDATE championships SET status = 'awaiting_champion', winner_id = NULL, winner_source = NULL, completed_at = NULL WHERE id = ?", [id]);
  });

  const advance = (id, body) => mutate(id, body.expectedRevision, async (tx, state) => {
    requireRule(state.championship.status === 'running' && !state.championship.paused, 'Resume play before advancing.', 409);
    requireRule(state.active_slot?.completed, 'Save all results for this event before advancing.', 409);
    const cursor = state.championship.cursor + 1;
    await tx.run('UPDATE championships SET cursor = ?, status = ? WHERE id = ?', [cursor, cursor > state.slots.length ? 'awaiting_champion' : 'running', id]);
  });

  const pause = (id, body) => mutate(id, body.expectedRevision, async (tx, state) => {
    requireRule(typeof body.paused === 'boolean', 'Specify whether play is paused.');
    requireRule(state.championship.status === 'running', 'Play is not in progress.', 409);
    if (state.championship.paused === body.paused) return false;
    await tx.run('UPDATE championships SET paused = ? WHERE id = ?', [body.paused ? 1 : 0, id]);
  });

  const complete = (id, body) => mutate(id, body.expectedRevision, async (tx, state) => {
    if (state.championship.status === 'completed') return false;
    requireRule(state.championship.status === 'awaiting_champion' && state.slots_completed === 27, 'Finish every event before completing the tournament.', 409);
    const leaders = state.standings.filter(p => p.rank === 1);
    const winner = leaders.length === 1 ? leaders[0] : leaders.find(p => p.id === body.playoffWinnerId);
    requireRule(winner, 'First place is tied. Record the winner of your playoff.', 409);
    requireRule(!body.playoffWinnerId || body.playoffWinnerId === winner.id, 'The selected winner must be a tied points leader.');
    await tx.run("UPDATE championships SET status = 'completed', winner_id = ?, winner_source = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [winner.id, leaders.length === 1 ? 'points' : 'playoff', id]);
  });

  return { current, create, register, start, saveResult, advance, pause, complete };
}

module.exports = { createChampionshipService };
