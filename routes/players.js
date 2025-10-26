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
    
    // Get races for this player
    const races = await all(`
      SELECT 
        r.race_number,
        r.completed,
        p1.id as p1_id, p1.name as p1_name, p1.player_letter as p1_letter,
        p2.id as p2_id, p2.name as p2_name, p2.player_letter as p2_letter,
        p3.id as p3_id, p3.name as p3_name, p3.player_letter as p3_letter,
        p4.id as p4_id, p4.name as p4_name, p4.player_letter as p4_letter
      FROM races r
      JOIN players p1 ON r.player1_id = p1.id
      JOIN players p2 ON r.player2_id = p2.id
      JOIN players p3 ON r.player3_id = p3.id
      JOIN players p4 ON r.player4_id = p4.id
      WHERE ? IN (r.player1_id, r.player2_id, r.player3_id, r.player4_id)
      ORDER BY r.race_number
    `, [playerId]);
    
    // Format races with opponents
    const schedule = races.map(race => {
      const participants = [
        { id: race.p1_id, name: race.p1_name, letter: race.p1_letter },
        { id: race.p2_id, name: race.p2_name, letter: race.p2_letter },
        { id: race.p3_id, name: race.p3_name, letter: race.p3_letter },
        { id: race.p4_id, name: race.p4_name, letter: race.p4_letter }
      ];
      
      const opponents = participants.filter(p => p.id !== playerId);
      
      return {
        race_number: race.race_number,
        completed: Boolean(race.completed),
        opponents
      };
    });
    
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
