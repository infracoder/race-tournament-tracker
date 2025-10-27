# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

A mobile-friendly web application for managing Mario Kart tournaments with **configurable player counts (8-10 players)** and **configurable race sizes (2 or 4 players per race)**, dynamic schedule generation, F1-style scoring, and **bonus battle games**. Built with Node.js/Express backend, SQLite database, and vanilla JavaScript frontend.

**Race Modes:**
- **2-player races:** 25/18 points, 18 total races for 9 players (each races 4 times)
- **4-player races:** 25/18/15/12 points, 9 total races for 9 players (each races 4 times)

**Battle Games:**
- **3 random battle games** appear during tournament (between race 2 and the final race, non-consecutive)
- **4 battle stages:** Battle Stadium, Sweet Sweet Kingdom, Dragon Palace, Lunar Colony
- **Random selection:** 4 players selected randomly for each battle (duplicates across battles allowed)
- **No points awarded:** Battles are for prizes only (external to app tracking)
- **Full-screen announcement:** All players see battle modal when a battle race becomes active
- **Organizer marks complete:** No position/point entry required for battles

## Development Commands

### Starting the Server
```bash
# Development mode (auto-restart with nodemon)
npm run dev

# Production mode
npm start
```

### Database Management
```bash
# Reset database (uses default or PLAYER_COUNT env var)
npm run db:reset

# Reset with specific player count
PLAYER_COUNT=10 npm run db:reset

# Run schedule generator tests
npm run test:schedule

# Or manually reset
rm tournament.db
npm start
```

### Docker Operations
```bash
# Start with Docker
docker compose up -d

# View logs
docker compose logs -f

# Stop containers
docker compose down
```

### Environment Setup
```bash
# Copy example environment file
cp .env.example .env

# Required environment variables in .env:
# PORT=3000
# ORGANIZER_PIN=your_secret_pin
# DB_FILE=./tournament.db
# PLAYER_COUNT=9         # Optional: default player count (8, 9, or 10)
# PLAYERS_PER_RACE=4     # Optional: players per race (2 or 4, default: 4)
```

## Architecture

### Backend Structure

**Entry Point:** `server.js`
- Express server binding to `0.0.0.0:3000` for LAN access
- Displays local IP address on startup for player network access
- Middleware: JSON parsing, cookie-parser for organizer sessions
- API routes are protected by organizer authentication middleware

**Database Layer:** `database.js`
- SQLite3 with promise wrappers (`run`, `get`, `all`, `transaction`)
- Schema initialization with 7 core tables:
  - `tournament` - singleton table tracking status, winner, `player_count`, `total_races`, and `players_per_race`
  - `players` - dynamic count (8-10) with letters A-H/I/J and optional names
  - `races` - dynamic count based on configuration (9-18 races), includes `is_battle` flag
  - `race_participants` - junction table linking races to players (supports 2 or 4 per race)
  - `results` - race placements with position and F1 points (dynamic based on `players_per_race`)
  - `battle_games` - stores battle race details (race_number, stage_name, 4 player IDs)
  - Indexes: `idx_races_is_battle` for battle lookups
- `seedTournament(playerCount?, playersPerRace?)` dynamically generates schedule + 3 battle games
- Safe migration: migrates legacy `player1_id`..`player4_id` columns to junction table (backward compatible)

**Battle Distribution:** `lib/battle-distribution.js`
- Generates 3 random non-consecutive battle slots between race 2 and final race
- Randomly selects 4 unique players per battle (duplicates across battles allowed)
- Randomly assigns one of 4 battle stages to each battle
- Retry logic with fallback ensures non-consecutive slots even in edge cases

**Dynamic Schedule Generator:** `lib/schedule-generator.js`
- Generates fair racing schedules for 8, 9, or 10 players with 2 or 4 players per race
- Each player races exactly 4 times regardless of race size
- **4-player mode:** Optimized matrix-based algorithm minimizes repeated pairings (max ≤3)
- **2-player mode:** Greedy pairing algorithm balances participation and minimizes repeats (max ≤2)
- Deterministic: same configuration always produces same schedule
- Comprehensive validation ensures fairness for both race modes

**Configuration Priority:**
1. Request body parameter (organizer UI selection)
2. Config file (`config/tournament-config.json`)
3. Environment variables (`PLAYER_COUNT`, `PLAYERS_PER_RACE`)
4. Defaults (9 players, 4 per race)

### API Routes

**Organizer Auth:** `routes/organizer.js`
- In-memory session store with 1-hour expiration
- PIN-based authentication via `ORGANIZER_PIN` env variable
- `requireOrganizer` middleware protects sensitive endpoints
- Cookie-based session management

**Tournament Management:** `routes/tournament.js`
- `POST /api/tournament/init` - Initialize/reset tournament (protected)
  - Accepts `player_count` (8-10) and `players_per_race` (2 or 4) in request body
  - Validates and passes to `seedTournament()`
  - Returns actual `player_count`, `players_per_race`, and `total_races`
- `GET /api/tournament/status` - Get tournament status (public)
  - Returns `player_count`, `players_per_race`, `total_races`, `races_completed`, etc.
