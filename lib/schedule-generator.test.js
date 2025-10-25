/**
 * Test suite for schedule-generator.js
 * Run with: node lib/schedule-generator.test.js
 */

const assert = require('assert');
const { generateSchedule, validateSchedule, SLOTS_PER_RACE, RACES_PER_PLAYER } = require('./schedule-generator');

console.log('🏁 Running Schedule Generator Tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   ${error.message}`);
    failed++;
  }
}

// Test 1: Generate schedule for 8 players
test('Generate schedule for 8 players', () => {
  const schedule = generateSchedule(8);
  assert.strictEqual(schedule.length, 8, 'Should have 8 races');
  
  schedule.forEach(race => {
    assert.strictEqual(race.letters.length, 4, `Race ${race.race_number} should have 4 players`);
  });
});

// Test 2: Generate schedule for 9 players
test('Generate schedule for 9 players', () => {
  const schedule = generateSchedule(9);
  assert.strictEqual(schedule.length, 9, 'Should have 9 races');
  
  schedule.forEach(race => {
    assert.strictEqual(race.letters.length, 4, `Race ${race.race_number} should have 4 players`);
  });
});

// Test 3: Generate schedule for 10 players
test('Generate schedule for 10 players', () => {
  const schedule = generateSchedule(10);
  assert.strictEqual(schedule.length, 10, 'Should have 10 races');
  
  schedule.forEach(race => {
    assert.strictEqual(race.letters.length, 4, `Race ${race.race_number} should have 4 players`);
  });
});

// Test 4: Reject invalid player counts
test('Reject invalid player counts', () => {
  assert.throws(() => generateSchedule(7), /Unsupported player count/);
  assert.throws(() => generateSchedule(11), /Unsupported player count/);
  assert.throws(() => generateSchedule(6), /Unsupported player count/);
});

// Test 5: Validate 8-player schedule
test('Validate 8-player schedule', () => {
  const schedule = generateSchedule(8);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const validation = validateSchedule(schedule, letters);
  
  assert.strictEqual(validation.ok, true, `Validation failed: ${validation.errors.join(', ')}`);
  assert.strictEqual(validation.metrics.totalRaces, 8);
  assert.strictEqual(validation.metrics.playerCount, 8);
  assert.strictEqual(validation.metrics.minAppearances, 4);
  assert.strictEqual(validation.metrics.maxAppearances, 4);
  assert.strictEqual(validation.metrics.appearanceVariance, 0);
});

// Test 6: Validate 9-player schedule
test('Validate 9-player schedule', () => {
  const schedule = generateSchedule(9);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const validation = validateSchedule(schedule, letters);
  
  assert.strictEqual(validation.ok, true, `Validation failed: ${validation.errors.join(', ')}`);
  assert.strictEqual(validation.metrics.totalRaces, 9);
  assert.strictEqual(validation.metrics.playerCount, 9);
  assert.strictEqual(validation.metrics.minAppearances, 4);
  assert.strictEqual(validation.metrics.maxAppearances, 4);
  assert.strictEqual(validation.metrics.appearanceVariance, 0);
});

// Test 7: Validate 10-player schedule
test('Validate 10-player schedule', () => {
  const schedule = generateSchedule(10);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const validation = validateSchedule(schedule, letters);
  
  assert.strictEqual(validation.ok, true, `Validation failed: ${validation.errors.join(', ')}`);
  assert.strictEqual(validation.metrics.totalRaces, 10);
  assert.strictEqual(validation.metrics.playerCount, 10);
  assert.strictEqual(validation.metrics.minAppearances, 4);
  assert.strictEqual(validation.metrics.maxAppearances, 4);
  assert.strictEqual(validation.metrics.appearanceVariance, 0);
});

// Test 8: Each player appears exactly 4 times
test('Each player races exactly 4 times (8 players)', () => {
  const schedule = generateSchedule(8);
  const appearances = {};
  
  for (const race of schedule) {
    for (const letter of race.letters) {
      appearances[letter] = (appearances[letter] || 0) + 1;
    }
  }
  
  Object.values(appearances).forEach(count => {
    assert.strictEqual(count, 4, `Every player should race exactly 4 times`);
  });
});

// Test 9: No duplicate players in a single race
test('No duplicate players in any race', () => {
  const schedule = generateSchedule(9);
  
  for (const race of schedule) {
    const unique = new Set(race.letters);
    assert.strictEqual(unique.size, 4, `Race ${race.race_number} has duplicate players`);
  }
});

// Test 10: All letters are valid
test('All letters are within valid range', () => {
  const schedule = generateSchedule(10);
  const validLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  
  for (const race of schedule) {
    for (const letter of race.letters) {
      assert.ok(validLetters.includes(letter), `Invalid letter ${letter} in race ${race.race_number}`);
    }
  }
});

// Test 11: Pair repeat minimization (check that repeats are reasonable)
test('Pair repeats are minimized', () => {
  const schedule = generateSchedule(9);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const validation = validateSchedule(schedule, letters);
  
  // With 9 players and 4 per race, some repeats are unavoidable
  // Mathematical minimum is around 1-2, practical algorithms may allow up to 3
  assert.ok(validation.metrics.maxPairRepeats <= 3, 
    `Max pair repeats (${validation.metrics.maxPairRepeats}) exceeds threshold`);
});

// Test 12: Deterministic generation (same input = same output)
test('Schedule generation is deterministic', () => {
  const schedule1 = generateSchedule(8);
  const schedule2 = generateSchedule(8);
  
  assert.deepStrictEqual(schedule1, schedule2, 'Same input should produce same schedule');
});

// Test 13: Detailed metrics for 9 players (display only)
test('Display detailed metrics for 9-player schedule', () => {
  const schedule = generateSchedule(9);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const validation = validateSchedule(schedule, letters);
  
  console.log('\n   📊 9-Player Schedule Metrics:');
  console.log(`      Total Races: ${validation.metrics.totalRaces}`);
  console.log(`      Player Count: ${validation.metrics.playerCount}`);
  console.log(`      Min Appearances: ${validation.metrics.minAppearances}`);
  console.log(`      Max Appearances: ${validation.metrics.maxAppearances}`);
  console.log(`      Appearance Variance: ${validation.metrics.appearanceVariance}`);
  console.log(`      Max Pair Repeats: ${validation.metrics.maxPairRepeats}`);
  console.log(`      Max Back-to-Back: ${validation.metrics.maxBackToBack}`);
  
  assert.ok(true); // Always passes, just for display
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}

console.log('🎉 All tests passed!\n');
