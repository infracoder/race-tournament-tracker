# Manual Testing Guide - Configurable Player Count Feature

This guide will help you manually test the new configurable player count feature (8-10 players).

## Quick Start

```bash
# Ensure you're on the feature branch
git status  # Should show: On branch feature/configurable-player-count

# Start the server
npm run dev

# Server will display local IP - e.g., http://192.168.1.100:3000
# Open this URL in your browser
```

## Test Scenarios

### Scenario 1: 8-Player Tournament

**Setup:**
```bash
# Reset database with 8 players
PLAYER_COUNT=8 npm run db:reset
npm run dev
```

**Test Steps:**
1. Open organizer page: `http://localhost:3000/organizer.html`
2. Login with PIN (from your .env file)
3. Click "Initialize Tournament"
4. When prompted, enter **8** for player count
5. Verify confirmation shows "8 players"
6. Check tournament info box shows: "🎮 8 players 🏁 8 races"

**Registration (8 players):**
7. Open registration page in 8 different browser tabs/windows
8. Register 8 different players (e.g., Alice, Bob, Carol, Dave, Eve, Frank, Grace, Henry)
9. Verify each gets letters A through H
10. Verify 9th registration attempt fails with "All player slots are full (8/8 registered)"

**Races:**
11. Check organizer dashboard shows 8 races
12. Verify each race has exactly 4 players
13. Submit results for all 8 races
14. Verify leaderboard shows all 8 players
15. Complete tournament and declare winner

### Scenario 2: 9-Player Tournament (Default/Legacy)

**Setup:**
```bash
# Reset database (defaults to 9)
npm run db:reset
npm run dev
```

**Test Steps:**
1. Initialize tournament with **9** players (or just accept default)
2. Register 9 players (A-I)
3. Verify 9 races with 4 players each
4. Submit all results
5. Verify parity with old behavior

### Scenario 3: 10-Player Tournament

**Setup:**
```bash
# Reset with 10 players
PLAYER_COUNT=10 npm run db:reset
npm run dev
```

**Test Steps:**
1. Initialize tournament with **10** players
2. Register 10 players (A-J)
3. Verify 10 races
4. Check schedule fairness:
   - Each player appears in exactly 4 races
   - No player in same race twice
5. Submit results and complete tournament

### Scenario 4: Database Migration (Backward Compatibility)

**Test Steps:**
1. Start with an OLD database (if you have one saved)
2. Start the server: `npm start`
3. Verify migration messages in console:
   - "✅ Added player_count column..."
   - "✅ Added total_races column..."
4. Verify old tournament data still works
5. Initialize new tournament with different player count

### Scenario 5: Configuration Priority

**Test A - Environment Variable:**
```bash
PLAYER_COUNT=10 npm run db:reset
npm start
# Initialize tournament without specifying count
# Should default to 10 from env var
```

**Test B - Request Body (Highest Priority):**
1. Start server normally: `npm start`
2. Initialize with specific count via UI (e.g., 8)
3. Verify it uses 8, not env var or default

**Test C - Config File:**
```bash
# Create config file
mkdir -p config
echo '{"player_count": 10}' > config/tournament-config.json

npm start
# Initialize without specifying count
# Should use 10 from config file
```

## UI Validation Checklist

### Index Page (`/`)
- [ ] Header shows dynamic count: "8 Players • 8 Races • 1 Champion"
- [ ] Tournament stats show correct total_races
- [ ] "How It Works" section doesn't mention specific numbers
- [ ] Register button disabled when all slots full

### Register Page (`/register.html`)
- [ ] Welcome text doesn't say "A-I" specifically
- [ ] Registration status shows correct available count
- [ ] Can't register more than player_count

### Organizer Dashboard (`/organizer.html`)
- [ ] Player count selector appears on init (8, 9, or 10)
- [ ] Tournament info shows: "🎮 X players 🏁 X races 📊 X completed"
- [ ] Player count remembered in localStorage for next init
- [ ] All races show correct player count

### Player Dashboard (`/player.html?id=X`)
- [ ] Shows correct schedule (4 races)
- [ ] Stats reflect actual race count

### Leaderboard (`/leaderboard.html`)
- [ ] Shows all registered players (8, 9, or 10)
- [ ] Total races displays correctly
- [ ] Works with different player counts

## Edge Cases to Test

### Invalid Inputs
- [ ] Try initializing with player_count=7 (should reject)
- [ ] Try initializing with player_count=11 (should reject)
- [ ] Try initializing with player_count="abc" (should reject)

### Schedule Quality
- [ ] Check max pair repeats ≤ 3 (run `npm run test:schedule` for metrics)
- [ ] Verify no player appears twice in same race
- [ ] Each player appears exactly 4 times

### Race Results
- [ ] Submit results for all races
- [ ] Verify points calculated correctly
- [ ] Tiebreakers work (points → 1sts → 2nds → 3rds → 4ths)
- [ ] Winner declaration after final race

## Performance Checks

- [ ] Schedule generation is fast (< 1 second)
- [ ] Page loads don't timeout
- [ ] Database queries complete quickly
- [ ] Mobile UI responsive on different player counts

## Known Good Metrics

From automated tests, expected schedule quality:

**8 Players:**
- Total Races: 8
- Each player: exactly 4 races
- Max pair repeats: ≤ 3
- Max back-to-back: ≤ 2

**9 Players:**
- Total Races: 9
- Each player: exactly 4 races
- Max pair repeats: ≤ 3
- Max back-to-back: ≤ 1

**10 Players:**
- Total Races: 10
- Each player: exactly 4 races
- Max pair repeats: ≤ 2
- Max back-to-back: ≤ 1

## Troubleshooting

### Issue: Tournament won't initialize
- Check .env file has ORGANIZER_PIN set
- Verify you're logged in as organizer
- Check console for errors

### Issue: Schedule looks unfair
- Run `npm run test:schedule` to verify algorithm
- Check database: `sqlite3 tournament.db "SELECT * FROM races;"`
- Verify player_count in tournament table

### Issue: Player count not changing
- Clear browser localStorage
- Delete tournament.db and reinitialize
- Check console logs for configuration precedence

## Success Criteria

✅ All 3 player counts (8, 9, 10) work end-to-end  
✅ Each player races exactly 4 times  
✅ All UI pages show dynamic counts  
✅ Configuration priority works correctly  
✅ Database migration handles old schemas  
✅ Schedule generation is fair and deterministic  
✅ No hardcoded "9" references visible to users  

## Reporting Issues

If you find any bugs during testing:
1. Note the player count being tested
2. Screenshot the issue
3. Check browser console for errors
4. Note reproduction steps
5. Check database state if applicable

---

**After successful testing**, the feature is ready to merge!
