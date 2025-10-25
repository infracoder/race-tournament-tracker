const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { generateSchedule, validateSchedule } = require('./lib/schedule-generator');

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

// Initialize database schema
async function initializeSchema() {
  console.log('🔧 Initializing database schema...');
  
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

  console.log('✅ Database schema initialized');
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
async function seedTournament(playerCountParam) {
  console.log('🌱 Seeding tournament data...');
  
  // Resolve player count
  const playerCount = resolvePlayerCount(playerCountParam);
  
  // Validate player count
  if (![8, 9, 10].includes(playerCount)) {
    throw new Error(`Invalid player count: ${playerCount}. Must be 8, 9, or 10.`);
  }
  
  console.log(`🎮 Configuring tournament for ${playerCount} players`);
  
  const totalRaces = playerCount; // 8 players = 8 races, etc.
  const letters = generateLetters(playerCount);
  
  // Generate schedule using algorithm
  let schedule;
  try {
    schedule = generateSchedule(playerCount);
    console.log(`📋 Generated ${schedule.length} race schedule`);
  } catch (err) {
    throw new Error(`Failed to generate schedule: ${err.message}`);
  }
  
  // Validate generated schedule
  const validation = validateSchedule(schedule, letters);
  if (!validation.ok) {
    throw new Error(`Schedule validation failed: ${validation.errors.join(', ')}`);
  }
  
  console.log('✅ Schedule validated successfully');
  console.log(`   Max pair repeats: ${validation.metrics.maxPairRepeats}`);
  console.log(`   Max back-to-back: ${validation.metrics.maxBackToBack}`);
  
  await transaction(async () => {
    // Clear existing data
    await run('DELETE FROM results');
    await run('DELETE FROM races');
    await run('DELETE FROM players');
    await run('DELETE FROM tournament');
    
    // Create tournament record with player_count and total_races
    await run(
      'INSERT INTO tournament (id, status, player_count, total_races) VALUES (1, ?, ?, ?)',
      ['initialized', playerCount, totalRaces]
    );
    
    // Create players with dynamic letters
    for (const letter of letters) {
      await run('INSERT INTO players (player_letter, name) VALUES (?, NULL)', [letter]);
    }
    
    // Create races from generated schedule
    for (const race of schedule) {
      const playerIds = await Promise.all(
        race.letters.map(letter => 
          get('SELECT id FROM players WHERE player_letter = ?', [letter])
        )
      );
      
      await run(
        'INSERT INTO races (race_number, player1_id, player2_id, player3_id, player4_id) VALUES (?, ?, ?, ?, ?)',
        [race.race_number, playerIds[0].id, playerIds[1].id, playerIds[2].id, playerIds[3].id]
      );
    }
  });
  
  // Validate participation counts
  const counts = await all(`
    SELECT p.player_letter, COUNT(*) as race_count
    FROM players p
    JOIN races r ON p.id IN (r.player1_id, r.player2_id, r.player3_id, r.player4_id)
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
