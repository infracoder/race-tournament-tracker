const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../database');
const { installLegacyTournament } = require('./fixtures/legacy-tournament');
const { generateSchedule } = require('../lib/schedule-generator');
const { createApp } = require('../app');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-legacy-regression-'));
  const filename = path.join(directory, 'test.db');
  const state = { database: createDatabase(filename), filename };
  t.after(async () => {
    if (state.server) await new Promise(resolve => state.server.close(resolve));
    await state.database.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return state;
}

async function installPartialMigration(database) {
  await installLegacyTournament(database);
  await database.run(`CREATE TABLE race_participants (
    race_number INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    slot_position INTEGER NOT NULL,
    PRIMARY KEY (race_number, player_id),
    UNIQUE (race_number, slot_position),
    FOREIGN KEY (race_number) REFERENCES races(race_number) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  )`);
  await database.run('INSERT INTO race_participants VALUES (1, 1, 1)');
}

async function serve(state) {
  const app = createApp({ database: state.database, organizerPin: '2468' });
  state.server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const base = `http://127.0.0.1:${state.server.address().port}`;
  let cookie;
  async function request(route, body) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (route === '/api/organizer/login' && response.ok) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request('/api/organizer/login', { pin: '2468' })).status, 200);
  return request;
}

test('legacy participant migration resumes after restart and preserves existing data', async t => {
  const state = await fixture(t);
  await installPartialMigration(state.database);
  const players = await state.database.all('SELECT * FROM players ORDER BY id');
  const results = await state.database.all('SELECT * FROM results ORDER BY id');
  const races = await state.database.all('SELECT race_number, player1_id, player2_id, player3_id, player4_id, completed, created_at, completed_at FROM races');

  await state.database.close();
  state.database = createDatabase(state.filename);
  await state.database.initializeSchema();
  await state.database.initializeSchema();

  assert.deepEqual(await state.database.all('SELECT * FROM race_participants ORDER BY slot_position'), [
    { race_number: 1, player_id: 1, slot_position: 1 },
    { race_number: 1, player_id: 2, slot_position: 2 },
    { race_number: 1, player_id: 3, slot_position: 3 },
    { race_number: 1, player_id: 4, slot_position: 4 }
  ]);
  assert.deepEqual(await state.database.all('SELECT * FROM players ORDER BY id'), players);
  assert.deepEqual(await state.database.all('SELECT * FROM results ORDER BY id'), results);
  assert.deepEqual(await state.database.all('SELECT race_number, player1_id, player2_id, player3_id, player4_id, completed, created_at, completed_at FROM races'), races);
  assert.equal((await state.database.get('SELECT status FROM tournament WHERE id = 1')).status, 'completed');
  assert.deepEqual(await state.database.all('PRAGMA foreign_key_check'), []);
});

test('legacy participant migration rolls back missing rows and surfaces failures for retry', async t => {
  const { database } = await fixture(t);
  await installPartialMigration(database);
  await database.run(`CREATE TRIGGER reject_migration_participant
    BEFORE INSERT ON race_participants WHEN NEW.player_id = 3
    BEGIN SELECT RAISE(ABORT, 'interrupted participant migration'); END`);

  await assert.rejects(database.initializeSchema(), /interrupted participant migration/);
  assert.deepEqual(await database.all('SELECT * FROM race_participants'), [
    { race_number: 1, player_id: 1, slot_position: 1 }
  ]);

  await database.run('DROP TRIGGER reject_migration_participant');
  await database.initializeSchema();
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM race_participants')).count, 4);
});

test('classic fixtures retain four scoring races per player plus three extra battles in every supported mode', async t => {
  for (const playerCount of [8, 9, 10]) {
    for (const playersPerRace of [2, 4]) {
      await t.test(`${playerCount} players, ${playersPerRace} per scoring race`, async t => {
        const { database } = await fixture(t);
        await database.initializeSchema();
        await database.seedTournament(playerCount, playersPerRace);

        const races = await database.all('SELECT race_number, is_battle FROM races ORDER BY race_number');
        const scoringRaces = races.filter(race => !race.is_battle);
        const battles = races.filter(race => race.is_battle);
        const expectedScoringCount = playerCount * 4 / playersPerRace;
        assert.equal(scoringRaces.length, expectedScoringCount);
        assert.equal(battles.length, 3);
        assert.equal(races.length, expectedScoringCount + 3);
        assert.equal((await database.get('SELECT total_races FROM tournament WHERE id = 1')).total_races, races.length);
        assert.deepEqual(races.map(race => race.race_number), Array.from({ length: races.length }, (_, index) => index + 1));
        assert.equal(races[0].is_battle, 0);
        assert.equal(races.at(-1).is_battle, 0);
        assert.ok(battles.every((battle, index) => !index || battle.race_number - battles[index - 1].race_number > 1));

        const expectedSchedule = generateSchedule(playerCount, playersPerRace);
        for (let index = 0; index < scoringRaces.length; index++) {
          const participants = await database.all(`SELECT p.player_letter FROM race_participants rp
            JOIN players p ON p.id = rp.player_id WHERE rp.race_number = ? ORDER BY rp.slot_position`, [scoringRaces[index].race_number]);
          assert.deepEqual(participants.map(player => player.player_letter), expectedSchedule[index].letters);
        }
        const appearances = await database.all(`SELECT p.player_letter, COUNT(r.race_number) AS scoring_count
          FROM players p LEFT JOIN race_participants rp ON rp.player_id = p.id
          LEFT JOIN races r ON r.race_number = rp.race_number AND r.is_battle = 0
          GROUP BY p.id ORDER BY p.player_letter`);
        assert.equal(appearances.length, playerCount);
        assert.ok(appearances.every(player => player.scoring_count === 4), JSON.stringify(appearances));
        assert.deepEqual(await database.all('PRAGMA foreign_key_check'), []);
      });
    }
  }
});

