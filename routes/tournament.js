const express = require('express');
const router = express.Router();
const { run, get, all, seedTournament } = require('../database');

// POST /api/tournament/init - Initialize/reset tournament (protected)
router.post('/init', async (req, res) => {
  try {
    const { player_count } = req.body;
    
    // Validate player_count if provided
    if (player_count !== undefined && player_count !== null) {
      const count = parseInt(player_count, 10);
      if (isNaN(count) || ![8, 9, 10].includes(count)) {
        return res.status(400).json({ 
          error: 'Invalid player_count. Must be 8, 9, or 10.',
          received: player_count
        });
      }
    }
    
    await seedTournament(player_count);
    
    // Get the tournament info to return actual values
    const tournament = await get('SELECT * FROM tournament WHERE id = 1');
    
    res.json({ 
      success: true, 
      message: `Tournament initialized successfully for ${tournament.player_count} players. Ready for player registration.`,
      player_count: tournament.player_count,
      total_races: tournament.total_races
    });
  } catch (error) {
    console.error('Error initializing tournament:', error);
    res.status(500).json({ error: 'Failed to initialize tournament', details: error.message });
  }
});

// GET /api/tournament/status - Get tournament status
router.get('/status', async (req, res) => {
  try {
    const tournament = await get('SELECT * FROM tournament WHERE id = 1');
    
    if (!tournament) {
      return res.json({
        initialized: false,
        message: 'Tournament not initialized'
      });
    }
    
    const racesCompleted = await get('SELECT COUNT(*) as count FROM races WHERE completed = 1');
    
    let winner = null;
    if (tournament.winner_id) {
      winner = await get('SELECT * FROM players WHERE id = ?', [tournament.winner_id]);
    }
    
    res.json({
      status: tournament.status,
      player_count: tournament.player_count || 9,
      total_races: tournament.total_races || 9,
      races_completed: racesCompleted.count,
      winner: winner ? {
        id: winner.id,
        name: winner.name,
        letter: winner.player_letter
      } : null,
      created_at: tournament.created_at,
      completed_at: tournament.completed_at
    });
  } catch (error) {
    console.error('Error fetching tournament status:', error);
    res.status(500).json({ error: 'Failed to fetch tournament status' });
  }
});

// POST /api/tournament/complete - Declare winner (protected)
router.post('/complete', async (req, res) => {
  try {
    // Verify all races are completed
    const incomplete = await get('SELECT COUNT(*) as count FROM races WHERE completed = 0');
    
    if (incomplete.count > 0) {
      return res.status(400).json({ 
        error: 'Cannot complete tournament - not all races are finished',
        races_remaining: incomplete.count
      });
    }
    
    // Get leaderboard to determine winner
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
      GROUP BY p.id, p.name, p.player_letter
      ORDER BY 
        total_points DESC,
        firsts DESC,
        seconds DESC,
        thirds DESC,
        fourths DESC,
        p.player_letter ASC
    `);
    
    if (!leaderboard || leaderboard.length === 0) {
      return res.status(400).json({ error: 'No results found' });
    }
    
    const winner = leaderboard[0];
    
    // Update tournament
    await run(
      'UPDATE tournament SET status = ?, winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = 1',
      ['completed', winner.id]
    );
    
    res.json({
      success: true,
      message: 'Tournament completed!',
      winner: {
        id: winner.id,
        name: winner.name,
        letter: winner.player_letter,
        points: winner.total_points,
        firsts: winner.firsts
      }
    });
  } catch (error) {
    console.error('Error completing tournament:', error);
    res.status(500).json({ error: 'Failed to complete tournament' });
  }
});

module.exports = router;
