const express = require('express');
const router = express.Router();
const { run, get, all } = require('../database');

// POST /api/players/register - Register a new player
router.post('/register', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Get tournament info for player count
    const tournament = await get('SELECT player_count FROM tournament WHERE id = 1');
    const playerCount = tournament?.player_count || 9;
    
    // Count registered and total players
    const playerStats = await get(
      'SELECT COUNT(*) as total, SUM(CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END) as registered FROM players'
    );
    
    // Find next available player slot (where name is NULL)
    const availablePlayer = await get(
      'SELECT id, player_letter FROM players WHERE name IS NULL ORDER BY player_letter LIMIT 1'
    );
    
    if (!availablePlayer) {
      return res.status(409).json({ 
        error: `All player slots are full (${playerStats.registered}/${playerCount} registered)` 
      });
    }
    
    // Update player with name
    await run(
      'UPDATE players SET name = ? WHERE id = ?',
      [name.trim(), availablePlayer.id]
    );
    
    // Fetch updated player
    const player = await get('SELECT * FROM players WHERE id = ?', [availablePlayer.id]);
    
    res.json({
      success: true,
      player: {
        id: player.id,
        name: player.name,
        letter: player.player_letter
      },
      message: `Welcome ${player.name}! You are Player ${player.player_letter}`
    });
  } catch (error) {
    console.error('Error registering player:', error);
    res.status(500).json({ error: 'Failed to register player' });
  }
});

// GET /api/players - List all players
router.get('/', async (req, res) => {
  try {
    const players = await all('SELECT id, name, player_letter FROM players ORDER BY player_letter');
    
    const registered = players.filter(p => p.name !== null);
    const available = players.filter(p => p.name === null).length;
    
    res.json({
      players: registered,
      total: players.length,
      registered: registered.length,
      available
    });
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// GET /api/schedule/:playerId - Get race schedule for a specific player
router.get('/schedule/:playerId', async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId);
    
    if (isNaN(playerId)) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }
    
    // Get player info
    const player = await get('SELECT * FROM players WHERE id = ?', [playerId]);
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Get races for this player using junction table
    const raceNumbers = await all(`
      SELECT DISTINCT race_number
      FROM race_participants
      WHERE player_id = ?
      ORDER BY race_number
    `, [playerId]);
    
    // Format races with opponents
    const schedule = [];
    
    for (const { race_number } of raceNumbers) {
      // Get race completion status
      const raceInfo = await get('SELECT completed FROM races WHERE race_number = ?', [race_number]);
      
      // Get all participants for this race
      const participants = await all(`
        SELECT p.id, p.name, p.player_letter as letter
        FROM race_participants rp
        JOIN players p ON rp.player_id = p.id
        WHERE rp.race_number = ?
        ORDER BY rp.slot_position
      `, [race_number]);
      
      // Filter out current player to get opponents
      const opponents = participants.filter(p => p.id !== playerId);
      
      schedule.push({
        race_number,
        completed: Boolean(raceInfo?.completed),
        opponents
      });
    }
    
    // Get player's current stats
    const stats = await get(`
      SELECT 
        COALESCE(SUM(points), 0) as total_points,
        COALESCE(SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END), 0) as firsts,
        COALESCE(SUM(CASE WHEN position = 2 THEN 1 ELSE 0 END), 0) as seconds,
        COALESCE(SUM(CASE WHEN position = 3 THEN 1 ELSE 0 END), 0) as thirds,
        COALESCE(SUM(CASE WHEN position = 4 THEN 1 ELSE 0 END), 0) as fourths
      FROM results
      WHERE player_id = ?
    `, [playerId]);
    
    res.json({
      player: {
        id: player.id,
        name: player.name,
        letter: player.player_letter
      },
      schedule,
      stats: {
        total_points: stats.total_points,
        races_completed: schedule.filter(r => r.completed).length,
        total_races: schedule.length,
        firsts: stats.firsts,
        seconds: stats.seconds,
        thirds: stats.thirds,
        fourths: stats.fourths
      }
    });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// GET /api/leaderboard - Get current standings
router.get('/leaderboard', async (req, res) => {
  try {
    const leaderboard = await all(`
      SELECT 
        p.id,
        p.name,
        p.player_letter,
        COALESCE(SUM(r.points), 0) as total_points,
        COALESCE(SUM(CASE WHEN r.position = 1 THEN 1 ELSE 0 END), 0) as firsts,
        COALESCE(SUM(CASE WHEN r.position = 2 THEN 1 ELSE 0 END), 0) as seconds,
        COALESCE(SUM(CASE WHEN r.position = 3 THEN 1 ELSE 0 END), 0) as thirds,
        COALESCE(SUM(CASE WHEN r.position = 4 THEN 1 ELSE 0 END), 0) as fourths
      FROM players p
      LEFT JOIN results r ON p.id = r.player_id
      WHERE p.name IS NOT NULL
      GROUP BY p.id, p.name, p.player_letter
      ORDER BY 
        total_points DESC,
        firsts DESC,
        seconds DESC,
        thirds DESC,
        fourths DESC,
        p.player_letter ASC
    `);
    
    // Add ranking
    const standings = leaderboard.map((player, index) => ({
      rank: index + 1,
      ...player
    }));
    
    res.json({ standings });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
