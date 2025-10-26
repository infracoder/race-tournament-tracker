# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

A mobile-friendly web application for managing Mario Kart tournaments with **configurable player counts (8-10 players)**, dynamic schedule generation, and F1-style scoring (25/18/15/12 points). Built with Node.js/Express backend, SQLite database, and vanilla JavaScript frontend.

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
# PLAYER_COUNT=9  # Optional: default player count (8, 9, or 10)
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
- Schema initialization with 4 core tables:
  - `tournament` - singleton table tracking status, winner, `player_count`, and `total_races`
  - `players` - dynamic count (8-10) with letters A-H/I/J and optional names
  - `races` - dynamic count (8-10) with 4 participants each (references players)
  - `results` - race placements with position and F1 points
- `seedTournament(playerCount?)` dynamically generates schedule using algorithm
- Safe migration: adds `player_count` and `total_races` columns if missing (backward compatible)

**Dynamic Schedule Generator:** `lib/schedule-generator.js`
- Generates fair racing schedules for 8, 9, or 10 players
- Each player races exactly 4 times with 4 players per race
- Algorithm minimizes repeated pairings and back-to-back appearances
- Deterministic: same player count always produces same schedule
- Comprehensive validation ensures fairness (max pair repeats ≤3)

**Configuration Priority:**
1. Request body parameter (organizer UI selection)
2. Config file (`config/tournament-config.json`)
3. Environment variable (`PLAYER_COUNT`)
4. Default (9 players)

### API Routes

**Organizer Auth:** `routes/organizer.js`
- In-memory session store with 1-hour expiration
- PIN-based authentication via `ORGANIZER_PIN` env variable
- `requireOrganizer` middleware protects sensitive endpoints
- Cookie-based session management

**Tournament Management:** `routes/tournament.js`
- `POST /api/tournament/init` - Initialize/reset tournament (protected)
  - Accepts `player_count` (8-10) in request body
  - Validates and passes to `seedTournament()`
  - Returns actual `player_count` and `total_races`
- `GET /api/tournament/status` - Get tournament status (public)
  - Returns `player_count`, `total_races`, `races_completed`, etc.
- `POST /api/tournament/complete` - Declare winner after all races (protected)
  - Uses dynamic `total_races` instead of hardcoded 9
- Winner determined by F1 tiebreaker rules: points → 1sts → 2nds → 3rds → 4ths → letter

**Player Operations:** `routes/players.js`
- `POST /api/players/register` - Register player into first available slot (A-H/I/J based on config)
  - Dynamically checks tournament `player_count` for slot availability
- `GET /api/players` - List registered players and available slots
  - Returns dynamic counts based on tournament configuration
- `GET /api/players/schedule/:playerId` - Get player's 4 races and opponents
- `GET /api/leaderboard` - Real-time standings with tiebreaker sorting

**Race Results:** `routes/races.js`
- `GET /api/races` - List all races with participants
- `POST /api/race/result` - Submit race placements (protected)
- Validates: correct participants, unique positions 1-4, race not already completed
- Atomic transaction inserts results and marks race complete

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

## Development Notes

### Authentication Flow
1. Organizer logs in via PIN at `/organizer.html`
2. Session cookie (`mk_organizer_session`) stored for 1 hour
3. Protected routes check session via `requireOrganizer` middleware
4. Sessions stored in-memory Map (cleared on server restart)

### Tournament Lifecycle
1. **Initialize:** Organizer selects player count (8-10) and calls init endpoint → creates N player slots + N races
2. **Registration:** Players register → fills player slots (A-H/I/J) with names
3. **Racing:** Organizer submits results after each race → updates results table
4. **Completion:** After all races complete, organizer completes tournament → declares winner

### Testing with Different Player Counts
```bash
# Test 8-player tournament
PLAYER_COUNT=8 npm run db:reset
npm start
# Visit organizer.html, init with 8 players, register 8 people (A-H)

# Test 10-player tournament
PLAYER_COUNT=10 npm run db:reset
npm start
# Visit organizer.html, init with 10 players, register 10 people (A-J)

# Test schedule generator
npm run test:schedule
# Validates 8, 9, and 10 player schedules (13 tests)
```

### Database Transactions
Use `transaction()` helper for multi-step operations:
- Race result submission (insert 4 results + mark race complete)
- Tournament initialization (clear + seed all tables)

### Network Access
Server binds to `0.0.0.0` and displays local IP on startup. Share `http://YOUR_IP:3000` with players on same WiFi network.

### F1 Scoring System
Defined in `routes/races.js`:
```javascript
const POINTS_MAP = {
  1: 25,  // 1st place
  2: 18,  // 2nd place
  3: 15,  // 3rd place
  4: 12   // 4th place
}
```

### API Caching
API responses have `Cache-Control: no-store` headers to ensure real-time data for mobile clients.
