const { randomUUID } = require('node:crypto');
const { LETTERS, generateChampionshipSchedule } = require('./championship-schedule');
const { scoreIndividual, scoreTeam, calculateStandings, POINTS_SCALE } = require('./championship-scoring');
const {
  readPrizeSettings,
  writePrizeSettings,
  validatePrizeSettings,
  validateArtwork,
  vendorArtwork,
  writePrizeAwards
} = require('./championship-prizes');

function requireRule(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function createChampionshipService(database) {
  const activeId = async (tx) =>
    (await tx.get('SELECT championship_id FROM championship_app_state WHERE id = 1'))?.championship_id ||
    null;

  async function snapshot(tx, id) {
    if (!id) return { initialized: false, score_scale: POINTS_SCALE };
    const championship = await tx.get(
      `SELECT id, title, seed, status, paused, cursor, revision,
      winner_id, winner_source, created_at, completed_at FROM championships WHERE id = ?`,
      [id]
    );
    requireRule(championship, 'Tournament not found.', 404);
    championship.paused = Boolean(championship.paused);
    const players = await tx.all(
      'SELECT id, letter, name FROM championship_players WHERE championship_id = ? ORDER BY letter',
      [id]
    );
    const slots = await tx.all(
      'SELECT id, position, category FROM event_slots WHERE championship_id = ? ORDER BY position',
      [id]
    );
    const participants = await tx.all(
      'SELECT slot_id, player_id, controller, side FROM slot_participants WHERE championship_id = ? ORDER BY controller',
      [id]
    );
    const rounds = await tx.all(
      'SELECT id, slot_id, mode, round_order, completed, winning_side FROM event_rounds WHERE championship_id = ? ORDER BY round_order',
      [id]
    );
    const results = await tx.all(
      'SELECT round_id, player_id, rank, score_units FROM round_results WHERE championship_id = ? ORDER BY rank, player_id',
      [id]
    );
    const playerById = new Map(players.map((p) => [p.id, p]));
    for (const slot of slots) {
      slot.participants = participants
        .filter((p) => p.slot_id === slot.id)
        .map((p) => ({
          player_id: p.player_id,
          controller: p.controller,
          side: p.side,
          name: playerById.get(p.player_id).name,
          letter: playerById.get(p.player_id).letter
        }));
      slot.rounds = rounds
        .filter((r) => r.slot_id === slot.id)
        .map((r) => ({
          id: r.id,
          mode: r.mode,
          order: r.round_order,
          completed: Boolean(r.completed),
          winning_side: r.winning_side,
          results: results
            .filter((result) => result.round_id === r.id)
            .map(({ player_id, rank, score_units }) => ({ player_id, rank, score_units }))
        }));
      slot.completed = slot.rounds.length > 0 && slot.rounds.every((r) => r.completed);
    }
    const standings = calculateStandings(
      players.filter((p) => p.name !== null),
      slots
    );
    const active_slot =
      championship.status === 'running'
        ? slots.find((s) => s.position === championship.cursor) || null
        : null;
    return {
      initialized: true,
      championship,
      revision: championship.revision,
      players,
      slots,
      standings,
      score_scale: POINTS_SCALE,
      registered: players.filter((p) => p.name !== null).length,
      active_slot,
      active_round: active_slot?.rounds.find((r) => !r.completed) || null,
      up_next:
        championship.status === 'registration'
          ? slots[0]
          : championship.status === 'running'
            ? slots.find((s) => s.position === championship.cursor + 1) || null
            : null,
      slots_completed: slots.filter((s) => s.completed).length,
      rounds_completed: slots.flatMap((s) => s.rounds).filter((r) => r.completed).length,
      winner:
        championship.status === 'completed'
          ? standings.find((p) => p.id === championship.winner_id) || null
          : null
    };
  }

  async function current() {
    return database.readTransaction(async (tx) => snapshot(tx, await activeId(tx)));
  }

  async function mutate(id, expectedRevision, action) {
    return database.transaction(async (tx) => {
      requireRule(
        (await activeId(tx)) === id,
        'This tournament has changed. Refresh before continuing.',
        409
      );
      const state = await snapshot(tx, id);
      requireRule(Number.isSafeInteger(expectedRevision), 'An observed tournament revision is required.');
      requireRule(
        state.revision === expectedRevision,
        'The tournament changed while you were editing. Review the latest results.',
        409
      );
      const changed = await action(tx, state);
      if (changed !== false)
        await tx.run('UPDATE championships SET revision = revision + 1 WHERE id = ?', [id]);
      return snapshot(tx, id);
    });
  }

  async function create({ expectedActiveId, seed = randomUUID() }) {
    requireRule(typeof seed === 'string' && seed.length > 0, 'Invalid schedule seed.');
    const generated = generateChampionshipSchedule(seed);
    return database.transaction(async (tx) => {
      requireRule(
        expectedActiveId === (await activeId(tx)),
        'Another tournament is now active. Refresh before creating one.',
        409
      );
      const id = randomUUID();
      await tx.run('INSERT INTO championships (id, title, seed) VALUES (?, ?, ?)', [
        id,
        'Tolsma 3rd Annual Mario Kart Tournament',
        generated.seed
      ]);
      for (const letter of LETTERS)
        await tx.run('INSERT INTO championship_players (championship_id, id, letter) VALUES (?, ?, ?)', [
          id,
          letter,
          letter
        ]);
      for (const slot of generated.slots) {
        await tx.run(
          'INSERT INTO event_slots (championship_id, id, position, category) VALUES (?, ?, ?, ?)',
          [id, slot.id, slot.position, slot.category]
        );
        for (const p of slot.participants)
          await tx.run(
            'INSERT INTO slot_participants (championship_id, slot_id, player_id, controller, side) VALUES (?, ?, ?, ?, ?)',
            [id, slot.id, p.player_id, p.controller, p.side]
          );
        for (const round of slot.rounds)
          await tx.run(
            'INSERT INTO event_rounds (championship_id, id, slot_id, mode, round_order) VALUES (?, ?, ?, ?, ?)',
            [id, round.id, slot.id, round.mode, round.order]
          );
      }
      await tx.run('UPDATE championship_app_state SET championship_id = ? WHERE id = 1', [id]);
      return snapshot(tx, id);
    });
  }

  async function register(id, { name, registrationToken }) {
    requireRule(typeof name === 'string' && name.trim().length > 0, 'Please enter your name.');
    requireRule(
      typeof registrationToken === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(registrationToken),
      'Invalid registration request.'
    );
    return database.transaction(async (tx) => {
      requireRule((await activeId(tx)) === id, 'A different tournament is active. Use its join link.', 409);
      let player = await tx.get(
        'SELECT id, letter, name FROM championship_players WHERE championship_id = ? AND registration_token = ?',
        [id, registrationToken]
      );
      if (!player) {
        const event = await tx.get('SELECT status FROM championships WHERE id = ?', [id]);
        requireRule(
          event?.status === 'registration',
          'Registration is closed. Select your existing name instead.',
          409
        );
        player = await tx.get(
          'SELECT id, letter FROM championship_players WHERE championship_id = ? AND name IS NULL ORDER BY letter LIMIT 1',
          [id]
        );
        requireRule(player, 'All nine player spots are filled. Select your existing name instead.', 409);
        await tx.run(
          'UPDATE championship_players SET name = ?, registration_token = ? WHERE championship_id = ? AND id = ?',
          [name.trim(), registrationToken, id, player.id]
        );
        await tx.run('UPDATE championships SET revision = revision + 1 WHERE id = ?', [id]);
        player.name = name.trim();
      }
      return { player, snapshot: await snapshot(tx, id) };
    });
  }

  async function requireActive(tx, id) {
    requireRule((await activeId(tx)) === id, 'This tournament is no longer active.', 409);
  }

  async function withdrawCompletion(tx, id, state) {
    await tx.run('DELETE FROM championship_prize_awards WHERE championship_id = ?', [id]);
    if (state.championship.status === 'completed')
      await tx.run(
        "UPDATE championships SET status = 'awaiting_champion', winner_id = NULL, winner_source = NULL, completed_at = NULL WHERE id = ?",
        [id]
      );
  }

  async function prizeSettings(id) {
    return database.readTransaction(async (tx) => {
      await requireActive(tx, id);
      const championship = await tx.get('SELECT revision, status FROM championships WHERE id = ?', [id]);
      const settings = await readPrizeSettings(tx, id);
      const awards = await tx.all(
        `SELECT a.player_id, p.name, a.place, a.amount_cents, a.currency, a.vendor_id, v.name AS vendor_name
        FROM championship_prize_awards a JOIN championship_players p ON p.championship_id=a.championship_id AND p.id=a.player_id
        LEFT JOIN championship_prize_vendors v ON v.championship_id=a.championship_id AND v.id=a.vendor_id
        WHERE a.championship_id = ? ORDER BY a.place, p.letter`,
        [id]
      );
      return { ...settings, revision: championship.revision, status: championship.status, awards };
    });
  }

  const configurePrizes = (id, body) => {
    const settings = validatePrizeSettings(body);
    return mutate(id, body.expectedRevision, async (tx, state) => {
      const changed = await writePrizeSettings(tx, id, settings);
      if (!changed) return false;
      await withdrawCompletion(tx, id, state);
    });
  };

  const uploadPrizeArtwork = (id, vendorId, body) => {
    const type = validateArtwork(body.bytes, body.type);
    return mutate(id, body.expectedRevision, async (tx, state) => {
      const vendor = await tx.get(
        'SELECT artwork, artwork_type FROM championship_prize_vendors WHERE championship_id = ? AND id = ?',
        [id, vendorId]
      );
      requireRule(vendor, 'Vendor not found.', 404);
      if (vendor.artwork_type === type && vendor.artwork?.equals(body.bytes)) return false;
      await tx.run(
        'UPDATE championship_prize_vendors SET artwork = ?, artwork_type = ? WHERE championship_id = ? AND id = ?',
        [body.bytes, type, id, vendorId]
      );
      await withdrawCompletion(tx, id, state);
    });
  };

  async function ownedPlayer(tx, id, playerId, token) {
    requireRule(
      typeof token === 'string' && token.length >= 16,
      'Open your private prize link or use the phone you registered with.',
      401
    );
    const player = await tx.get(
      'SELECT id, letter, name FROM championship_players WHERE championship_id = ? AND registration_token = ? AND name IS NOT NULL',
      [id, token]
    );
    requireRule(player, 'Open your private prize link or use the phone you registered with.', 401);
    requireRule(player.id === playerId, 'This private link belongs to another player.', 403);
    return player;
  }

  async function readOwnedPrize(tx, id, playerId, token) {
    await requireActive(tx, id);
    const player = await ownedPlayer(tx, id, playerId, token);
    const championship = await tx.get('SELECT title, status, revision FROM championships WHERE id = ?', [id]);
    const result = {
      player,
      championship_id: id,
      title: championship.title,
      revision: championship.revision
    };
    if (championship.status !== 'completed') return { ...result, locked: true };
    const award = await tx.get(
      'SELECT place, amount_cents, currency, reveal_id, vendor_id FROM championship_prize_awards WHERE championship_id = ? AND player_id = ?',
      [id, playerId]
    );
    if (!award)
      return {
        ...result,
        locked: true,
        message: 'Your host has not enabled gift-card prizes for this event.'
      };
    const settings = await readPrizeSettings(tx, id);
    return { ...result, locked: false, award, vendors: settings.vendors };
  }

  const playerPrize = (id, playerId, token) =>
    database.readTransaction((tx) => readOwnedPrize(tx, id, playerId, token));

  const choosePrizeVendor = (id, playerId, token, body) =>
    database.transaction(async (tx) => {
      const prize = await readOwnedPrize(tx, id, playerId, token);
      requireRule(!prize.locked, 'Your prize stays sealed until the host completes the tournament.', 409);
      requireRule(
        body?.revealId === prize.award.reveal_id,
        'Your prize has changed. Open the latest reveal before choosing a vendor.',
        409
      );
      requireRule(
        prize.vendors.some((v) => v.id === body.vendorId),
        'Choose one of the vendors offered by your host.'
      );
      if (prize.award.vendor_id !== body.vendorId) {
        await tx.run(
          'UPDATE championship_prize_awards SET vendor_id = ? WHERE championship_id = ? AND player_id = ?',
          [body.vendorId, id, playerId]
        );
        await tx.run('UPDATE championships SET revision = revision + 1 WHERE id = ?', [id]);
      }
      return readOwnedPrize(tx, id, playerId, token);
    });

  const prizeLink = (id, playerId) =>
    database.readTransaction(async (tx) => {
      await requireActive(tx, id);
      const player = await tx.get(
        'SELECT registration_token FROM championship_players WHERE championship_id = ? AND id = ? AND name IS NOT NULL',
        [id, playerId]
      );
      requireRule(player?.registration_token, 'Registered player not found.', 404);
      return {
        path: `/prize.html?t=${encodeURIComponent(id)}&id=${encodeURIComponent(playerId)}#key=${encodeURIComponent(player.registration_token)}`
      };
    });

  async function readVendorArtwork(tx, id, vendorId) {
    const vendor = await tx.get(
      'SELECT name, artwork, artwork_type FROM championship_prize_vendors WHERE championship_id = ? AND id = ?',
      [id, vendorId]
    );
    requireRule(vendor, 'Vendor not found.', 404);
    return vendorArtwork(vendor);
  }

  const organizerPrizeArtwork = (id, vendorId) =>
    database.readTransaction(async (tx) => {
      await requireActive(tx, id);
      return readVendorArtwork(tx, id, vendorId);
    });

  const playerPrizeArtwork = (id, playerId, vendorId, token) =>
    database.readTransaction(async (tx) => {
      const prize = await readOwnedPrize(tx, id, playerId, token);
      requireRule(!prize.locked, 'Your prize stays sealed until the host completes the tournament.', 409);
      return readVendorArtwork(tx, id, vendorId);
    });

  const start = (id, body) =>
    mutate(id, body.expectedRevision, async (tx, state) => {
      requireRule(state.championship.status === 'registration', 'This tournament has already started.', 409);
      requireRule(state.registered === 9, 'All nine players must register before play starts.', 409);
      await tx.run("UPDATE championships SET status = 'running', cursor = 1, paused = 0 WHERE id = ?", [id]);
    });

  const saveResult = (id, roundId, body) =>
    mutate(id, body.expectedRevision, async (tx, state) => {
      const slot = state.slots.find((s) => s.rounds.some((r) => r.id === roundId));
      const round = slot?.rounds.find((r) => r.id === roundId);
      requireRule(round, 'Round not found.', 404);
      requireRule(
        round.completed || state.active_round?.id === roundId,
        'Enter the current round or correct a saved result.',
        409
      );
      let scored;
      try {
        scored =
          round.mode === 'renegade'
            ? scoreTeam(slot.participants, body.winningSide)
            : scoreIndividual(body.groups, round.mode !== 'race');
      } catch (error) {
        throw Object.assign(error, { status: 400 });
      }
      requireRule(
        scored
          .map((r) => r.player_id)
          .sort()
          .join(',') ===
          slot.participants
            .map((p) => p.player_id)
            .sort()
            .join(','),
        'Results must include exactly the four scheduled players.'
      );
      const canonical = (list) =>
        JSON.stringify([...list].sort((a, b) => a.player_id.localeCompare(b.player_id)));
      if (round.completed && canonical(round.results) === canonical(scored)) return false;
      await tx.run('DELETE FROM round_results WHERE championship_id = ? AND round_id = ?', [id, roundId]);
      for (const r of scored)
        await tx.run(
          'INSERT INTO round_results (championship_id, round_id, slot_id, player_id, rank, score_units) VALUES (?, ?, ?, ?, ?, ?)',
          [id, roundId, slot.id, r.player_id, r.rank, r.score_units]
        );
      await tx.run(
        'UPDATE event_rounds SET completed = 1, winning_side = ? WHERE championship_id = ? AND id = ?',
        [round.mode === 'renegade' ? body.winningSide : null, id, roundId]
      );
      if (state.championship.status === 'completed') await withdrawCompletion(tx, id, state);
    });

  const advance = (id, body) =>
    mutate(id, body.expectedRevision, async (tx, state) => {
      requireRule(
        state.championship.status === 'running' && !state.championship.paused,
        'Resume play before advancing.',
        409
      );
      requireRule(state.active_slot?.completed, 'Save all results for this event before advancing.', 409);
      const cursor = state.championship.cursor + 1;
      await tx.run('UPDATE championships SET cursor = ?, status = ? WHERE id = ?', [
        cursor,
        cursor > state.slots.length ? 'awaiting_champion' : 'running',
        id
      ]);
    });

  const pause = (id, body) =>
    mutate(id, body.expectedRevision, async (tx, state) => {
      requireRule(typeof body.paused === 'boolean', 'Specify whether play is paused.');
      requireRule(state.championship.status === 'running', 'Play is not in progress.', 409);
      if (state.championship.paused === body.paused) return false;
      await tx.run('UPDATE championships SET paused = ? WHERE id = ?', [body.paused ? 1 : 0, id]);
    });

  const complete = (id, body) =>
    mutate(id, body.expectedRevision, async (tx, state) => {
      if (state.championship.status === 'completed') return false;
      requireRule(
        state.championship.status === 'awaiting_champion' && state.slots_completed === 27,
        'Finish every event before completing the tournament.',
        409
      );
      const leaders = state.standings.filter((p) => p.rank === 1);
      const winner = leaders.length === 1 ? leaders[0] : leaders.find((p) => p.id === body.playoffWinnerId);
      requireRule(winner, 'First place is tied. Record the winner of your playoff.', 409);
      requireRule(
        !body.playoffWinnerId || body.playoffWinnerId === winner.id,
        'The selected winner must be a tied points leader.'
      );
      await writePrizeAwards(tx, id, state.standings, await readPrizeSettings(tx, id));
      await tx.run(
        "UPDATE championships SET status = 'completed', winner_id = ?, winner_source = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [winner.id, leaders.length === 1 ? 'points' : 'playoff', id]
      );
    });

  return {
    current,
    create,
    register,
    start,
    saveResult,
    advance,
    pause,
    complete,
    prizeSettings,
    configurePrizes,
    uploadPrizeArtwork,
    playerPrize,
    choosePrizeVendor,
    prizeLink,
    organizerPrizeArtwork,
    playerPrizeArtwork
  };
}

module.exports = { createChampionshipService };
