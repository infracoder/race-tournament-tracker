/**
 * Dynamic Schedule Generator for Mario Kart Tournament
 * 
 * Generates fair racing schedules for 8-10 players with:
 * - 4 players per race
 * - Each player racing exactly 4 times
 * - Minimized repeated pairings
 * - Balanced distribution
 */

const SLOTS_PER_RACE = 4;
const RACES_PER_PLAYER = 4;

/**
 * Generate a balanced tournament schedule
 * @param {number} playerCount - Number of players (8, 9, or 10)
 * @param {Object} options - Optional configuration
 * @returns {Array<{race_number: number, letters: string[]}>} Generated schedule
 */
function generateSchedule(playerCount, options = {}) {
  // Validate input
  if (![8, 9, 10].includes(playerCount)) {
    throw new Error(`Unsupported player count: ${playerCount}. Must be 8, 9, or 10.`);
  }

  const totalRaces = playerCount; // 8 players → 8 races, etc.
  const letters = generateLetters(playerCount);
  
  // Initialize tracking structures
  const racesRemaining = {};
  letters.forEach(letter => racesRemaining[letter] = RACES_PER_PLAYER);
  
  // Track pairings to minimize repeats (adjacency matrix)
  const pairCounts = initializePairCounts(letters);
  
  // Track last race appearance for back-to-back avoidance
  const lastRaceAppearance = {};
  letters.forEach(letter => lastRaceAppearance[letter] = -1);
  
  const schedule = [];
  
  // Generate each race using greedy selection with scoring
  for (let raceNum = 1; raceNum <= totalRaces; raceNum++) {
    const eligible = letters.filter(l => racesRemaining[l] > 0);
    
    if (eligible.length < SLOTS_PER_RACE) {
      throw new Error(`Schedule generation failed at race ${raceNum}: insufficient eligible players`);
    }
    
    // Find best combination of 4 players
    const bestCombo = selectBestCombination(
      eligible,
      raceNum,
      pairCounts,
      lastRaceAppearance,
      racesRemaining
    );
    
    if (!bestCombo) {
      throw new Error(`Schedule generation failed at race ${raceNum}: no valid combination found`);
    }
    
    // Add race to schedule
    schedule.push({
      race_number: raceNum,
      letters: bestCombo
    });
    
    // Update tracking structures
    bestCombo.forEach(letter => {
      racesRemaining[letter]--;
      lastRaceAppearance[letter] = raceNum;
    });
    
    // Update pair counts
    for (let i = 0; i < bestCombo.length; i++) {
      for (let j = i + 1; j < bestCombo.length; j++) {
        const key = getPairKey(bestCombo[i], bestCombo[j]);
        pairCounts[key]++;
      }
    }
  }
  
  return schedule;
}

/**
 * Select the best combination of 4 players for current race
 */
function selectBestCombination(eligible, raceNum, pairCounts, lastRaceAppearance, racesRemaining) {
  const combinations = getCombinations(eligible, SLOTS_PER_RACE);
  
  if (combinations.length === 0) {
    return null;
  }
  
  let bestCombo = null;
  let bestScore = Infinity;
  
  for (const combo of combinations) {
    const score = scoreCombination(combo, raceNum, pairCounts, lastRaceAppearance, racesRemaining);
    
    if (score < bestScore) {
      bestScore = score;
      bestCombo = combo;
    }
  }
  
  return bestCombo;
}

/**
 * Score a combination (lower is better)
 */
function scoreCombination(combo, raceNum, pairCounts, lastRaceAppearance, racesRemaining) {
  let score = 0;
  
  // Penalty for repeated pairings
  for (let i = 0; i < combo.length; i++) {
    for (let j = i + 1; j < combo.length; j++) {
      const key = getPairKey(combo[i], combo[j]);
      const pairCount = pairCounts[key] || 0;
      score += pairCount * 10; // Heavy penalty for repeats
    }
  }
  
  // Penalty for back-to-back appearances
  for (const letter of combo) {
    if (lastRaceAppearance[letter] === raceNum - 1) {
      score += 5; // Moderate penalty for consecutive races
    }
  }
  
  // Penalty for imbalance (prefer players with more races remaining)
  const avgRemaining = combo.reduce((sum, l) => sum + racesRemaining[l], 0) / combo.length;
  const totalRemaining = Object.values(racesRemaining).reduce((a, b) => a + b, 0);
  const targetAvg = totalRemaining / Object.keys(racesRemaining).length;
  score += Math.abs(avgRemaining - targetAvg) * 2;
  
  return score;
}

