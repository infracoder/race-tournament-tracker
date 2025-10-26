# Implementation Plan: 2 or 4 Players Per Race

**Goal:** Allow organizers to configure races with either 2 or 4 players to accommodate different TV screen sizes.

**Estimated Effort:** 1-2 days of focused development work

---

## Executive Summary

### What's Changing
- Add configurable `players_per_race` setting (2 or 4)
- Refactor database to use junction table `race_participants` for flexibility
- Create separate schedule generator for 2-player races
- Update all frontend UI to dynamically adapt to player count
- Adjust F1 scoring system for 2-player races (25, 18 points)

### Why This Matters
- **TV Size Constraints:** Smaller screens may only support 2-player split-screen Mario Kart
- **Flexibility:** Same app works for different tournament formats
- **Fairness:** Each player still races exactly 4 times with balanced scheduling

### Configuration Priority
1. Organizer selection during tournament init (via UI)
2. `PLAYERS_PER_RACE` environment variable
3. Default: 4 players per race (backward compatible)

---

## Key Technical Decisions

### 1. Database Schema Refactor
**Current:** Fixed columns `player1_id, player2_id, player3_id, player4_id` in `races` table  
**New:** Junction table `race_participants(race_number, player_id, slot_position)`

**Benefits:**
- Supports any number of players per race
- Cleaner data model
- Easier to query and validate

**Migration Strategy:**
- Add junction table alongside existing columns
- Backfill data from legacy columns on first run
- Keep legacy columns temporarily for rollback safety
- All code switches to junction table queries

### 2. Schedule Generation
**Current:** Single algorithm for 4-player races  
**New:** Dispatcher with two specialized algorithms

**4-Player Algorithm (Existing):**
- Combinatorial optimization with scoring
- Minimizes repeated pairings across 6 possible pair combinations
- Avoids back-to-back appearances

**2-Player Algorithm (New):**
- Simpler greedy pairing with fairness metrics
- Each player appears exactly 4 times
- Minimize pair repeats (max 1 repeat per pair if possible)
- Deterministic ordering for reproducibility

**Math:**
- 8 players × 4 races each ÷ 2 slots = **16 races**
- 9 players × 4 races each ÷ 2 slots = **18 races**
- 10 players × 4 races each ÷ 2 slots = **20 races**

### 3. Scoring System
**4-Player:** 25 / 18 / 15 / 12 (F1 style)  
**2-Player:** 25 / 18 (simplified F1)

Points are dynamically applied based on `players_per_race` setting.

---

## Implementation Phases

### Phase 0: Preparation
- Create feature branch: `feature/players-per-race-2-or-4`
- Set git config for repo: `git config user.email "russ@veritexai.com"`
- Review current codebase to confirm assumptions

### Phase 1: Configuration Layer
**Files:** `.env.example`, `lib/schedule-generator.js`, `database.js`

Add environment variable:
```bash
PLAYERS_PER_RACE=4  # Options: 2 or 4. Default 4. Choose 2 for smaller TV screens.
```

Create resolution helper in `database.js`:
```javascript
function resolvePlayersPerRace({ requestValue, envValue, storedValue, defaultValue = 4 }) {
  // Priority: request > env > stored > default
  // Validate: only allow 2 or 4
}
```

Update schedule generator signature:
```javascript
generateSchedule(playerCount, playersPerRace = 4)
```

### Phase 2: Database Schema - Junction Table
**File:** `database.js`

Create new table:
```sql
CREATE TABLE IF NOT EXISTS race_participants (
  race_number INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  slot_position INTEGER NOT NULL,
  PRIMARY KEY (race_number, player_id),
  UNIQUE (race_number, slot_position),
  FOREIGN KEY (race_number) REFERENCES races(race_number) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_race_participants_race ON race_participants(race_number);
CREATE INDEX IF NOT EXISTS idx_race_participants_player ON race_participants(player_id);
```

Add column to tournament:
```sql
ALTER TABLE tournament ADD COLUMN players_per_race INTEGER DEFAULT 4;
```

