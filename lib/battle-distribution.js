/**
 * Battle Distribution Utilities
 * 
 * Functions for randomly selecting battle game slots and players
 * with non-consecutive race numbers and unique player assignments.
 */

/**
 * Fisher-Yates shuffle algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} - Shuffled array
 */
function shuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Check if array has consecutive numbers
 * @param {number[]} numbers - Array of numbers
 * @returns {boolean} - True if any consecutive numbers exist
 */
function hasConsecutive(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) {
      return true;
    }
  }
  return false;
}

/**
 * Pick non-consecutive race slots for battle games
 * @param {number} totalRaces - Total number of races in tournament
 * @param {number} count - Number of battle slots to pick (default 3)
 * @param {number} minSlot - Minimum race number (inclusive, default 2)
 * @param {number} maxSlot - Maximum race number (inclusive, default totalRaces - 1)
 * @returns {number[]} - Array of race numbers for battles
 */
function pickNonConsecutiveSlots(totalRaces, count = 3, minSlot = 2, maxSlot = null) {
  if (maxSlot === null) {
    maxSlot = totalRaces - 1;
  }
  
  // Validate inputs
  if (minSlot < 1 || maxSlot > totalRaces) {
    throw new Error(`Invalid slot range: [${minSlot}, ${maxSlot}] for ${totalRaces} races`);
  }
  
  const availableSlots = [];
  for (let i = minSlot; i <= maxSlot; i++) {
    availableSlots.push(i);
  }
  
  if (availableSlots.length < count) {
    throw new Error(`Not enough slots available. Need ${count}, have ${availableSlots.length}`);
  }
  
  // Try up to 100 times to find non-consecutive slots
  const maxAttempts = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffled = shuffle(availableSlots);
    const selected = shuffled.slice(0, count);
    
    if (!hasConsecutive(selected)) {
      return selected.sort((a, b) => a - b);
    }
  }
  
  // Fallback: greedy spacing algorithm
  console.warn('⚠️  Using fallback greedy spacing for battle slots');
  const result = [];
  const step = Math.floor((maxSlot - minSlot + 1) / (count + 1));
  
  for (let i = 0; i < count; i++) {
    result.push(minSlot + step * (i + 1));
  }
  
  return result;
}

/**
 * Select players randomly for battle games
 * @param {number[]} allPlayerIds - Array of all player IDs
 * @param {number} numBattles - Number of battles (default 3)
 * @param {number} playersPerBattle - Players per battle (default 4)
 * @returns {number[][]} - Array of battle rosters, each containing player IDs
 */
function selectBattlePlayersRandom(allPlayerIds, numBattles = 3, playersPerBattle = 4) {
  if (allPlayerIds.length < playersPerBattle) {
    throw new Error(`Not enough players. Need at least ${playersPerBattle}, have ${allPlayerIds.length}`);
  }
  
  const rosters = [];
  const seenRosters = new Set();
  
  for (let i = 0; i < numBattles; i++) {
    let roster;
    let attempts = 0;
    const maxAttempts = 10;
    
    // Try to avoid duplicate rosters
    do {
      const shuffled = shuffle(allPlayerIds);
      roster = shuffled.slice(0, playersPerBattle).sort((a, b) => a - b);
      attempts++;
    } while (seenRosters.has(roster.join(',')) && attempts < maxAttempts);
    
    seenRosters.add(roster.join(','));
    rosters.push(roster);
  }
  
  return rosters;
}

/**
 * Randomly pick a stage name from available battle stages
 * @returns {string} - Stage name
 */
function pickRandomStage() {
  const stages = [
    'Battle Stadium',
    'Sweet Sweet Kingdom',
    'Dragon Palace',
    'Lunar Colony'
  ];
  
  return stages[Math.floor(Math.random() * stages.length)];
}

module.exports = {
  pickNonConsecutiveSlots,
  selectBattlePlayersRandom,
  pickRandomStage,
  shuffle,
  hasConsecutive
};