/**
 * Generate all combinations of size k from array
 */
function getCombinations(arr, k) {
  if (k === 1) return arr.map(x => [x]);
  if (k === arr.length) return [arr];
  
  const result = [];
  
  function backtrack(start, current) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  
  backtrack(0, []);
  return result;
}

/**
 * Initialize pair counts matrix
 */
function initializePairCounts(letters) {
  const pairCounts = {};
  for (let i = 0; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      const key = getPairKey(letters[i], letters[j]);
      pairCounts[key] = 0;
    }
  }
  return pairCounts;
}

/**
 * Get consistent pair key for two letters
 */
function getPairKey(letter1, letter2) {
  return letter1 < letter2 ? `${letter1}-${letter2}` : `${letter2}-${letter1}`;
}

/**
 * Generate letter array based on player count
 */
function generateLetters(playerCount) {
  const letters = [];
  for (let i = 0; i < playerCount; i++) {
    letters.push(String.fromCharCode(65 + i)); // A=65
  }
  return letters;
}

/**
 * Validate a generated schedule
 * @param {Array} schedule - Schedule to validate
 * @param {Array} letters - Expected player letters
 * @param {number} minRacesPerPlayer - Minimum races each player should have
 * @returns {Object} Validation result with metrics
 */
function validateSchedule(schedule, letters, minRacesPerPlayer = RACES_PER_PLAYER) {
  const errors = [];
  const appearances = {};
  const pairCounts = {};
  let maxBackToBack = 0;
  
  // Initialize tracking
  letters.forEach(letter => appearances[letter] = []);
  
  // Validate each race
  for (const race of schedule) {
    const { race_number, letters: raceLetters } = race;
    
    // Check race has exactly 4 players
    if (raceLetters.length !== SLOTS_PER_RACE) {
      errors.push(`Race ${race_number} has ${raceLetters.length} players (expected ${SLOTS_PER_RACE})`);
    }
    
    // Check for duplicates within race
    if (new Set(raceLetters).size !== raceLetters.length) {
      errors.push(`Race ${race_number} has duplicate players: ${raceLetters.join(', ')}`);
    }
    
    // Check for invalid letters
    for (const letter of raceLetters) {
      if (!letters.includes(letter)) {
        errors.push(`Race ${race_number} contains invalid letter: ${letter}`);
      } else {
        appearances[letter].push(race_number);
      }
    }
    
    // Track pair counts
    for (let i = 0; i < raceLetters.length; i++) {
      for (let j = i + 1; j < raceLetters.length; j++) {
        const key = getPairKey(raceLetters[i], raceLetters[j]);
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  }
  
  // Check each player's race count
  for (const letter of letters) {
    const count = appearances[letter].length;
    if (count < minRacesPerPlayer) {
      errors.push(`Player ${letter} races only ${count} times (minimum ${minRacesPerPlayer})`);
    }
    
    // Check for back-to-back races
    const races = appearances[letter];
    let backToBackCount = 0;
    for (let i = 1; i < races.length; i++) {
      if (races[i] === races[i-1] + 1) {
        backToBackCount++;
      }
    }
    maxBackToBack = Math.max(maxBackToBack, backToBackCount);
  }
  
  // Calculate metrics
  const appearanceCounts = letters.map(l => appearances[l].length);
  const minAppearances = Math.min(...appearanceCounts);
  const maxAppearances = Math.max(...appearanceCounts);
  const pairRepeatCounts = Object.values(pairCounts);
  const maxPairRepeats = pairRepeatCounts.length > 0 ? Math.max(...pairRepeatCounts) : 0;
  
  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      totalRaces: schedule.length,
      playerCount: letters.length,
      appearances,
      minAppearances,
      maxAppearances,
      appearanceVariance: maxAppearances - minAppearances,
      maxPairRepeats,
      maxBackToBack,
      pairCounts
    }
  };
}

module.exports = {
  generateSchedule,
  validateSchedule,
  SLOTS_PER_RACE,
  RACES_PER_PLAYER
};
