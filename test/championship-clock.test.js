const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../database');
const { createChampionshipService } = require('../lib/championship-service');

test('play and event clocks persist, exclude breaks, and stop at the end of the schedule', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-clock-'));
  const filename = path.join(dir, 'event.db');
  let database = createDatabase(filename);
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await database.initializeSchema();
  let time = Date.UTC(2026, 9, 25, 18);
  let service = createChampionshipService(database, { now: () => time });
  let state = await service.create({ expectedActiveId: null, seed: 'clock-test' });
  const id = state.championship.id;
  assert.equal(state.clock, null);
  for (let i = 0; i < 9; i++) await service.register(id, { name: `Player ${i + 1}`, registrationToken: `clock-player-token-${i}` });
  state = await service.current();
  state = await service.start(id, { expectedRevision: state.revision });
  const started = time;
  assert.equal(state.clock.started_at, started);
  assert.equal(state.clock.running_since, time);
  time += 120000;
  state = await service.pause(id, { expectedRevision: state.revision, paused: true });
  assert.equal(state.clock.elapsed_ms, 120000);
  assert.equal(state.clock.event_elapsed_ms, 120000);
  assert.equal(state.clock.running_since, null);
  time += 600000;
  await database.close();
  database = createDatabase(filename);
  await database.initializeSchema();
  service = createChampionshipService(database, { now: () => time });
  assert.deepEqual((await service.current()).clock, state.clock);
  state = await service.pause(id, { expectedRevision: state.revision, paused: false });
  assert.equal(state.clock.elapsed_ms, 120000);
  assert.equal(state.clock.running_since, time);
  time += 60000;
  const firstSlot = state.active_slot;
  for (const round of firstSlot.rounds) state = await service.saveResult(id, round.id, {
    expectedRevision: state.revision,
    ...(round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: firstSlot.participants.map(p => p.player_id).sort().map(id => [id]) })
  });
  assert.equal(state.clock.event_elapsed_ms, 180000);
  assert.equal(state.clock.event_running_since, null);
  time += 30000;
  state = await service.advance(id, { expectedRevision: state.revision });
  assert.equal(state.clock.elapsed_ms, 210000);
  assert.equal(state.clock.event_elapsed_ms, 0);
  assert.equal(state.clock.event_running_since, time);
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) {
      time += 60000;
      state = await service.saveResult(id, round.id, {
        expectedRevision: state.revision,
        ...(round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: slot.participants.map(p => p.player_id).sort().map(id => [id]) })
      });
      if (state.active_round) assert.equal(state.clock.event_running_since, time, 'the two-round solo event keeps its clock running');
    }
    state = await service.advance(id, { expectedRevision: state.revision });
  }
  assert.equal(state.clock.running_since, null);
  const stopped = { ...state.clock };
  time += 600000;
  state = await service.complete(id, { expectedRevision: state.revision });
  assert.deepEqual(state.clock, stopped);
  const team = state.slots.find(s => s.category === 'team');
  state = await service.saveResult(id, team.rounds[0].id, { expectedRevision: state.revision, winningSide: 'robbers' });
  assert.deepEqual(state.clock, stopped, 'corrections do not add more play time');
});

test('withdrawing all competitors stops the running clock when empty events are skipped', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-empty-clock-'));
  const database = createDatabase(path.join(dir, 'event.db'));
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await database.initializeSchema();
  let time = Date.UTC(2026, 9, 25);
  const service = createChampionshipService(database, { now: () => time });
  let state = await service.create({ expectedActiveId: null, seed: 'clock-withdrawals' });
  const id = state.championship.id;
  for (let i = 0; i < 9; i++) await service.register(id, { name: `Player ${i}`, registrationToken: `clock-withdraw-token-${i}` });
  state = await service.current();
  state = await service.start(id, { expectedRevision: state.revision });
  time += 90000;
  for (let i = 0; i < 9; i++) state = await service.withdraw(id, state.players[i].id, `clock-withdraw-token-${i}`, { expectedRevision: state.revision });
  assert.equal(state.championship.status, 'awaiting_champion');
  assert.equal(state.clock.elapsed_ms, 90000);
  assert.equal(state.clock.running_since, null);
  assert.equal(state.clock.event_running_since, null);
});

test('tournaments already running before clock support do not invent historical pace', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-old-clock-'));
  const database = createDatabase(path.join(dir, 'event.db'));
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await database.initializeSchema();
  const service = createChampionshipService(database);
  let state = await service.create({ expectedActiveId: null, seed: 'already-playing' });
  const id = state.championship.id;
  for (let i = 0; i < 9; i++) await service.register(id, { name: `Player ${i}`, registrationToken: `old-clock-token-${i}` });
  // This is an event stored by the version before timing existed.
  await database.run("UPDATE championships SET status = 'running', cursor = 1 WHERE id = ?", [id]);
  state = await service.current();
  assert.equal(state.clock, null);
  state = await service.pause(id, { expectedRevision: state.revision, paused: true });
  assert.equal(state.clock, null);
  state = await service.pause(id, { expectedRevision: state.revision, paused: false });
  assert.equal(state.clock, null);
});

test('remaining time excludes future empty seats while retaining played rounds for pace', async () => {
  const { clockStats, renderEventClock } = await import('../public/js/event-clock.js');
  const state = {
    championship: { status: 'running', paused: true },
    clock: { elapsed_ms: 1440000, running_since: null, event_elapsed_ms: 0, event_running_since: null },
    slots: [
      { participants: [{ withdrawn_at: '2026-10-25' }], rounds: Array.from({ length: 4 }, () => ({ completed: true, skipped: false })) },
      { participants: [{ withdrawn_at: null }], rounds: [{ completed: false }] },
      { participants: [{ withdrawn_at: '2026-10-25' }], rounds: [{ completed: false }, { completed: false }] }
    ]
  };
  const stats = clockStats(state, 100);
  assert.equal(stats.estimatedMs, 360000);
  assert.equal(stats.remaining, 1);
  assert.equal(stats.estimatedFinish, null);
  const original = globalThis.document;
  const nodes = new Map();
  globalThis.document = { getElementById: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } };
  try {
    renderEventClock({ ...state, championship: { status: 'completed', paused: false }, clock: null });
    assert.equal(nodes.get('estimatedFinish').textContent, 'Events complete');
    assert.equal(nodes.get('playRemaining').textContent, '0 min');
    assert.equal(nodes.get('playElapsed').textContent, 'Not recorded');
    renderEventClock({ ...state, championship: { status: 'running', paused: false }, clock: null });
    assert.equal(nodes.get('estimatedFinish').textContent, 'Timing not recorded');
    assert.equal(nodes.get('playRemaining').textContent, 'Not estimated');
  } finally { globalThis.document = original; }
});
