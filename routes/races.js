const express = require('express');
const router = express.Router();
const { run, get, all, transaction } = require('../database');

const POINTS_MAP = {
  1: 25,
  2: 18,
  3: 15,
  4: 12
};

// GET /api/races - Get all races with participants
router.get('/', async (req, res) => {
  try {
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
      ORDER BY r.race_number
    `);
    
    const formattedRaces = races.map(race => ({
      race_number: race.race_number,
      completed: Boolean(race.completed),
      participants: [
        { id: race.p1_id, name: race.p1_name, letter: race.p1_letter },
        { id: race.p2_id, name: race.p2_name, letter: race.p2_letter },
        { id: race.p3_id, name: race.p3_name, letter: race.p3_letter },
        { id: race.p4_id, name: race.p4_name, letter: race.p4_letter }
      ]
    }));
    
    res.json({ races: formattedRaces });
  } catch (error) {
    console.error('Error fetching races:', error);
    res.status(500).json({ error: 'Failed to fetch races' });
  }
});

// POST /api/race/result - Submit race results (protected)
router.post('/result', async (req, res) => {
  try {
    const { race_number, placements } = req.body;
    
    // Validation
    if (!race_number || !placements) {
      return res.status(400).json({ error: 'race_number and placements are required' });
    }
    
    if (!Array.isArray(placements) || placements.length !== 4) {
      return res.status(400).json({ error: 'placements must be an array of 4 player IDs' });
    }
    
    // Check race exists
    const race = await get('SELECT * FROM races WHERE race_number = ?', [race_number]);
    
    if (!race) {
      return res.status(404).json({ error: `Race ${race_number} not found` });
    }
    
    if (race.completed) {
      return res.status(409).json({ error: `Race ${race_number} is already completed` });
    }
    
    // Verify placements match race participants
    const raceParticipants = [
      race.player1_id,
      race.player2_id,
      race.player3_id,
      race.player4_id
    ].sort((a, b) => a - b);
    
    const placementIds = placements.map(p => p.player_id).sort((a, b) => a - b);
    
    if (JSON.stringify(raceParticipants) !== JSON.stringify(placementIds)) {
      return res.status(400).json({ 
        error: 'placements must include exactly the 4 players in this race',
        expected: raceParticipants,
        received: placementIds
      });
    }
    
    // Verify no duplicate positions
    const positions = placements.map(p => p.position);
    if (new Set(positions).size !== 4 || !positions.every(p => p >= 1 && p <= 4)) {
      return res.status(400).json({ 
        error: 'positions must be unique and between 1-4' 
      });
    }
    
    // Insert results in a transaction
    await transaction(async () => {
      for (const placement of placements) {
        const points = POINTS_MAP[placement.position];
        
        await run(
          'INSERT INTO results (race_number, player_id, position, points) VALUES (?, ?, ?, ?)',
          [race_number, placement.player_id, placement.position, points]
        );
      }
      
      // Mark race as completed
      await run(
        'UPDATE races SET completed = 1 WHERE race_number = ?',
        [race_number]
      );
    });
    
    // Fetch results for confirmation
    const results = await all(
      'SELECT player_id, position, points FROM results WHERE race_number = ? ORDER BY position',
      [race_number]
    );
    
    res.json({
      success: true,
      message: `Race ${race_number} results recorded successfully`,
      results
    });
  } catch (error) {
    console.error('Error submitting race result:', error);
    
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ 
        error: 'Duplicate position or player in race results' 
      });
    }
    
    res.status(500).json({ error: 'Failed to submit race result', details: error.message });
  }
});

module.exports = router;
