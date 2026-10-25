const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { generateSchedule, validateSchedule } = require('./lib/schedule-generator');
const {
  pickNonConsecutiveSlots,
  selectBattlePlayersRandom,
  pickRandomStage
} = require('./lib/battle-distribution');
const { initializeChampionshipSchema } = require('./lib/championship-schema');

function createDatabase(filename = process.env.DB_FILE || './tournament.db') {
  let db;
  const ready = new Promise((resolve, reject) => {
    db = new sqlite3.Database(filename, (err) => {
      if (err) return reject(err);
      db.configure('busyTimeout', 5000);
      db.run('PRAGMA foreign_keys = ON', (error) => (error ? reject(error) : resolve()));
    });
  });
  // Prevent a connection error from becoming unhandled before the first query.
  ready.catch(() => {});
  const raw = {
    run: (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
        });
      }),
    get: (sql, params = []) =>
      new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))),
    all: (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      )
  };
  let tail = Promise.resolve();
  let closing;
  const enqueue = (operation) => {
    if (closing) return Promise.reject(new Error('Database is closing.'));
    const next = tail.then(() => ready).then(operation);
    tail = next.catch(() => {});
    return next;
  };
  const run = (...args) => enqueue(() => raw.run(...args));
  const get = (...args) => enqueue(() => raw.get(...args));
  const all = (...args) => enqueue(() => raw.all(...args));
  const withTransaction = (callback, begin) =>
    enqueue(async () => {
      await raw.run(begin);
      try {
        const result = await callback(raw);
        await raw.run('COMMIT');
        return result;
      } catch (error) {
        try {
          await raw.run('ROLLBACK');
        } catch (rollbackError) {
          error.cause = rollbackError;
        }
        throw error;
      }
    });
  const transaction = (callback) => withTransaction(callback, 'BEGIN IMMEDIATE');
  const readTransaction = (callback) => withTransaction(callback, 'BEGIN');
  const close = () => {
    if (!closing)
      closing = tail
        .then(() => ready)
        .then(() => new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve()))));
    return closing;
  };
  /**
   * Migrate existing race data from legacy player1_id...player4_id columns
   * to race_participants junction table
   */
  async function migrateToJunctionTable() {
    await transaction(async (tx) => {
      // Backfill missing rows even if a previous upgrade committed only part of a race.
      const races = await tx.all(
        'SELECT race_number, player1_id, player2_id, player3_id, player4_id FROM races'
      );

      for (const race of races) {
        const participants = [
          { id: race.player1_id, slot: 1 },
          { id: race.player2_id, slot: 2 },
          { id: race.player3_id, slot: 3 },
          { id: race.player4_id, slot: 4 }
        ].filter((p) => p.id !== null && p.id !== undefined);

        for (const p of participants) {
          await tx.run(
            'INSERT OR IGNORE INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
            [race.race_number, p.id, p.slot]
          );
        }
      }
    });
  }

  // Initialize database schema
  async function initializeSchema() {
    // Enable foreign keys
    await run('PRAGMA foreign_keys = ON');

    // Tournament table (singleton)
    await run(`
    CREATE TABLE IF NOT EXISTS tournament (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'initialized',
      winner_id INTEGER,
      player_count INTEGER DEFAULT 9,
      total_races INTEGER DEFAULT 9,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )
  `);

    // Migrate existing tables: add player_count and total_races if missing
    try {
      await run('ALTER TABLE tournament ADD COLUMN player_count INTEGER DEFAULT 9');
    } catch (err) {
      // Column already exists, ignore
      if (!err.message.includes('duplicate column')) {
        console.warn('⚠️  Could not add player_count column:', err.message);
      }
    }

    try {
      await run('ALTER TABLE tournament ADD COLUMN total_races INTEGER DEFAULT 9');
    } catch (err) {
      // Column already exists, ignore
      if (!err.message.includes('duplicate column')) {
        console.warn('⚠️  Could not add total_races column:', err.message);
      }
    }

    // Players table
    await run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      player_letter TEXT UNIQUE NOT NULL CHECK (length(player_letter) = 1)
    )
  `);

    // Races table
    await run(`
    CREATE TABLE IF NOT EXISTS races (
      race_number INTEGER PRIMARY KEY,
      player1_id INTEGER,
      player2_id INTEGER,
      player3_id INTEGER,
      player4_id INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (player1_id) REFERENCES players(id),
      FOREIGN KEY (player2_id) REFERENCES players(id),
      FOREIGN KEY (player3_id) REFERENCES players(id),
      FOREIGN KEY (player4_id) REFERENCES players(id)
    )
  `);

    // Results table
    await run(`
    CREATE TABLE IF NOT EXISTS results (
      race_number INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
      points INTEGER NOT NULL,
      PRIMARY KEY (race_number, player_id),
      UNIQUE (race_number, position),
      FOREIGN KEY (race_number) REFERENCES races(race_number),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

    // Race participants junction table (new flexible schema)
    await run(`
    CREATE TABLE IF NOT EXISTS race_participants (
      race_number INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      slot_position INTEGER NOT NULL,
      PRIMARY KEY (race_number, player_id),
      UNIQUE (race_number, slot_position),
      FOREIGN KEY (race_number) REFERENCES races(race_number) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )
  `);

    // Create indexes for performance
    await run('CREATE INDEX IF NOT EXISTS idx_race_participants_race ON race_participants(race_number)');
    await run('CREATE INDEX IF NOT EXISTS idx_race_participants_player ON race_participants(player_id)');

    // Add players_per_race column to tournament table
    try {
      await run('ALTER TABLE tournament ADD COLUMN players_per_race INTEGER DEFAULT 4');
    } catch (err) {
      // Column already exists, ignore
      if (!err.message.includes('duplicate column')) {
        console.warn('⚠️  Could not add players_per_race column:', err.message);
      }
    }

    // Migrate existing race data to junction table if needed
    await migrateToJunctionTable();

    // Add is_battle column to races table
    try {
      await run('ALTER TABLE races ADD COLUMN is_battle INTEGER NOT NULL DEFAULT 0');
    } catch (err) {
      // Column already exists, ignore
      if (!err.message.includes('duplicate column')) {
        console.warn('⚠️  Could not add is_battle column:', err.message);
      }
    }

    // Battle games table
    await run(`
    CREATE TABLE IF NOT EXISTS battle_games (
      race_number INTEGER PRIMARY KEY,
      stage_name TEXT NOT NULL CHECK (stage_name IN ('Battle Stadium', 'Sweet Sweet Kingdom', 'Dragon Palace', 'Lunar Colony')),
      player1_id INTEGER NOT NULL,
      player2_id INTEGER NOT NULL,
      player3_id INTEGER NOT NULL,
      player4_id INTEGER NOT NULL,
      FOREIGN KEY (race_number) REFERENCES races(race_number) ON DELETE CASCADE,
      FOREIGN KEY (player1_id) REFERENCES players(id),
      FOREIGN KEY (player2_id) REFERENCES players(id),
      FOREIGN KEY (player3_id) REFERENCES players(id),
      FOREIGN KEY (player4_id) REFERENCES players(id)
    )
  `);

    // Create index for battle race lookups
    await run('CREATE INDEX IF NOT EXISTS idx_races_is_battle ON races(is_battle)');
    await initializeChampionshipSchema({ transaction });
  }

  /**
   * Resolve players per race from various sources with precedence
   * Priority: param > env var > default 4
   * Only allows 2 or 4
   */
  function resolvePlayersPerRace(playersPerRaceParam) {
    // 1. Explicit function parameter
    if (playersPerRaceParam !== undefined && playersPerRaceParam !== null) {
      const value = parseInt(playersPerRaceParam, 10);
      if (![2, 4].includes(value)) {
        throw new Error(`Invalid players_per_race: ${playersPerRaceParam}. Must be 2 or 4.`);
      }
      return value;
    }

    // 2. Environment variable
    if (process.env.PLAYERS_PER_RACE) {
      const envValue = parseInt(process.env.PLAYERS_PER_RACE, 10);
      if (!isNaN(envValue)) {
        if (![2, 4].includes(envValue)) {
          console.warn(`⚠️  Invalid PLAYERS_PER_RACE env var: ${envValue}. Using default 4.`);
          return 4;
        }
        return envValue;
      }
    }

    // 3. Default
    return 4;
  }

  /**
   * Resolve player count from various sources with precedence
   * Priority: param > config file > env var > default 9
   */
  function resolvePlayerCount(playerCountParam) {
    // 1. Explicit function parameter
    if (playerCountParam !== undefined && playerCountParam !== null) {
      return playerCountParam;
    }

    // 2. Config file
    try {
      const configPath = path.join(__dirname, 'config', 'tournament-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.player_count) {
          return config.player_count;
        }
      }
    } catch (err) {
      console.warn('⚠️  Could not read config file:', err.message);
    }

    // 3. Environment variable
    if (process.env.PLAYER_COUNT) {
      const envCount = parseInt(process.env.PLAYER_COUNT, 10);
      if (!isNaN(envCount)) {
        return envCount;
      }
    }

    // 4. Default
    return 9;
  }

  /**
   * Generate letters array based on player count
   * 8 players: A-H, 9 players: A-I, 10 players: A-J
   */
  function generateLetters(playerCount) {
    const letters = [];
    for (let i = 0; i < playerCount; i++) {
      letters.push(String.fromCharCode(65 + i)); // A=65
    }
    return letters;
  }

  // Seed tournament data
  async function seedTournament(playerCountParam, playersPerRaceParam) {
    // Resolve player count and players per race
    const playerCount = resolvePlayerCount(playerCountParam);
    const playersPerRace = resolvePlayersPerRace(playersPerRaceParam);

    // Validate player count
    if (![8, 9, 10].includes(playerCount)) {
      throw new Error(`Invalid player count: ${playerCount}. Must be 8, 9, or 10.`);
    }

    // Validate players per race
    if (![2, 4].includes(playersPerRace)) {
      throw new Error(`Invalid players_per_race: ${playersPerRace}. Must be 2 or 4.`);
    }

    // Calculate scoring races before adding bonus battles.
    const scoringRaceCount = (playerCount * 4) / playersPerRace;
    if (scoringRaceCount !== Math.floor(scoringRaceCount)) {
      throw new Error(
        `Invalid configuration: (${playerCount} * 4) / ${playersPerRace} = ${scoringRaceCount} (must be an integer)`
      );
    }

    const letters = generateLetters(playerCount);

    // Generate schedule using algorithm
    let schedule;
    try {
      schedule = generateSchedule(playerCount, playersPerRace);
    } catch (err) {
      throw new Error(`Failed to generate schedule: ${err.message}`);
    }

    // Validate generated schedule
    const validation = validateSchedule(schedule, letters, playersPerRace);
    if (!validation.ok) {
      throw new Error(`Schedule validation failed: ${validation.errors.join(', ')}`);
    }

    const battleSlots = pickNonConsecutiveSlots(schedule.length + 3, 3);
    const events = schedule.map((race) => ({ ...race, is_battle: false }));
    for (const raceNumber of battleSlots) {
      events.splice(raceNumber - 1, 0, { is_battle: true });
    }
    events.forEach((event, index) => { event.race_number = index + 1; });
    const totalRaces = events.length;

    await transaction(async (tx) => {
      // Clear existing data
      await tx.run('DELETE FROM results');
      await tx.run('DELETE FROM race_participants');
      await tx.run('DELETE FROM races');
      await tx.run('DELETE FROM players');
      await tx.run('DELETE FROM tournament');

      // Create tournament record with player_count, total_races, and players_per_race
      await tx.run(
        'INSERT INTO tournament (id, status, player_count, total_races, players_per_race) VALUES (1, ?, ?, ?, ?)',
        ['initialized', playerCount, totalRaces, playersPerRace]
      );

      // Create players with dynamic letters
      for (const letter of letters) {
        await tx.run('INSERT INTO players (player_letter, name) VALUES (?, NULL)', [letter]);
      }

      // Create races from generated schedule
      for (const race of events.filter((event) => !event.is_battle)) {
        // Insert base race record
        await tx.run('INSERT INTO races (race_number, completed) VALUES (?, 0)', [race.race_number]);

        // Get player IDs and insert into junction table
        const playerIds = await Promise.all(
          race.letters.map((letter) => tx.get('SELECT id FROM players WHERE player_letter = ?', [letter]))
        );

        // Insert race participants with slot positions
        for (let i = 0; i < playerIds.length; i++) {
          await tx.run(
            'INSERT INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
            [race.race_number, playerIds[i].id, i + 1]
          );
        }

        // LEGACY: Also populate old player1_id..player4_id columns for backward compat
        if (playersPerRace === 4) {
          await tx.run(
            'UPDATE races SET player1_id = ?, player2_id = ?, player3_id = ?, player4_id = ? WHERE race_number = ?',
            [playerIds[0].id, playerIds[1].id, playerIds[2].id, playerIds[3].id, race.race_number]
          );
        } else if (playersPerRace === 2) {
          await tx.run('UPDATE races SET player1_id = ?, player2_id = ? WHERE race_number = ?', [
            playerIds[0].id,
            playerIds[1].id,
            race.race_number
          ]);
        }
      }

      // Generate and insert battle games
      const allPlayerIds = (await tx.all('SELECT id FROM players ORDER BY id')).map((p) => p.id);
      const battleRosters = selectBattlePlayersRandom(allPlayerIds, 3, 4);

      for (let i = 0; i < battleSlots.length; i++) {
        const raceNumber = battleSlots[i];
        const roster = battleRosters[i];
        const stage = pickRandomStage();

        await tx.run(
          'INSERT INTO races (race_number, player1_id, player2_id, player3_id, player4_id, completed, is_battle) VALUES (?, ?, ?, ?, ?, 0, 1)',
          [raceNumber, ...roster]
        );
        for (let slot = 0; slot < roster.length; slot++) {
          await tx.run(
            'INSERT INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
            [raceNumber, roster[slot], slot + 1]
          );
        }

        // Insert battle game details
        await tx.run(
          'INSERT INTO battle_games (race_number, stage_name, player1_id, player2_id, player3_id, player4_id) VALUES (?, ?, ?, ?, ?, ?)',
          [raceNumber, stage, roster[0], roster[1], roster[2], roster[3]]
        );
      }
    });

    // Validate participation counts using junction table
    const counts = await all(`
    SELECT p.player_letter, COUNT(r.race_number) as race_count
    FROM players p
    LEFT JOIN race_participants rp ON p.id = rp.player_id
    LEFT JOIN races r ON r.race_number = rp.race_number AND r.is_battle = 0
    GROUP BY p.id, p.player_letter
    ORDER BY p.player_letter
  `);

    const allCorrect = counts.length === playerCount && counts.every((c) => c.race_count === 4);
    if (!allCorrect) {
      throw new Error('❌ Post-seed validation failed: Not all players have exactly 4 races!');
    }
  }

  return { run, get, all, transaction, readTransaction, close, initializeSchema, seedTournament };
}

// Legacy consumers retain their query interface without opening a file on import.
let defaultDatabase;
const getDefault = () => (defaultDatabase ||= createDatabase());
module.exports = { createDatabase };
for (const method of [
  'run',
  'get',
  'all',
  'transaction',
  'readTransaction',
  'close',
  'initializeSchema',
  'seedTournament'
]) {
  module.exports[method] = (...args) => getDefault()[method](...args);
}