### Phase 2.1: Migration Logic
**File:** `database.js` in `initializeSchema()`

- Auto-detect if migration is needed
- Backfill `race_participants` from legacy `player1_id..player4_id` columns
- Keep legacy columns for rollback safety
- Idempotent: safe to run multiple times

### Phase 3: Seed Tournament Updates
**File:** `database.js` in `seedTournament()`

```javascript
async function seedTournament(playerCountParam, playersPerRaceParam) {
  const playerCount = resolvePlayerCount(playerCountParam);
  const playersPerRace = resolvePlayersPerRace({ requestValue: playersPerRaceParam });
  
  // Validate playersPerRace in [2, 4]
  if (![2, 4].includes(playersPerRace)) {
    throw new Error('Invalid players_per_race. Must be 2 or 4.');
  }
  
  // Calculate total races
  const totalRaces = (playerCount * 4) / playersPerRace;
  if (totalRaces !== Math.floor(totalRaces)) {
    throw new Error('Invalid configuration: race count must be an integer');
  }
  
  // Generate schedule
  const schedule = generateSchedule(playerCount, playersPerRace);
  
  // Insert into tournament table
  await run(
    'INSERT INTO tournament (id, status, player_count, total_races, players_per_race) VALUES (1, ?, ?, ?, ?)',
    ['initialized', playerCount, totalRaces, playersPerRace]
  );
  
  // Insert races and participants into junction table
  for (const race of schedule) {
    await run('INSERT INTO races (race_number) VALUES (?)', [race.race_number]);
    
    for (let i = 0; i < race.participants.length; i++) {
      await run(
        'INSERT INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
        [race.race_number, race.participants[i].id, i + 1]
      );
    }
  }
}
```

### Phase 4: Schedule Generator Refactor
**File:** `lib/schedule-generator.js`

```javascript
function generateSchedule(playerCount, playersPerRace = 4) {
  if (![8, 9, 10].includes(playerCount)) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  
  if (![2, 4].includes(playersPerRace)) {
    throw new Error(`Unsupported players per race: ${playersPerRace}`);
  }
  
  return playersPerRace === 4
    ? generateSchedule4Player(playerCount)
    : generateSchedule2Player(playerCount);
}

function generateSchedule4Player(playerCount) {
  // Existing logic refactored into this function
  // Returns: [{ race_number: 1, participants: ['A', 'B', 'C', 'D'] }, ...]
}

function generateSchedule2Player(playerCount) {
  // NEW: Simple greedy pairing algorithm
  // Goals:
  // - Each player races exactly 4 times
  // - Minimize pair repeats (prefer 0, allow 1 max)
  // - Avoid back-to-back races for same player
  
  const totalRaces = (playerCount * 4) / 2;
  const letters = generateLetters(playerCount);
  const racesRemaining = {};
  letters.forEach(l => racesRemaining[l] = 4);
  
  const pairCounts = {}; // Track who has raced together
  const lastRaceAppearance = {};
  letters.forEach(l => lastRaceAppearance[l] = -1);
  
  const schedule = [];
  
  for (let raceNum = 1; raceNum <= totalRaces; raceNum++) {
    const eligible = letters.filter(l => racesRemaining[l] > 0);
    
    // Find best pair using scoring
    let bestPair = null;
    let bestScore = Infinity;
    
    for (let i = 0; i < eligible.length - 1; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const pair = [eligible[i], eligible[j]];
        const score = scorePair(pair, raceNum, pairCounts, lastRaceAppearance);
        
        if (score < bestScore) {
          bestScore = score;
          bestPair = pair;
        }
      }
    }
    
    if (!bestPair) {
      throw new Error(`Failed to generate schedule at race ${raceNum}`);
    }
    
    schedule.push({ race_number: raceNum, participants: bestPair });
    
    // Update tracking
    bestPair.forEach(letter => {
      racesRemaining[letter]--;
      lastRaceAppearance[letter] = raceNum;
    });
    
    const pairKey = getPairKey(bestPair[0], bestPair[1]);
    pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
  }
  
  return schedule;
}

function scorePair(pair, raceNum, pairCounts, lastRaceAppearance) {
  let score = 0;
  
  // Penalty for repeated pairings (heavy)
  const pairKey = getPairKey(pair[0], pair[1]);
  score += (pairCounts[pairKey] || 0) * 100;
  
  // Penalty for back-to-back appearances (moderate)
  pair.forEach(letter => {
    if (lastRaceAppearance[letter] === raceNum - 1) {
      score += 10;
    }
  });
  
  return score;
}

// Update validation to accept playersPerRace parameter
function validateSchedule(schedule, letters, playersPerRace = 4) {
  // Check total races
  const expectedRaces = (letters.length * 4) / playersPerRace;
  if (schedule.length !== expectedRaces) {
    errors.push(`Expected ${expectedRaces} races, got ${schedule.length}`);
  }
  
  // Check each race has correct participant count
  for (const race of schedule) {
    if (race.participants.length !== playersPerRace) {
      errors.push(`Race ${race.race_number} has ${race.participants.length} players (expected ${playersPerRace})`);
    }
  }
  
  // Check each player appears exactly 4 times
  // Check pair repeat constraints for 2-player mode
  // ... rest of validation
}
```