test('battle reads, player schedules and completion use one four-player roster in both scoring modes', async t => {
  for (const playersPerRace of [2, 4]) {
    await t.test(`${playersPerRace}-player scoring mode`, async t => {
      const state = await fixture(t);
      const { database } = state;
      await database.initializeSchema();
      const request = await serve(state);
      const initialized = await request('/api/tournament/init', { player_count: 9, players_per_race: playersPerRace });
      assert.equal(initialized.status, 200);
      assert.equal(initialized.body.total_races, 9 * 4 / playersPerRace + 3);
      // Re-running initialization must not restore an unrelated scoring lineup to a battle.
      await database.initializeSchema();

      const { body: { races } } = await request('/api/races');
      const battle = races.find(race => race.is_battle);
      const details = await request(`/api/battle/by-race/${battle.race_number}`);
      assert.equal(details.status, 200);
      const roster = details.body.players.map(player => player.id);
      assert.equal(roster.length, 4);
      assert.deepEqual(battle.participants.map(player => player.id), roster);
      const legacy = await database.get('SELECT player1_id, player2_id, player3_id, player4_id FROM races WHERE race_number = ?', [battle.race_number]);
      assert.deepEqual(Object.values(legacy), roster);

      const players = await database.all('SELECT id FROM players ORDER BY id');
      for (const player of players) {
        const schedule = await request(`/api/players/schedule/${player.id}`);
        assert.equal(schedule.status, 200);
        const entry = schedule.body.schedule.find(race => race.race_number === battle.race_number);
        assert.equal(Boolean(entry), roster.includes(player.id));
        if (entry) assert.deepEqual(entry.opponents.map(opponent => opponent.id), roster.filter(id => id !== player.id));
      }

      const placements = roster.map((player_id, index) => ({ player_id, position: index + 1 }));
      for (const count of [2, 3, 5]) {
        const invalidCount = count < 4 ? placements.slice(0, count) : [...placements, { player_id: 999, position: 5 }];
        const rejected = await request('/api/race/result', { race_number: battle.race_number, placements: invalidCount });
        assert.equal(rejected.status, 400);
        assert.equal(rejected.body.expected, 4);
      }
      const outsider = players.find(player => !roster.includes(player.id));
      const wrongRoster = await request('/api/race/result', {
        race_number: battle.race_number,
        placements: [{ player_id: outsider.id, position: 1 }, ...placements.slice(1)]
      });
      assert.equal(wrongRoster.status, 400);
      const duplicate = await request('/api/race/result', {
        race_number: battle.race_number,
        placements: [placements[1], ...placements.slice(1)]
      });
      assert.equal(duplicate.status, 400);
      assert.equal((await database.get('SELECT completed FROM races WHERE race_number = ?', [battle.race_number])).completed, 0);

      const completed = await request('/api/race/result', { race_number: battle.race_number, placements });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.is_battle, true);
      assert.equal((await database.get('SELECT completed FROM races WHERE race_number = ?', [battle.race_number])).completed, 1);
      assert.equal((await database.get('SELECT COUNT(*) AS count FROM results')).count, 0);
      assert.equal((await request('/api/race/result', { race_number: battle.race_number, placements })).status, 409);

      const scoring = races.find(race => !race.is_battle);
      const scoringPlacements = scoring.participants.map((player, index) => ({ player_id: player.id, position: index + 1 }));
      const badCount = playersPerRace === 2 ? [...scoringPlacements, ...placements.slice(0, 2)] : scoringPlacements.slice(0, 2);
      const invalidScoring = await request('/api/race/result', { race_number: scoring.race_number, placements: badCount });
      assert.equal(invalidScoring.status, 400);
      assert.equal(invalidScoring.body.expected, playersPerRace);
      const duplicatePosition = scoringPlacements.map(placement => ({ ...placement, position: 1 }));
      assert.equal((await request('/api/race/result', { race_number: scoring.race_number, placements: duplicatePosition })).status, 400);
      const scored = await request('/api/race/result', { race_number: scoring.race_number, placements: scoringPlacements });
      assert.equal(scored.status, 200);
      assert.deepEqual(scored.body.results.map(result => result.points), [25, 18, 15, 12].slice(0, playersPerRace));
      assert.equal((await database.get('SELECT COUNT(*) AS count FROM results WHERE race_number = ?', [battle.race_number])).count, 0);
    });
  }
});
