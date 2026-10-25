const express = require('express');
function createRouter(database) {
  const router = express.Router();
  const { get, all } = database;

  // GET /api/battle/current - Get current active battle game
  router.get('/current', async (req, res) => {
    try {
      // Find the next uncompleted race
      const nextRace = await get('SELECT MIN(race_number) AS rn FROM races WHERE completed = 0');

      if (!nextRace || !nextRace.rn) {
        return res.json({ is_active: false });
      }

      const raceNumber = nextRace.rn;

      // Check if it's a battle
      const race = await get('SELECT is_battle FROM races WHERE race_number = ?', [raceNumber]);

      if (!race || !race.is_battle) {
        return res.json({ is_active: false });
      }

      // Get battle details
      const battle = await get(
        `
      SELECT 
        bg.race_number,
        bg.stage_name,
        bg.player1_id,
        bg.player2_id,
        bg.player3_id,
        bg.player4_id
      FROM battle_games bg
      WHERE bg.race_number = ?
    `,
        [raceNumber]
      );

      if (!battle) {
        return res.json({ is_active: false });
      }

      // Get player details
      const playerIds = [battle.player1_id, battle.player2_id, battle.player3_id, battle.player4_id];
      const players = [];

      for (const playerId of playerIds) {
        const player = await get('SELECT id, name, player_letter as letter FROM players WHERE id = ?', [
          playerId
        ]);
        if (player) {
          players.push(player);
        }
      }

      res.json({
        is_active: true,
        race_number: battle.race_number,
        stage_name: battle.stage_name,
        players
      });
    } catch (error) {
      console.error('Error fetching current battle:', error);
      res.status(500).json({ error: 'Failed to fetch current battle' });
    }
  });

  // GET /api/battle/by-race/:raceNumber - Get battle details for a specific race
  router.get('/by-race/:raceNumber', async (req, res) => {
    try {
      const raceNumber = parseInt(req.params.raceNumber, 10);

      if (isNaN(raceNumber)) {
        return res.status(400).json({ error: 'Invalid race number' });
      }

      // Check if race is a battle
      const race = await get('SELECT is_battle FROM races WHERE race_number = ?', [raceNumber]);

      if (!race || !race.is_battle) {
        return res.status(404).json({ error: 'Race is not a battle game' });
      }

      // Get battle details
      const battle = await get(
        `
      SELECT 
        bg.race_number,
        bg.stage_name,
        bg.player1_id,
        bg.player2_id,
        bg.player3_id,
        bg.player4_id
      FROM battle_games bg
      WHERE bg.race_number = ?
    `,
        [raceNumber]
      );

      if (!battle) {
        return res.status(404).json({ error: 'Battle game not found' });
      }

      // Get player details
      const playerIds = [battle.player1_id, battle.player2_id, battle.player3_id, battle.player4_id];
      const players = [];

      for (const playerId of playerIds) {
        const player = await get('SELECT id, name, player_letter as letter FROM players WHERE id = ?', [
          playerId
        ]);
        if (player) {
          players.push(player);
        }
      }

      res.json({
        race_number: battle.race_number,
        stage_name: battle.stage_name,
        players
      });
    } catch (error) {
      console.error('Error fetching battle details:', error);
      res.status(500).json({ error: 'Failed to fetch battle details' });
    }
  });

  return router;
}
module.exports = createRouter;