### Phase 5: Test Suite for 2-Player Mode
**File:** `lib/schedule-generator.test.js`

Add test cases:
```javascript
// Test 2-player schedules
console.log('\n=== Testing 2-Player Schedules ===');

// 8 players, 2 per race
const schedule8_2 = generateSchedule(8, 2);
const validation8_2 = validateSchedule(schedule8_2, generateLetters(8), 2);
assert.strictEqual(schedule8_2.length, 16, 'Expected 16 races for 8 players');
assert.ok(validation8_2.ok, 'Validation failed: ' + validation8_2.errors.join(', '));

// 9 players, 2 per race
const schedule9_2 = generateSchedule(9, 2);
const validation9_2 = validateSchedule(schedule9_2, generateLetters(9), 2);
assert.strictEqual(schedule9_2.length, 18, 'Expected 18 races for 9 players');
assert.ok(validation9_2.ok, 'Validation failed: ' + validation9_2.errors.join(', '));

// 10 players, 2 per race
const schedule10_2 = generateSchedule(10, 2);
const validation10_2 = validateSchedule(schedule10_2, generateLetters(10), 2);
assert.strictEqual(schedule10_2.length, 20, 'Expected 20 races for 10 players');
assert.ok(validation10_2.ok, 'Validation failed: ' + validation10_2.errors.join(', '));

// Verify 4-player tests still pass
// ... existing tests
```

### Phase 6: Dynamic Points System
**File:** `routes/races.js`

```javascript
// Replace static POINTS_MAP
function getPointsMap(playersPerRace) {
  return playersPerRace === 2
    ? { 1: 25, 2: 18 }
    : { 1: 25, 2: 18, 3: 15, 4: 12 };
}

async function submitRaceResult(req, res) {
  // Get tournament config
  const tournament = await get('SELECT players_per_race FROM tournament WHERE id = 1');
  const playersPerRace = tournament?.players_per_race || 4;
  const pointsMap = getPointsMap(playersPerRace);
  
  // Validate placements.length === playersPerRace
  if (placements.length !== playersPerRace) {
    return res.status(400).json({ 
      error: `Expected ${playersPerRace} placements, got ${placements.length}` 
    });
  }
  
  // Validate positions are 1..playersPerRace
  const positions = placements.map(p => p.position);
  if (!positions.every(p => p >= 1 && p <= playersPerRace)) {
    return res.status(400).json({ 
      error: `Positions must be between 1 and ${playersPerRace}` 
    });
  }
  
  // Insert results with dynamic points
  for (const placement of placements) {
    const points = pointsMap[placement.position];
    await run(
      'INSERT INTO results (race_number, player_id, position, points) VALUES (?, ?, ?, ?)',
      [race_number, placement.player_id, placement.position, points]
    );
  }
}
```

### Phase 7-9: API Route Updates
**Files:** `routes/races.js`, `routes/players.js`, `routes/tournament.js`

