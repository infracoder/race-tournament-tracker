async function initializeChampionshipSchema(database) {
  await database.transaction(async (tx) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS championships (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, seed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'registration' CHECK(status IN ('registration','running','awaiting_champion','completed')),
        paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
        cursor INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
        winner_id TEXT, winner_source TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
        first_completed_at TEXT,
        FOREIGN KEY(id, winner_id) REFERENCES championship_players(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS championship_app_state (
        id INTEGER PRIMARY KEY CHECK(id = 1), championship_id TEXT REFERENCES championships(id)
      )`,
      `CREATE TABLE IF NOT EXISTS championship_players (
        championship_id TEXT NOT NULL REFERENCES championships(id), id TEXT NOT NULL,
        letter TEXT NOT NULL, name TEXT, registration_token TEXT, withdrawn_at TEXT,
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
      `CREATE TABLE IF NOT EXISTS championship_prize_settings (
        championship_id TEXT PRIMARY KEY REFERENCES championships(id),
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), currency TEXT NOT NULL,
        first_cents INTEGER NOT NULL, second_cents INTEGER NOT NULL,
        third_cents INTEGER NOT NULL, participation_cents INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS championship_prize_vendors (
        championship_id TEXT NOT NULL REFERENCES championships(id), id TEXT NOT NULL,
        name TEXT NOT NULL, position INTEGER NOT NULL,
        artwork BLOB CHECK(artwork IS NULL OR length(artwork) <= 1048576), artwork_type TEXT,
        PRIMARY KEY(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS championship_prize_awards (
        championship_id TEXT NOT NULL, player_id TEXT NOT NULL,
        place INTEGER NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
        reveal_id TEXT NOT NULL, vendor_id TEXT,
        kind TEXT NOT NULL DEFAULT 'placement' CHECK(kind IN ('placement','consolation')),
        PRIMARY KEY(championship_id, player_id),
        FOREIGN KEY(championship_id, player_id) REFERENCES championship_players(championship_id, id),
        FOREIGN KEY(championship_id, vendor_id) REFERENCES championship_prize_vendors(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS prize_defaults (
        id INTEGER PRIMARY KEY CHECK(id = 1), settings TEXT NOT NULL,
        saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS prize_default_vendors (
        position INTEGER PRIMARY KEY, name TEXT NOT NULL,
        artwork BLOB CHECK(artwork IS NULL OR length(artwork) <= 1048576), artwork_type TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS championship_clocks (
        championship_id TEXT PRIMARY KEY REFERENCES championships(id), started_at INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL DEFAULT 0, running_since INTEGER,
        slot_id TEXT, event_elapsed_ms INTEGER NOT NULL DEFAULT 0, event_running_since INTEGER,
        FOREIGN KEY(championship_id, slot_id) REFERENCES event_slots(championship_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS championship_prize_fulfillments (
        championship_id TEXT NOT NULL, player_id TEXT NOT NULL, reveal_id TEXT NOT NULL,
        vendor_name TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','purchased','delivered')),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(championship_id, player_id, reveal_id),
        FOREIGN KEY(championship_id, player_id) REFERENCES championship_players(championship_id, id)
      )`,
      'INSERT OR IGNORE INTO championship_app_state (id, championship_id) VALUES (1, NULL)'
    ];
    for (const statement of statements) await tx.run(statement);
    for (const [table, column, definition] of [
      ['championships', 'first_completed_at', 'TEXT'],
      ['championship_players', 'withdrawn_at', 'TEXT'],
      ['championship_prize_awards', 'kind', "TEXT NOT NULL DEFAULT 'placement' CHECK(kind IN ('placement','consolation'))"]
    ]) {
      const columns = await tx.all(`PRAGMA table_info(${table})`);
      if (!columns.some((c) => c.name === column))
        await tx.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    await tx.run(`UPDATE championships SET first_completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
      WHERE status = 'completed' AND first_completed_at IS NULL`);
  });
}

module.exports = { initializeChampionshipSchema };
