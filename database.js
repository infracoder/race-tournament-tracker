const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { generateSchedule, validateSchedule } = require('./lib/schedule-generator');
const { pickNonConsecutiveSlots, selectBattlePlayersRandom, pickRandomStage } = require('./lib/battle-distribution');

const DB_FILE = process.env.DB_FILE || './tournament.db';

// Initialize database connection
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('📊 Connected to SQLite database:', DB_FILE);
  }
});

// Promise wrappers for database operations
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Transaction helper
const transaction = async (callback) => {
  await run('BEGIN TRANSACTION');
  try {
    const result = await callback();
    await run('COMMIT');
    return result;
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
};

/**
 * Migrate existing race data from legacy player1_id...player4_id columns
 * to race_participants junction table
 */
async function migrateToJunctionTable() {
  try {
    // Check if migration is needed
    const existingCount = await get('SELECT COUNT(*) as count FROM race_participants');
    if (existingCount && existingCount.count > 0) {
      console.log('✅ Junction table migration already completed');
      return;
    }
    
    // Check if there are any races to migrate
    const racesCount = await get('SELECT COUNT(*) as count FROM races');
    if (!racesCount || racesCount.count === 0) {
      console.log('📊 No races to migrate');
      return;
    }
    
    console.log('🔄 Migrating legacy race data to junction table...');
    
    // Get all races with participant data
    const races = await all('SELECT race_number, player1_id, player2_id, player3_id, player4_id FROM races');
    
    let migratedCount = 0;
    for (const race of races) {
      const participants = [
        { id: race.player1_id, slot: 1 },
        { id: race.player2_id, slot: 2 },
        { id: race.player3_id, slot: 3 },
        { id: race.player4_id, slot: 4 }
      ].filter(p => p.id !== null && p.id !== undefined);
      
      for (const p of participants) {
        await run(
          'INSERT OR IGNORE INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
          [race.race_number, p.id, p.slot]
        );
      }
      
      migratedCount++;
    }
    
    console.log(`✅ Migrated ${migratedCount} races to junction table`);
  } catch (err) {
    console.warn('⚠️  Migration warning:', err.message);
    // Non-fatal - allow schema initialization to continue
  }
}

// Initialize database schema
async function initializeSchema() {
  console.log('🔧 Initializing database schema...');
  
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
    console.log('✅ Added player_count column to tournament table');
  } catch (err) {
    // Column already exists, ignore
    if (!err.message.includes('duplicate column')) {
      console.warn('⚠️  Could not add player_count column:', err.message);
    }
  }
  
  try {
    await run('ALTER TABLE tournament ADD COLUMN total_races INTEGER DEFAULT 9');
    console.log('✅ Added total_races column to tournament table');
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
    console.log('✅ Added players_per_race column to tournament table');
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
    console.log('✅ Added is_battle column to races table');
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

  console.log('✅ Database schema initialized');
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
      console.log(`🌍 Using PLAYERS_PER_RACE from environment: ${envValue}`);
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
        console.log(`📄 Using player_count from config file: ${config.player_count}`);
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
      console.log(`🌍 Using PLAYER_COUNT from environment: ${envCount}`);
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
  console.log('🌱 Seeding tournament data...');
  
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
  
  // Calculate total races
  const totalRaces = (playerCount * 4) / playersPerRace;
  if (totalRaces !== Math.floor(totalRaces)) {
    throw new Error(`Invalid configuration: (${playerCount} * 4) / ${playersPerRace} = ${totalRaces} (must be an integer)`);
  }
  
  console.log(`🎮 Configuring tournament for ${playerCount} players, ${playersPerRace} per race`);
  console.log(`📊 Total races: ${totalRaces}`);
  
  const letters = generateLetters(playerCount);
  
  // Generate schedule using algorithm
  let schedule;
  try {
    schedule = generateSchedule(playerCount, playersPerRace);
    console.log(`📋 Generated ${schedule.length} race schedule`);
  } catch (err) {
    throw new Error(`Failed to generate schedule: ${err.message}`);
  }
  
  // Validate generated schedule
  const validation = validateSchedule(schedule, letters, playersPerRace);
  if (!validation.ok) {
    throw new Error(`Schedule validation failed: ${validation.errors.join(', ')}`);
  }
  
  console.log('✅ Schedule validated successfully');
  console.log(`   Max pair repeats: ${validation.metrics.maxPairRepeats}`);
  console.log(`   Max back-to-back: ${validation.metrics.maxBackToBack}`);
  
  await transaction(async () => {
    // Clear existing data
    await run('DELETE FROM results');
    await run('DELETE FROM race_participants');
    await run('DELETE FROM races');
    await run('DELETE FROM players');
    await run('DELETE FROM tournament');
    
    // Create tournament record with player_count, total_races, and players_per_race
    await run(
      'INSERT INTO tournament (id, status, player_count, total_races, players_per_race) VALUES (1, ?, ?, ?, ?)',
      ['initialized', playerCount, totalRaces, playersPerRace]
    );
    
    // Create players with dynamic letters
    for (const letter of letters) {
      await run('INSERT INTO players (player_letter, name) VALUES (?, NULL)', [letter]);
    }
    
    // Create races from generated schedule
    for (const race of schedule) {
      // Insert base race record
      await run('INSERT INTO races (race_number, completed) VALUES (?, 0)', [race.race_number]);
      
      // Get player IDs and insert into junction table
      const playerIds = await Promise.all(
        race.letters.map(letter => 
          get('SELECT id FROM players WHERE player_letter = ?', [letter])
        )
      );
      
      // Insert race participants with slot positions
      for (let i = 0; i < playerIds.length; i++) {
        await run(
          'INSERT INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
          [race.race_number, playerIds[i].id, i + 1]
        );
      }
      
      // LEGACY: Also populate old player1_id..player4_id columns for backward compat
      if (playersPerRace === 4) {
        await run(
          'UPDATE races SET player1_id = ?, player2_id = ?, player3_id = ?, player4_id = ? WHERE race_number = ?',
          [playerIds[0].id, playerIds[1].id, playerIds[2].id, playerIds[3].id, race.race_number]
        );
      } else if (playersPerRace === 2) {
        await run(
          'UPDATE races SET player1_id = ?, player2_id = ? WHERE race_number = ?',
          [playerIds[0].id, playerIds[1].id, race.race_number]
        );
      }
    }
    
    // Generate and insert battle games
    const battleSlots = pickNonConsecutiveSlots(totalRaces, 3, 2, totalRaces - 1);
    const allPlayerIds = (await all('SELECT id FROM players ORDER BY id')).map(p => p.id);
    const battleRosters = selectBattlePlayersRandom(allPlayerIds, 3, 4);
    
    console.log(`⚔️  Scheduling ${battleSlots.length} battle games at races: ${battleSlots.join(', ')}`);
    
    for (let i = 0; i < battleSlots.length; i++) {
      const raceNumber = battleSlots[i];
      const roster = battleRosters[i];
      const stage = pickRandomStage();
      
      // Mark race as battle
      await run(
        'UPDATE races SET is_battle = 1 WHERE race_number = ?',
        [raceNumber]
      );
      
      // Insert battle game details
      await run(
        'INSERT INTO battle_games (race_number, stage_name, player1_id, player2_id, player3_id, player4_id) VALUES (?, ?, ?, ?, ?, ?)',
        [raceNumber, stage, roster[0], roster[1], roster[2], roster[3]]
      );
      
      console.log(`   Battle ${i + 1}: Race ${raceNumber} - ${stage}`);
    }
  });
  
  // Validate participation counts using junction table
  const counts = await all(`
    SELECT p.player_letter, COUNT(*) as race_count
    FROM players p
    JOIN race_participants rp ON p.id = rp.player_id
    GROUP BY p.id, p.player_letter
    ORDER BY p.player_letter
  `);
  
  console.log('📊 Player race participation:');
  counts.forEach(c => console.log(`  Player ${c.player_letter}: ${c.race_count} races`));
  
  const allCorrect = counts.every(c => c.race_count === 4);
  if (!allCorrect) {
    throw new Error('❌ Post-seed validation failed: Not all players have exactly 4 races!');
  }
  
  console.log('✅ Tournament seeded successfully');
  console.log(`   Configuration: ${playerCount} players, ${playersPerRace} per race, ${totalRaces} total races`);
}

module.exports = {
  db,
  run,
  get,
  all,
  transaction,
  initializeSchema,
  seedTournament
};