**Key Changes:**
- Replace all hardcoded `player1_id..player4_id` JOINs with junction table queries
- Use `GROUP_CONCAT` or multiple queries to build participant arrays
- Update validation logic to use `players_per_race` from tournament config

**Example Query Pattern (GET /api/races):**
```sql
SELECT 
  r.race_number,
  r.completed,
  GROUP_CONCAT(rp.player_id || ':' || p.name || ':' || p.player_letter, ',') as participants_data
FROM races r
JOIN race_participants rp ON r.race_number = rp.race_number
JOIN players p ON rp.player_id = p.id
GROUP BY r.race_number
ORDER BY r.race_number, rp.slot_position
```

Then parse `participants_data` in JavaScript to build the participants array.

### Phase 10: Frontend - Organizer UI
**File:** `public/organizer.html`

Add configuration selector:
```html
<div class="form-group">
  <label class="form-label">Players Per Race</label>
  <select id="playersPerRace" class="form-select">
    <option value="4" selected>4 Players (Standard)</option>
    <option value="2">2 Players (Smaller TV)</option>
  </select>
  <small>Choose 2 for smaller TV screens with limited split-screen support</small>
</div>
```

Update race result form generation:
```javascript
function selectRace() {
  const race = allRaces.find(r => r.race_number === raceNumber);
  const playersPerRace = tournamentConfig.players_per_race || 4;
  
  // Generate position options dynamically
  const positionOptions = [];
  for (let i = 1; i <= playersPerRace; i++) {
    const medal = i === 1 ? '🥇' : i === 2 ? '🥈' : i === 3 ? '🥉' : '';
    const points = getPointsMap(playersPerRace)[i];
    positionOptions.push(`<option value="${i}">${medal} ${i}${ordinalSuffix(i)} Place (${points} points)</option>`);
  }
  
  // Render form with only required slots
  // ...
}
```

### Phase 11-13: Frontend - Player & Leaderboard UI
**Files:** `public/player.html`, `public/leaderboard.html`, `public/css/styles.css`

**Changes:**
- Display 1 opponent for 2-player races (vs 3 for 4-player)
- Add CSS class `.race-card-2player` with larger text and spacing
- Show `players_per_race` in tournament info display
- Leaderboard logic remains unchanged (points and tiebreakers work the same)

### Phase 14-15: Documentation
**Files:** `WARP.md`, `README.md`, `.env.example`

Update WARP.md:
```markdown
## Configuration

### Players Per Race

Choose between 2 or 4 players per race based on your TV screen size:

**Priority:**
1. Organizer UI selection during tournament init
2. `PLAYERS_PER_RACE` environment variable
3. Default: 4 players

**Usage:**
```bash
# Reset with 2-player races
PLAYERS_PER_RACE=2 npm run db:reset

# Or select from organizer UI
```

**Race Math:**
- 2 players: `(player_count × 4) / 2` races (e.g., 9 players = 18 races)
- 4 players: `player_count` races (e.g., 9 players = 9 races)

**Scoring:**
- 2-player: 25 / 18 points (1st / 2nd)
- 4-player: 25 / 18 / 15 / 12 points (F1 style)
```

### Phase 16-17: Testing Checklist

**2-Player Mode Test:**
1. `PLAYERS_PER_RACE=2 npm run db:reset`
2. Start server: `npm start`
3. Init tournament with 9 players, 2 per race
4. Verify API returns `total_races: 18`
5. Register 9 players (A-I)
6. Check `/api/races` shows 18 races with 2 participants each
7. Submit result for race 1: Player A = 1st, Player B = 2nd
8. Verify leaderboard: A has 25 points, B has 18 points
9. Complete all 18 races
10. Complete tournament and verify winner declared correctly

**4-Player Mode Test:**
1. Reset with default: `npm run db:reset`
2. Init tournament with 9 players (default 4 per race)
3. Verify API returns `total_races: 9`
4. Verify all existing functionality works unchanged

### Phase 18: Migration Script
**File:** `scripts/migrate-to-junction-table.js`

