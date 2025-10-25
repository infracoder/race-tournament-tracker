# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

A mobile-friendly web application for managing Mario Kart tournaments with 9 players, 9 races, and F1-style scoring (25/18/15/12 points). Built with Node.js/Express backend, SQLite database, and vanilla JavaScript frontend.

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
# Reset database and reinitialize tournament structure
npm run db:reset

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
  - `tournament` - singleton table tracking status and winner
  - `players` - 9 players with letters A-I and optional names
  - `races` - 9 races with 4 participants each (references players)
  - `results` - race placements with position and F1 points
- `seedTournament()` resets all data and loads fixed schedule from `schedule-seed.json`

**Fixed Schedule:** `schedule-seed.json`
- Immutable 9-race schedule ensuring each player races exactly 4 times
- Schedule validation on seed verifies all players participate exactly 4 times

### API Routes

**Organizer Auth:** `routes/organizer.js`
- In-memory session store with 1-hour expiration
- PIN-based authentication via `ORGANIZER_PIN` env variable
- `requireOrganizer` middleware protects sensitive endpoints
- Cookie-based session management

**Tournament Management:** `routes/tournament.js`
- `POST /api/tournament/init` - Initialize/reset tournament (protected)
- `GET /api/tournament/status` - Get tournament status (public)
- `POST /api/tournament/complete` - Declare winner after all races (protected)
- Winner determined by F1 tiebreaker rules: points → 1sts → 2nds → 3rds → 4ths → letter

**Player Operations:** `routes/players.js`
- `POST /api/players/register` - Register player into first available slot (A-I)
- `GET /api/players` - List registered players and available slots
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
1. **Initialize:** Organizer calls init endpoint → creates 9 empty player slots + 9 races
2. **Registration:** Players register → fills player slots (A-I) with names
3. **Racing:** Organizer submits results after each race → updates results table
4. **Completion:** After 9 races, organizer completes tournament → declares winner

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
