async function installLegacyTournament(database) {
  await database.run('CREATE TABLE tournament (id INTEGER PRIMARY KEY, status TEXT, winner_id INTEGER, created_at TEXT, completed_at TEXT)');
  await database.run("INSERT INTO tournament VALUES (1, 'completed', 1, '2025-10-01', '2025-10-02')");
  await database.run('CREATE TABLE players (id INTEGER PRIMARY KEY, player_letter TEXT UNIQUE, name TEXT, created_at TEXT)');
  for (let i = 1; i <= 4; i++) await database.run('INSERT INTO players VALUES (?, ?, ?, ?)', [i, 'ABCD'[i - 1], `Legacy ${i}`, '2025-10-01']);
  await database.run('CREATE TABLE races (race_number INTEGER PRIMARY KEY, player1_id INTEGER, player2_id INTEGER, player3_id INTEGER, player4_id INTEGER, completed INTEGER, created_at TEXT, completed_at TEXT)');
  await database.run("INSERT INTO races VALUES (1, 1, 2, 3, 4, 1, '2025-10-01', '2025-10-02')");
  await database.run('CREATE TABLE results (id INTEGER PRIMARY KEY, race_number INTEGER, player_id INTEGER, position INTEGER, points INTEGER, created_at TEXT, UNIQUE(race_number, player_id))');
  for (let i = 1; i <= 4; i++) await database.run('INSERT INTO results VALUES (?, 1, ?, ?, ?, ?)', [i, i, i, [25, 18, 15, 12][i - 1], '2025-10-02']);
}

module.exports = { installLegacyTournament };
