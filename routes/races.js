const express = require('express');
const router = express.Router();
const { run, get, all, transaction } = require('../database');

/**
 * Get points mapping based on players per race
 * @param {number} playersPerRace - Number of players (2 or 4)
 * @returns {Object} Points mapping by position
 */
function getPointsMap(playersPerRace) {
  return playersPerRace === 2
    ? { 1: 25, 2: 18 }
    : { 1: 25, 2: 18, 3: 15, 4: 12 };
}

// GET /api/races - Get all races with participants
router.get('/', async (req, res) => {
  try {
    // Get all races
    const raceRows = await all('SELECT race_number, completed, is_battle FROM races ORDER BY race_number');
    
    // For each race, get participants from junction table
    const formattedRaces = [];
    
    for (const raceRow of raceRows) {
      const participants = await all(`
        SELECT p.id, p.name, p.player_letter as letter
        FROM race_participants rp
        JOIN players p ON rp.player_id = p.id
        WHERE rp.race_number = ?
        ORDER BY rp.slot_position
      `, [raceRow.race_number]);
      
      formattedRaces.push({
        race_number: raceRow.race_number,
        completed: Boolean(raceRow.completed),
        is_battle: Boolean(raceRow.is_battle),
        participants
      });
    }
    
    res.json({ races: formattedRaces });
  } catch (error) {
    console.error('Error fetching races:', error);
    res.status(500).json({ error: 'Failed to fetch races' });
  }
});

// POST /result - Submit race results (protected)
async function submitRaceResult(req, res) {
  try {
    const { race_number, placements } = req.body;
    
    // Validation
    if (!race_number || !placements) {
      return res.status(400).json({ error: 'race_number and placements are required' });
    }
    
    // Get tournament config for players_per_race
    const tournament = await get('SELECT players_per_race FROM tournament WHERE id = 1');
    const playersPerRace = tournament?.players_per_race || 4;
    const pointsMap = getPointsMap(playersPerRace);
    
    if (!Array.isArray(placements)) {
      return res.status(400).json({ error: 'placements must be an array' });
    }
    
    if (placements.length !== playersPerRace) {
      return res.status(400).json({ 
        error: `placements must contain exactly ${playersPerRace} players`,
        expected: playersPerRace,
        received: placements.length
      });
    }
    
    // Check race exists
    const race = await get('SELECT * FROM races WHERE race_number = ?', [race_number]);
    
    if (!race) {
      return res.status(404).json({ error: `Race ${race_number} not found` });
    }
    
    if (race.completed) {
      return res.status(409).json({ error: `Race ${race_number} is already completed` });
    }
    
    // Handle battle games (no points, just mark complete)
    if (race.is_battle) {
      await transaction(async tx => {
        await tx.run('UPDATE races SET completed = 1 WHERE race_number = ?', [race_number]);
      });
      
      return res.json({
        success: true,
        message: `Battle game ${race_number} marked complete`,
        is_battle: true
      });
    }
    
    // Verify placements match race participants (use junction table)
    const raceParticipantRows = await all(
      'SELECT player_id FROM race_participants WHERE race_number = ? ORDER BY player_id',
      [race_number]
    );
    
    if (raceParticipantRows.length === 0) {
      return res.status(404).json({ error: `No participants found for race ${race_number}` });
    }
    
    const raceParticipants = raceParticipantRows.map(r => r.player_id).sort((a, b) => a - b);
    const placementIds = placements.map(p => p.player_id).sort((a, b) => a - b);
    
    if (JSON.stringify(raceParticipants) !== JSON.stringify(placementIds)) {
      return res.status(400).json({ 
        error: `placements must include exactly the ${playersPerRace} players in this race`,
        expected: raceParticipants,
        received: placementIds
      });
    }
    
    // Verify no duplicate positions
    const positions = placements.map(p => p.position);
    if (new Set(positions).size !== playersPerRace || !positions.every(p => p >= 1 && p <= playersPerRace)) {
      return res.status(400).json({ 
        error: `positions must be unique and between 1-${playersPerRace}` 
      });
    }
    
    // Insert results in a transaction
    await transaction(async tx => {
      for (const placement of placements) {
        const points = pointsMap[placement.position];
        
        await tx.run(
          'INSERT INTO results (race_number, player_id, position, points) VALUES (?, ?, ?, ?)',
          [race_number, placement.player_id, placement.position, points]
        );
      }
      
      // Mark race as completed
      await tx.run(
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
}

module.exports = router;
module.exports.submitRaceResult = submitRaceResult;
