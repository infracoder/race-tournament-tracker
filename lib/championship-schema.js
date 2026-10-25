async function initializeChampionshipSchema(database) {
  await database.transaction(async (tx) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS championships (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, seed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'registration' CHECK(status IN ('registration','running','awaiting_champion','completed')),
        paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
        cursor INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
        winner_id TEXT, winner_source TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
        FOREIGN KEY(id, winner_id) REFERENCES championship_players(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS championship_app_state (
        id INTEGER PRIMARY KEY CHECK(id = 1), championship_id TEXT REFERENCES championships(id)
      )`,
      `CREATE TABLE IF NOT EXISTS championship_players (
        championship_id TEXT NOT NULL REFERENCES championships(id), id TEXT NOT NULL,
        letter TEXT NOT NULL, name TEXT, registration_token TEXT,
        PRIMARY KEY(championship_id, id), UNIQUE(championship_id, letter), UNIQUE(championship_id, registration_token)
      )`,
      `CREATE TABLE IF NOT EXISTS event_slots (
        championship_id TEXT NOT NULL REFERENCES championships(id), id TEXT NOT NULL,
        position INTEGER NOT NULL, category TEXT NOT NULL CHECK(category IN ('race','solo','team')),
        PRIMARY KEY(championship_id, id), UNIQUE(championship_id, position)
      )`,
      `CREATE TABLE IF NOT EXISTS slot_participants (
        championship_id TEXT NOT NULL, slot_id TEXT NOT NULL, player_id TEXT NOT NULL,
        controller INTEGER NOT NULL CHECK(controller BETWEEN 1 AND 4), side TEXT CHECK(side IN ('cops','robbers')),
        PRIMARY KEY(championship_id, slot_id, player_id), UNIQUE(championship_id, slot_id, controller),
        FOREIGN KEY(championship_id, slot_id) REFERENCES event_slots(championship_id, id),
        FOREIGN KEY(championship_id, player_id) REFERENCES championship_players(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS event_rounds (
        championship_id TEXT NOT NULL, id TEXT NOT NULL, slot_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('race','balloon','coin','renegade')), round_order INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), winning_side TEXT CHECK(winning_side IN ('cops','robbers')),
        PRIMARY KEY(championship_id, id), UNIQUE(championship_id, slot_id, id), UNIQUE(championship_id, slot_id, round_order),
        FOREIGN KEY(championship_id, slot_id) REFERENCES event_slots(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS round_results (
        championship_id TEXT NOT NULL, round_id TEXT NOT NULL, slot_id TEXT NOT NULL,
        player_id TEXT NOT NULL, rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 4),
        score_units INTEGER NOT NULL CHECK(score_units >= 0 AND typeof(score_units) = 'integer'),
        PRIMARY KEY(championship_id, round_id, player_id),
        FOREIGN KEY(championship_id, slot_id, round_id) REFERENCES event_rounds(championship_id, slot_id, id),
        FOREIGN KEY(championship_id, slot_id, player_id) REFERENCES slot_participants(championship_id, slot_id, player_id)
      )`,
      'INSERT OR IGNORE INTO championship_app_state (id, championship_id) VALUES (1, NULL)'
    ];
    for (const statement of statements) await tx.run(statement);
  });
}

module.exports = { initializeChampionshipSchema };
