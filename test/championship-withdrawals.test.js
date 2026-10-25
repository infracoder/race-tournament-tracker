const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../database');
const { createApp } = require('../app');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-withdrawal-test-'));
  const database = createDatabase(path.join(dir, 'test.db'));
  await database.initializeSchema();
  const server = createApp({ database, organizerPin: 'withdrawal-test-pin' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function call(route, body, { token, host = true, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(host && cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (route === '/api/organizer/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : { error: 'Non-JSON response' } };
  }
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await database.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await call('/api/organizer/login', { pin: 'withdrawal-test-pin' });
  let state = (await call('/api/championship', { expectedActiveId: null, seed: 'withdrawals-10' })).body;
  const id = state.championship.id;
  const tokens = {};
  for (let i = 0; i < 9; i++) {
    const token = `withdrawal-player-token-${i}`;
    const joined = await call(`/api/championship/${id}/players`, { name: `Player ${i + 1}`, registrationToken: token }, { host: false });
    tokens[joined.body.player.id] = token;
    state = joined.body.snapshot;
  }
  const withdraw = (playerId, snapshot = state, token = tokens[playerId]) => call(`/api/championship/${id}/players/${playerId}/withdraw`, { expectedRevision: snapshot.revision }, { token, host: false });
  return { call, database, filename: path.join(dir, 'test.db'), id, tokens, state, withdraw };
}

async function save(call, id, state, groups) {
  const round = state.active_round;
  const active = state.active_slot.participants.filter(p => !p.withdrawn_at);
  const result = await call(`/api/championship/${id}/rounds/${round.id}/result`, {
    expectedRevision: state.revision,
    ...(round.mode === 'renegade' ? { winningSide: active.some(p => p.side === 'cops') ? 'cops' : 'robbers' } : { groups: groups || active.map(p => p.player_id).sort().map(id => [id]) })
  }, { method: 'PUT' });
  assert.equal(result.status, 200, result.body.error);
  return result.body;
}

async function finish(call, id, state) {
  while (state.championship.status === 'running') {
    if (state.active_round) state = await save(call, id, state);
    else {
      const advanced = await call(`/api/championship/${id}/advance`, { expectedRevision: state.revision });
      assert.equal(advanced.status, 200, advanced.body.error);
      state = advanced.body;
    }
  }
  return state;
}

async function configure(call, id, state) {
  const result = await call(`/api/championship/${id}/prizes`, {
    expectedRevision: state.revision, enabled: true, currency: 'CAD',
    tiers: { first: 10000, second: 7500, third: 5000, participation: 1700 }, vendors: [{ name: 'Game shop' }]
  }, { method: 'PUT' });
  assert.equal(result.status, 200);
  return result.body;
}

async function complete(call, id, state) {
  const settings = (await call(`/api/championship/${id}/prizes`)).body;
  const prizePlayoffs = Object.fromEntries(settings.playoffs.map(group => [group.rank, group.places.map((_, index) => group.players[index].id)]));
  const completed = await call(`/api/championship/${id}/complete`, {
    expectedRevision: state.revision,
    ...(state.standings.some(p => p.rank === 1) ? { playoffWinnerId: state.standings.find(p => p.rank === 1).id } : {}),
    prizePlayoffs
  });
  assert.equal(completed.status, 200, completed.body.error);
  return completed.body;
}

test('withdrawal belongs to the registered phone, retains its seat, and is retry safe and persistent', async t => {
  const { call, database, id, tokens, state, withdraw } = await fixture(t);
  assert.equal((await withdraw('A', state, '')).status, 401);
  assert.equal((await withdraw('B', state, tokens.A)).status, 403);
  assert.equal((await withdraw('A', { revision: state.revision - 1 })).status, 409);
  const result = await withdraw('A');
  assert.equal(result.status, 200);
  const player = result.body.players.find(p => p.id === 'A');
  assert.ok(player.withdrawn_at);
  assert.equal(result.body.registered, 9);
  assert.equal(result.body.standings.find(p => p.id === 'A').rank, null);
  assert.deepEqual(result.body.slots.map(s => s.participants.map(p => p.player_id)), state.slots.map(s => s.participants.map(p => p.player_id)));
  const retried = await withdraw('A');
  assert.equal(retried.status, 200);
  assert.equal(retried.body.revision, result.body.revision);
  assert.equal(JSON.stringify(retried.body).includes(tokens.A), false);
  const joined = await call(`/api/championship/${id}/players`, { name: 'Other name', registrationToken: tokens.A }, { host: false });
  assert.equal(joined.body.player.id, 'A');
  assert.equal(joined.body.player.withdrawn_at, player.withdrawn_at);
  await database.initializeSchema();
  await database.initializeSchema();
  assert.equal((await call('/api/championship/current')).body.players.find(p => p.id === 'A').withdrawn_at, player.withdrawn_at);
  assert.equal((await call(`/api/championship/${id}/start`, { expectedRevision: result.body.revision })).status, 200);
});

test('withdrawn leaders keep earned points and first completion permanently closes withdrawal', async t => {
  const { call, database, filename, id, tokens, state: initial, withdraw } = await fixture(t);
  let state = await configure(call, id, initial);
  state = (await call(`/api/championship/${id}/start`, { expectedRevision: state.revision })).body;
  const first = state.active_slot;
  const victim = first.participants[0].player_id;
  const originalGroups = first.participants.map(p => [p.player_id]);
  state = await save(call, id, state, originalGroups);
  state = (await withdraw(victim, state)).body;
  assert.equal(state.standings.find(p => p.id === victim).total_units, 300);
  assert.equal(state.standings.find(p => p.id === victim).rank, null);
  const prizePath = `/api/championship/${id}/players/${victim}/prize`;
  const locked = await call(prizePath, undefined, { host: false, token: tokens[victim] });
  assert.equal(locked.body.locked, true);
  assert.equal('award' in locked.body, false);
  state = await finish(call, id, state);
  for (const slot of state.slots.slice(1)) {
    for (const round of slot.rounds) assert.equal(round.results.some(r => r.player_id === victim), false);
  }
  assert.equal(state.championship.first_completed_at, null);
  const lastEligible = state.standings.filter(p => !p.withdrawn_at).at(-1);
  const beforeCompletion = await withdraw(lastEligible.id, state);
  assert.equal(beforeCompletion.status, 200, 'Withdrawal stays open until the first successful completion');
  state = beforeCompletion.body;
  state = await complete(call, id, state);
  const firstCompletion = state.championship.first_completed_at;
  assert.equal(typeof firstCompletion, 'string');
  assert.notEqual(state.winner.id, victim);
  const award = (await call(prizePath, undefined, { host: false, token: tokens[victim] })).body;
  assert.equal(award.locked, false);
  assert.equal(award.award.kind, 'consolation');
  assert.equal(award.award.amount_cents, 1700);
  assert.equal(award.award.place, null);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards WHERE championship_id = ?', [id])).count, 9);
  assert.equal(JSON.stringify(state).includes('amount_cents'), false);
  const other = state.players.find(p => p.id !== victim);
  assert.equal((await withdraw(other.id, state)).status, 409);
  const selected = await call(`${prizePath}/vendor`, { vendorId: award.vendors[0].id, revealId: award.award.reveal_id }, { host: false, token: tokens[victim], method: 'PUT' });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.award.vendor_id, award.vendors[0].id);
  state = (await call('/api/championship/current')).body;
  const corrected = await call(`/api/championship/${id}/rounds/${first.rounds[0].id}/result`, { expectedRevision: state.revision, groups: originalGroups.toReversed() }, { method: 'PUT' });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.championship.status, 'awaiting_champion');
  assert.equal(corrected.body.slots[0].rounds[0].results.length, 4);
  assert.equal((await call(prizePath, undefined, { host: false, token: tokens[victim] })).body.locked, true);
  assert.equal(corrected.body.championship.first_completed_at, firstCompletion);
  assert.equal((await withdraw(other.id, corrected.body)).status, 409);
  const prizeChange = await configure(call, id, corrected.body);
  assert.equal(prizeChange.championship.first_completed_at, firstCompletion);
  assert.equal((await withdraw(other.id, prizeChange)).status, 409);
  const restarted = createDatabase(filename);
  try {
    await restarted.initializeSchema();
    assert.equal((await restarted.get('SELECT first_completed_at FROM championships WHERE id = ?', [id])).first_completed_at, firstCompletion);
  } finally { await restarted.close(); }
  state = await complete(call, id, prizeChange);
  assert.equal(state.championship.first_completed_at, firstCompletion);
  const replacement = await call('/api/championship', { expectedActiveId: id, seed: 'fresh-after-completion' });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.body.championship.first_completed_at, null);
});

test('withdrawal between solo rounds preserves the first round and awards no second-round points', async t => {
  const { call, id, state: initial, withdraw } = await fixture(t);
  let state = (await call(`/api/championship/${id}/start`, { expectedRevision: initial.revision })).body;
  state = await save(call, id, state);
  state = (await call(`/api/championship/${id}/advance`, { expectedRevision: state.revision })).body;
  assert.equal(state.active_round.mode, 'balloon');
  const victim = state.active_slot.participants[0].player_id;
  const before = state.standings.find(p => p.id === victim).total_units;
  state = await save(call, id, state, state.active_slot.participants.map(p => [p.player_id]));
  state = (await withdraw(victim, state)).body;
  state = await save(call, id, state);
  assert.equal(state.standings.find(p => p.id === victim).total_units, before + 150);
  assert.equal(state.active_slot.rounds[0].results.length, 4);
  assert.equal(state.active_slot.rounds[1].results.length, 3);
  assert.deepEqual(state.active_slot.rounds[1].results.map(r => r.score_units).sort((a, b) => b - a), [300, 216, 180]);
});

test('empty sides forfeit and an entirely withdrawn tournament can finish with consolation prizes', async t => {
  const { call, database, id, state: initial, withdraw } = await fixture(t);
  let state = await configure(call, id, initial);
  state = (await call(`/api/championship/${id}/start`, { expectedRevision: state.revision })).body;
  const team = state.slots.find(s => s.category === 'team');
  for (const member of team.participants.filter(p => p.side === 'cops')) state = (await withdraw(member.player_id, state)).body;
  while (state.active_slot.id !== team.id) {
    if (state.active_round) state = await save(call, id, state);
    else state = (await call(`/api/championship/${id}/advance`, { expectedRevision: state.revision })).body;
  }
  const emptyWin = await call(`/api/championship/${id}/rounds/${state.active_round.id}/result`, { expectedRevision: state.revision, winningSide: 'cops' }, { method: 'PUT' });
  assert.equal(emptyWin.status, 400);
  state = await save(call, id, state);
  assert.deepEqual(state.active_slot.rounds[0].results.map(r => r.score_units), [300, 300]);
  const pausedCursor = state.championship.cursor;
  state = (await call(`/api/championship/${id}/pause`, { expectedRevision: state.revision, paused: true }, { method: 'PUT' })).body;
  for (const player of state.players.filter(p => !p.withdrawn_at)) {
    const result = await withdraw(player.id, state);
    assert.equal(result.status, 200, result.body.error);
    state = result.body;
  }
  assert.equal(state.championship.status, 'running', 'Withdrawal must preserve the paused queue');
  assert.equal(state.championship.cursor, pausedCursor);
  state = (await call(`/api/championship/${id}/pause`, { expectedRevision: state.revision, paused: false }, { method: 'PUT' })).body;
  assert.equal(state.championship.status, 'awaiting_champion');
  assert.equal(state.championship.paused, false);
  assert.equal(state.slots_completed, 27);
  assert.equal(state.rounds_completed, 36);
  assert.ok(state.slots.some(s => s.rounds.some(r => r.skipped)));
  assert.ok(state.standings.every(p => p.rank === null));
  state = await complete(call, id, state);
  assert.equal(state.winner, null);
  assert.equal(state.championship.status, 'completed');
  const awards = await database.all('SELECT kind, amount_cents FROM championship_prize_awards WHERE championship_id = ?', [id]);
  assert.equal(awards.length, 9);
  assert.ok(awards.every(a => a.kind === 'consolation' && a.amount_cents === 1700));
  assert.deepEqual(await database.all('PRAGMA foreign_key_check'), []);
});

test('upgrading a populated championship preserves registrations and existing prize awards', async t => {
  const { call, database, id, tokens } = await fixture(t);
  await database.run("INSERT INTO championship_prize_awards (championship_id, player_id, place, amount_cents, currency, reveal_id) VALUES (?, 'A', 1, 10000, 'CAD', 'existing-reveal')", [id]);
  const players = await database.all('SELECT id, name, registration_token FROM championship_players WHERE championship_id = ? ORDER BY id', [id]);
  const awards = await database.all('SELECT player_id, place, amount_cents, currency, reveal_id FROM championship_prize_awards WHERE championship_id = ?', [id]);
  await database.run('ALTER TABLE championship_players DROP COLUMN withdrawn_at');
  await database.run('ALTER TABLE championship_prize_awards DROP COLUMN kind');
  await database.initializeSchema();
  await database.initializeSchema();
  assert.deepEqual(await database.all('SELECT id, name, registration_token FROM championship_players WHERE championship_id = ? ORDER BY id', [id]), players);
  assert.deepEqual(await database.all('SELECT player_id, place, amount_cents, currency, reveal_id FROM championship_prize_awards WHERE championship_id = ?', [id]), awards);
  assert.equal((await database.get('SELECT kind FROM championship_prize_awards WHERE championship_id = ?', [id])).kind, 'placement');
  assert.ok((await call('/api/championship/current')).body.players.every(p => p.withdrawn_at === null));
  const membership = await call(`/api/championship/${id}/players/A/membership`, undefined, { host: false, token: tokens.A });
  assert.equal(membership.status, 200);
  assert.equal(membership.body.player.id, 'A');
  assert.equal(JSON.stringify(membership.body).includes(tokens.A), false);
});

test('upgrading closes withdrawals for existing completed tournaments without closing uncompleted events', async t => {
  const { call, database, id, state, withdraw } = await fixture(t);
  const completedAt = '2026-10-01 12:00:00';
  await database.run("INSERT INTO championships (id, title, seed, status, completed_at) VALUES ('old-completed', 'Old tournament', 'old', 'completed', ?)", [completedAt]);
  const columns = await database.all('PRAGMA table_info(championships)');
  if (columns.some(c => c.name === 'first_completed_at'))
    await database.run('ALTER TABLE championships DROP COLUMN first_completed_at');
  await database.initializeSchema();
  await database.initializeSchema();
  assert.equal((await database.get("SELECT first_completed_at FROM championships WHERE id = 'old-completed'")).first_completed_at, completedAt);
  assert.equal((await call('/api/championship/current')).body.championship.first_completed_at, null);
  const withdrawn = await withdraw('A', state);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.championship.id, id);
});

