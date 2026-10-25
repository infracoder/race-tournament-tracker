const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('isolated database initialization is additive, persistent and transactional', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-db-'));
  const guard = path.join(dir, 'must-not-open.db');
  process.env.DB_FILE = guard;
  const { createDatabase } = require('../database');
  const file = path.join(dir, 'test.db');
  let db;
  try {
    db = createDatabase(file);
    await db.initializeSchema();
    await db.run("INSERT INTO players (player_letter, name) VALUES ('Z', 'Preserved Player')");
    await db.initializeSchema();
    assert.equal((await db.get("SELECT name FROM players WHERE player_letter = 'Z'")).name, 'Preserved Player');
    const events = [];
    const first = db.transaction(async tx => {
      await tx.run("INSERT INTO championships (id, title, seed) VALUES ('one', 'First', 'seed')");
      await new Promise(resolve => setTimeout(resolve, 15));
      events.push('write');
    });
    const second = db.get('SELECT COUNT(*) AS count FROM championships').then(row => {
      events.push('read');
      assert.equal(row.count, 1);
    });
    await Promise.all([first, second]);
    assert.deepEqual(events, ['write', 'read']);
    await assert.rejects(db.transaction(async tx => {
      await tx.run("INSERT INTO championships (id, title, seed) VALUES ('two', 'Rollback', 'seed')");
      throw new Error('rollback');
    }));
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM championships')).count, 1);
    await db.close();
    db = createDatabase(file);
    assert.equal((await db.get("SELECT title FROM championships WHERE id = 'one'")).title, 'First');
    await db.seedTournament(8, 4);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM races')).count, 11);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM championships')).count, 1);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
    await assert.rejects(fs.stat(guard), { code: 'ENOENT' });
  } finally {
    if (db) await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a pre-junction legacy event survives additive championship initialization', async t => {
  const { createDatabase } = require('../database');
  const { installLegacyTournament } = require('./fixtures/legacy-tournament');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-legacy-'));
  const db = createDatabase(path.join(dir, 'legacy.db'));
  t.after(async () => { await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await installLegacyTournament(db);
  const players = await db.all('SELECT id, player_letter, name FROM players ORDER BY id');
  const results = await db.all('SELECT * FROM results ORDER BY id');
  await db.initializeSchema();
  await db.initializeSchema();
  assert.deepEqual(await db.all('SELECT id, player_letter, name FROM players ORDER BY id'), players);
  assert.deepEqual(await db.all('SELECT * FROM results ORDER BY id'), results);
  assert.equal((await db.get('SELECT status FROM tournament WHERE id = 1')).status, 'completed');
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM race_participants')).count, 4);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM championships')).count, 0);
});

test('result foreign keys enforce round membership while permitting shared ranks', async t => {
  const { createDatabase } = require('../database');
  const { createChampionshipService } = require('../lib/championship-service');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-membership-'));
  const db = createDatabase(path.join(dir, 'membership.db'));
  t.after(async () => { await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await db.initializeSchema();
  const state = await createChampionshipService(db).create({ expectedActiveId: null, seed: 'membership' });
  const slot = state.slots.find(s => s.category === 'solo');
  const round = slot.rounds[0];
  const id = state.championship.id;
  const insert = (roundId, slotId, playerId) => db.run('INSERT INTO round_results (championship_id, round_id, slot_id, player_id, rank, score_units) VALUES (?, ?, ?, ?, 1, 258)', [id, roundId, slotId, playerId]);
  await insert(round.id, slot.id, slot.participants[0].player_id);
  await insert(round.id, slot.id, slot.participants[1].player_id);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM round_results WHERE rank = 1')).count, 2);
  const outsider = state.players.find(p => !slot.participants.some(member => member.player_id === p.id));
  await assert.rejects(insert(round.id, slot.id, outsider.id), /FOREIGN KEY/);
  await assert.rejects(insert(state.slots.find(s => s.id !== slot.id).rounds[0].id, slot.id, slot.participants[2].player_id), /FOREIGN KEY/);
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
});
