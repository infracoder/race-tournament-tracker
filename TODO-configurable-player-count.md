# TODO: Configurable Player Count Feature

This document tracks the implementation of configurable player count (8-10 players) for the Mario Kart tournament tracker.

## Requirements
- Support 8, 9, or 10 players
- 4 players per race (fixed)
- Each player races at least 4 times (exactly 4 for balance)
- Dynamic schedule generation algorithm
- Player count configurable via UI during tournament initialization

## Implementation Phases

### ✅ Phase 1: Branch setup, author config, and baseline TODO commit
- [x] Ensure working tree is clean
- [x] Configure repository author (smokingmonkeyAI / russtolsma@gmail.com)
- [x] Create feature branch: feature/configurable-player-count
- [x] Add TODO tracker file
- [ ] Commit and push baseline
- [ ] Optional: Configure gh CLI pager

### ⏳ Phase 2: Schedule generation algorithm (lib/schedule-generator.js)
- [ ] Create lib/schedule-generator.js with:
  - generateSchedule(playerCount, options?)
  - validateSchedule(schedule, letters, minRacesPerPlayer)
- [ ] Implement balanced scheduling algorithm:
  - Support 8, 9, 10 players
  - 4 slots per race
  - Each player exactly 4 races
  - Minimize repeated pairings
  - Avoid back-to-back appearances
- [ ] Add validation with detailed metrics
- [ ] Create lib/schedule-generator.test.js
- [ ] Add npm script: test:schedule
- [ ] Commit: feat: add dynamic schedule generator with validation and tests for 8/9/10

### ⏳ Phase 3: Database schema and seeding updates (database.js)
- [ ] Add tournament columns: player_count, total_races
- [ ] Implement safe migration on startup
- [ ] Update seedTournament(playerCount?, config?) to:
  - Accept playerCount parameter
  - Generate dynamic letters (A-H/I/J)
  - Use schedule generator instead of schedule-seed.json
  - Store player_count and total_races in DB
  - Validate generated schedule
- [ ] Test db:reset compatibility
- [ ] Commit: feat(db): add player_count/total_races, dynamic seeding, and schedule generation integration

### ⏳ Phase 4: Backend API updates (routes)
- [ ] routes/tournament.js:
  - POST /api/tournament/init accepts player_count (8-10)
  - GET /api/tournament/status includes player_count, total_races
  - POST /api/tournament/complete uses dynamic total_races
- [ ] routes/players.js:
  - Dynamic letter set based on player_count
  - Remove hardcoded 9 player limits
- [ ] routes/races.js:
  - Use dynamic total_races for validations
- [ ] Commit: feat(api): tournament init accepts player_count, status exposes counts, and routes respect dynamic race/player totals

### ⏳ Phase 5: Frontend — Organizer UI (public/organizer.html)
- [ ] Add player count selector (8, 9, 10) in init flow
- [ ] Update initializeTournament() to send player_count
- [ ] Display current player_count and total_races on dashboard
- [ ] Replace hardcoded "9" references with dynamic values
- [ ] Commit: feat(ui/organizer): player count selector on init and dynamic counts in dashboard

### ⏳ Phase 6: Frontend — Player-facing pages
- [ ] public/index.html: dynamic messaging
- [ ] public/register.html: dynamic slots (A-H/I/J)
- [ ] public/player.html: dynamic schedule display
- [ ] public/leaderboard.html: works with 8-10 players
- [ ] Commit: feat(ui): dynamic player/race counts across index, register, player, and leaderboard pages

### ⏳ Phase 7: Configuration inputs (env and optional file)
- [ ] Support PLAYER_COUNT environment variable
- [ ] Optional config/tournament-config.json
- [ ] Document precedence: request → config file → env → default 9
- [ ] Commit: feat(config): support PLAYER_COUNT env and optional config/tournament-config.json loaded at init

### ⏳ Phase 8: Documentation updates (README.md, WARP.md)
- [ ] README.md: document configurable player count feature
- [ ] WARP.md: update architecture, API, and development sections
- [ ] Commit: docs: update README and WARP with configurable player count and dynamic schedule details

### ⏳ Phase 9: Testing and validation
- [ ] Automated tests for 8, 9, 10 player schedules
- [ ] Manual end-to-end testing for each player count
- [ ] DB migration compatibility testing
- [ ] UI/UX validation
- [ ] Commit: test: expand schedule tests and fix issues found during manual QA

### ⏳ Phase 10: Cleanup and merge preparation
- [ ] Deprecate schedule-seed.json
- [ ] Remove all hardcoded "9" references
- [ ] Final cleanup commits
- [ ] Push branch and open PR
- [ ] Verify checks pass

## Notes

### Mathematical Constraints
- 8 players × 4 races = 32 slots ÷ 4 per race = 8 races
- 9 players × 4 races = 36 slots ÷ 4 per race = 9 races
- 10 players × 4 races = 40 slots ÷ 4 per race = 10 races

### Algorithm Goals
1. **Fair distribution**: Each player races exactly 4 times
2. **Minimal repeats**: Minimize pairings between same players
3. **Balance**: Avoid back-to-back races for same player
4. **Deterministic**: Same input produces same schedule

### Configuration Priority
1. Request body parameter (organizer UI selection)
2. Config file (config/tournament-config.json)
3. Environment variable (PLAYER_COUNT)
4. Default value (9)
