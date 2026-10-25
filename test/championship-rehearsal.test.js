const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../database');
const { createChampionshipService } = require('../lib/championship-service');

test('every total reconciles to independent outcomes across a mid-solo restart', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-rehearsal-'));
  const filename = path.join(dir, 'event.db');
  let database = createDatabase(filename);
  let service = createChampionshipService(database);
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await database.initializeSchema();
  let state = await service.create({ expectedActiveId: null, seed: 'restart-rehearsal' });
  const id = state.championship.id;
  for (let i = 0; i < 9; i++) await service.register(id, { name: `Player ${i + 1}`, registrationToken: `independent-rehearsal-${i}` });
  state = await service.current();
  state = await service.start(id, { expectedRevision: state.revision });
  const expected = Object.fromEntries(state.players.map(p => [p.id, { race: 0, solo: 0, team: 0, wins: { race: 0, balloon: 0, coin: 0, team: 0 } }]));
  let restarted = false;
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) {
      let payload;
      const ids = slot.participants.map(p => p.player_id);
      if (round.mode === 'renegade') {
        const side = slot.position % 2 ? 'cops' : 'robbers';
        payload = { winningSide: side };
        for (const p of slot.participants) {
          expected[p.player_id].team += p.side === side ? 25 : 12;
          if (p.side === side) expected[p.player_id].wins.team++;
        }
      } else {
        const groups = round.mode === 'race' ? ids.map(id => [id]) : round.order === 1 ? [ids.slice(0, 3), ids.slice(3)] : [ids.slice(0, 2), ids.slice(2, 3), ids.slice(3)];
        payload = { groups };
        const places = [25, 18, 15, 12];
        let place = 0;
        for (const group of groups) {
          const award = places.slice(place, place + group.length).reduce((sum, n) => sum + n, 0) / group.length;
          for (const player of group) {
            expected[player][slot.category] += slot.category === 'solo' ? award / 2 : award;
            if (place === 0) expected[player].wins[round.mode]++;
          }
          place += group.length;
        }
      }
      state = await service.saveResult(id, round.id, { ...payload, expectedRevision: state.revision });
      if (!restarted && round.mode === 'balloon') {
        state = await service.pause(id, { expectedRevision: state.revision, paused: true });
        const before = state;
        await database.close();
        database = createDatabase(filename);
        await database.initializeSchema();
        service = createChampionshipService(database);
        state = await service.current();
        assert.deepEqual(state, before);
        assert.equal(state.active_round.mode, 'coin');
        assert.equal(state.championship.paused, true);
        state = await service.pause(id, { expectedRevision: state.revision, paused: false });
        restarted = true;
      }
    }
    state = await service.advance(id, { expectedRevision: state.revision });
  }
  assert.equal(restarted, true);
  assert.equal(state.rounds_completed, 36);
  for (const player of state.standings) {
    const independent = expected[player.id];
    for (const category of ['race', 'solo', 'team']) assert.equal(player.category_units[category], Math.round(independent[category] * 12));
    assert.equal(player.total_units, Math.round((independent.race + independent.solo + independent.team) * 12));
    assert.deepEqual(player.wins, independent.wins);
    assert.equal(player.slots_completed, 12);
  }
  const leaders = state.standings.filter(p => p.rank === 1);
  state = await service.complete(id, { expectedRevision: state.revision, playoffWinnerId: leaders[0].id });
  assert.equal(state.winner.id, leaders[0].id);
  const finished = state;
  await database.close();
  database = createDatabase(filename);
  await database.initializeSchema();
  assert.deepEqual(await createChampionshipService(database).current(), finished);
  assert.deepEqual(await database.all('PRAGMA foreign_key_check'), []);
});
