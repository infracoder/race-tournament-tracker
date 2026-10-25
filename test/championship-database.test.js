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
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM races')).count, 8);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM championships')).count, 1);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
    await assert.rejects(fs.stat(guard), { code: 'ENOENT' });
  } finally {
    if (db) await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