```javascript
const { db, run, all, get } = require('../database');

async function migrate() {
  console.log('🔄 Migrating to junction table...');
  
  // Create race_participants table
  await run(`
    CREATE TABLE IF NOT EXISTS race_participants (
      race_number INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      slot_position INTEGER NOT NULL,
      PRIMARY KEY (race_number, player_id),
      UNIQUE (race_number, slot_position),
      FOREIGN KEY (race_number) REFERENCES races(race_number) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )
  `);
  
  // Check if migration needed
  const existingCount = await get('SELECT COUNT(*) as count FROM race_participants');
  if (existingCount.count > 0) {
    console.log('✅ Migration already completed');
    return;
  }
  
  // Backfill from legacy columns
  const races = await all('SELECT * FROM races');
  for (const race of races) {
    const participants = [
      { id: race.player1_id, slot: 1 },
      { id: race.player2_id, slot: 2 },
      { id: race.player3_id, slot: 3 },
      { id: race.player4_id, slot: 4 }
    ].filter(p => p.id !== null);
    
    for (const p of participants) {
      await run(
        'INSERT INTO race_participants (race_number, player_id, slot_position) VALUES (?, ?, ?)',
        [race.race_number, p.id, p.slot]
      );
    }
  }
  
  console.log('✅ Migration complete');
}

migrate().catch(console.error).finally(() => db.close());
```

Add to `package.json`:
```json
"db:migrate:junction": "node scripts/migrate-to-junction-table.js"
```

### Phase 19-22: Deployment, QA, and Sign-off
- Update Docker compose to pass through `PLAYERS_PER_RACE`
- Run full regression tests
- Verify indexes on junction table prevent N+1 queries
- Performance check with `EXPLAIN QUERY PLAN`
- Final acceptance criteria review

---

## Risk Mitigation

### High Risks
1. **Database migration breaks existing tournaments**
   - Mitigation: Keep legacy columns, idempotent migration, comprehensive testing
   
2. **2-player schedule fairness issues for 9 players**
   - Mitigation: Extensive validation, pair repeat caps, deterministic algorithm
   
3. **Missing query updates cause runtime errors**
   - Mitigation: grep for all `player1_id` references, comprehensive API tests

### Medium Risks
1. **Frontend displays incorrect player counts**
   - Mitigation: Cache `players_per_race` in state, validate before render
   
2. **Points calculated incorrectly**
   - Mitigation: Unit tests for both scoring modes

---

## Success Criteria

✅ Organizer can select 2 or 4 players per race during tournament init  
✅ Schedule generates correctly: `(player_count × 4) / players_per_race` races  
✅ Each player races exactly 4 times regardless of mode  
✅ Points awarded correctly: 25/18 for 2-player, 25/18/15/12 for 4-player  
✅ Frontend adapts dynamically to show correct number of participants  
✅ Leaderboard sorting works identically in both modes  
✅ Backward compatibility: existing 4-player tournaments continue to work  
✅ No data loss during migration  
✅ All tests pass including new 2-player schedule tests  

---

## Quick Start Commands

```bash
# Test 2-player tournament
PLAYERS_PER_RACE=2 npm run db:reset
npm start

# Test 4-player tournament (default)
npm run db:reset
npm start

# Run schedule generator tests
npm run test:schedule

# Run migration (if needed)
npm run db:migrate:junction
```

---

## Questions & Decisions Log

**Q: Should we allow 3 players per race?**  
A: No - Mario Kart typically supports 2 or 4 player split-screen. 3 would require 12 races for 9 players, which is awkward.

**Q: What if player count × 4 is not divisible by players_per_race?**  
A: The configuration validator should reject invalid combinations and provide clear error messages.

**Q: Should we migrate the database automatically or require manual migration?**  
A: Auto-migrate on server startup with idempotent checks. Provide manual script for pre-deployment verification.

**Q: What happens to the F1 scoring tiebreaker in 2-player mode?**  
A: Same logic applies - first by points, then by count of 1st places, then by count of 2nd places, then by player letter. Works identically.

---

**Ready to implement!** Follow phases sequentially and mark todos complete as you progress.