test('the last solo participants withdrawing skips Coin Runners without losing Balloon Battle points', async t => {
  const { call, id, state: initial, withdraw } = await fixture(t);
  let state = (await call(`/api/championship/${id}/start`, { expectedRevision: initial.revision })).body;
  state = await save(call, id, state);
  state = (await call(`/api/championship/${id}/advance`, { expectedRevision: state.revision })).body;
  const solo = state.active_slot;
  const members = solo.participants.map(p => p.player_id);
  const before = members.map(id => state.standings.find(p => p.id === id).total_units);
  state = await save(call, id, state, members.map(id => [id]));
  for (const member of members) {
    const result = await withdraw(member, state);
    assert.equal(result.status, 200);
    state = result.body;
  }
  const saved = state.slots.find(s => s.id === solo.id);
  assert.equal(saved.rounds[0].results.length, 4);
  assert.equal(saved.rounds[1].skipped, true);
  assert.equal(state.championship.cursor, solo.position + 1);
  for (const [index, id] of members.entries())
    assert.equal(state.standings.find(p => p.id === id).total_units, before[index] + [150, 108, 90, 72][index]);
});

test('a reduced race rejects a withdrawn player and accepts exactly the remaining finishers', async t => {
  const { call, id, state: initial, withdraw } = await fixture(t);
  let state = (await call(`/api/championship/${id}/start`, { expectedRevision: initial.revision })).body;
  const original = state.active_slot.participants.map(p => [p.player_id]);
  const removed = original[0][0];
  state = (await withdraw(removed, state)).body;
  const rejected = await call(`/api/championship/${id}/rounds/${state.active_round.id}/result`, { expectedRevision: state.revision, groups: original }, { method: 'PUT' });
  assert.equal(rejected.status, 400);
  assert.equal((await call('/api/championship/current')).body.revision, state.revision);
  state = await save(call, id, state, original.slice(1));
  assert.deepEqual(state.active_slot.rounds[0].results.map(r => r.score_units), [300, 216, 180]);
  assert.equal(state.standings.find(p => p.id === removed).total_units, 0);
});

test('with prizes disabled an all-withdrawn event completes without issuing awards', async t => {
  const { call, database, id, tokens, state: initial, withdraw } = await fixture(t);
  let state = initial;
  for (const player of state.players) state = (await withdraw(player.id, state)).body;
  state = (await call(`/api/championship/${id}/start`, { expectedRevision: state.revision })).body;
  assert.equal(state.championship.status, 'awaiting_champion');
  state = await complete(call, id, state);
  assert.equal(state.winner, null);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards WHERE championship_id = ?', [id])).count, 0);
  const prize = (await call(`/api/championship/${id}/players/A/prize`, undefined, { host: false, token: tokens.A })).body;
  assert.equal(prize.locked, true);
  assert.match(prize.message, /not enabled/);
});