- `POST /api/tournament/complete` - Declare winner after all races (protected)
  - Uses dynamic `total_races` instead of hardcoded 9
- Winner determined by F1 tiebreaker rules (dynamic based on race mode):
  - 2-player mode: points → 1sts → 2nds → letter
  - 4-player mode: points → 1sts → 2nds → 3rds → 4ths → letter

**Player Operations:** `routes/players.js`
- `POST /api/players/register` - Register player into first available slot (A-H/I/J based on config)
  - Dynamically checks tournament `player_count` for slot availability
- `GET /api/players` - List registered players and available slots
  - Returns dynamic counts based on tournament configuration
- `GET /api/players/schedule/:playerId` - Get player's 4 races and opponents
- `GET /api/leaderboard` - Real-time standings with tiebreaker sorting

**Race Results:** `routes/races.js`
- `GET /api/races` - List all races with participants (uses junction table), includes `is_battle` flag
- `POST /api/race/result` - Submit race placements (protected)
- Validates: correct participants, unique positions (dynamic 1-2 or 1-4 based on config), race not completed
- **Battle handling:** If race is a battle, skip results insertion and only mark complete
- Atomic transaction inserts results and marks race complete

**Battle Games:** `routes/battle.js`
- `GET /api/battle/current` - Get currently active battle (next uncompleted battle race)
  - Returns `{ is_active, race_number, stage_name, players }` if battle is next
  - Returns `{ is_active: false }` if no battle or next race is regular
  - Used by player dashboard for polling
- `GET /api/battle/by-race/:raceNumber` - Get battle details for specific race
  - Returns battle stage and 4 players
  - Used by organizer dashboard
  - Returns 404 if race is not a battle

### Frontend Pages

All HTML pages are in `public/`:
- `index.html` - Landing page with role selection
- `register.html` - Player registration form
- `player.html` - Player dashboard showing schedule and stats
- `organizer.html` - Organizer dashboard for race result entry
- `leaderboard.html` - Public real-time standings

**Key Frontend Patterns:**
- Vanilla JavaScript (no frameworks)
- Auto-refresh every 5-10 seconds for live updates
- Mobile-first with minimum 54px touch targets
- Mario Kart themed CSS in `public/css/styles.css`
- Dynamic UI adapts to 2-player or 4-player race configuration
- Fetches `players_per_race` from tournament status to render appropriate forms/stats
- **Battle modal:** Full-screen overlay on player dashboard polls `/api/battle/current` every 5 seconds
  - Shows orange/yellow gradient modal with stage name and 4 selected players
  - Dismissible but reappears on refresh until organizer marks battle complete
  - No localStorage - relies on in-memory dismissed state
- **Organizer battle UI:** Purple battle indicators, simplified completion (no positions/points)

## Development Notes

### Authentication Flow
1. Organizer logs in via PIN at `/organizer.html`
2. Session cookie (`mk_organizer_session`) stored for 1 hour
3. Protected routes check session via `requireOrganizer` middleware
4. Sessions stored in-memory Map (cleared on server restart)

### Tournament Lifecycle
1. **Initialize:** Organizer selects player count (8-10) and race size (2 or 4) → creates N player slots + calculated races + 3 battle games
2. **Registration:** Players register → fills player slots (A-H/I/J) with names
3. **Racing:** Organizer submits results after each race → updates results and race_participants tables
   - **Battle games:** When a battle is the next race, full-screen modal appears on all player dashboards
   - Organizer marks battle complete without entering positions/points
   - Tournament progression pauses until battle is marked complete
4. **Completion:** After all races complete, organizer completes tournament → declares winner (battles don't affect points)

### Testing with Different Configurations
```bash
# Test 2-player races (18 races for 9 players)
PLAYER_COUNT=9 PLAYERS_PER_RACE=2 npm run db:reset
npm start

# Test 4-player races (9 races for 9 players, default)
PLAYER_COUNT=9 PLAYERS_PER_RACE=4 npm run db:reset
npm start

# Test 10-player, 2-player races (20 races)
PLAYER_COUNT=10 PLAYERS_PER_RACE=2 npm run db:reset
npm start

# Test schedule generator (validates both 2-player and 4-player modes)
npm run test:schedule
# Validates 8, 9, and 10 player schedules for both 2 and 4 player races (22 tests)
```

### Database Transactions
Use `transaction()` helper for multi-step operations:
- Race result submission (insert 2 or 4 results + mark race complete)
- Tournament initialization (clear + seed all tables)
- Junction table population (link players to races)

### Network Access
Server binds to `0.0.0.0` and displays local IP on startup. Share `http://YOUR_IP:3000` with players on same WiFi network.

### F1 Scoring System
Defined dynamically in `routes/races.js` based on `players_per_race`:
```javascript
// 2-player mode
const POINTS_MAP_2 = {
  1: 25,  // 1st place
  2: 18   // 2nd place
}

// 4-player mode
const POINTS_MAP_4 = {
  1: 25,  // 1st place
  2: 18,  // 2nd place
  3: 15,  // 3rd place
  4: 12   // 4th place
}
```

### API Caching
API responses have `Cache-Control: no-store` headers to ensure real-time data for mobile clients.
