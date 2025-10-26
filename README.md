# 🏁 Mario Kart Tournament Tracker

A mobile-friendly web application for managing Mario Kart tournaments with configurable player counts (8-10 players), dynamic scheduling, and F1-style scoring.

## Features

- **⚙️ Configurable Player Count**: Support for 8, 9, or 10 players per tournament
- **🎮 Player Registration**: Players register and receive assigned letters (A-H, A-I, or A-J)
- **📅 Smart Scheduling**: Dynamic schedule generation ensures each player races exactly 4 times (4 players per race)
- **🏆 F1 Scoring System**: 25/18/15/12 points for 1st-4th place
- **📊 Live Leaderboard**: Real-time standings with automatic tiebreakers
- **📱 Mobile-First Design**: Optimized for phones and tablets
- **🔐 Organizer Controls**: PIN-protected race result entry
- **🎉 Winner Celebration**: Animated confetti and winner banner

## Quick Start

### Option 1: Direct (npm)

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env and set your ORGANIZER_PIN

# Start development server
npm run dev

# Or start production server
npm start
```

Server will be available at:
- **Local**: http://localhost:3000
- **Network**: http://YOUR_LOCAL_IP:3000 (shown in terminal)

### Option 2: Docker

```bash
# Set your organizer PIN
export ORGANIZER_PIN=your_secret_pin

# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

## Initial Setup

1. **Initialize Tournament** (Organizer only):
   - Visit `/organizer.html`
   - Login with PIN
   - Click "Initialize Tournament"
   - Select number of players (8, 9, or 10)
   - Tournament is configured with dynamic schedule

2. **Player Registration**:
   - Share the network URL with players
   - Players visit `/register.html`
   - Each player registers with their name
   - Players receive letters based on configuration (A-H, A-I, or A-J)

3. **Run Races**:
   - Organizer enters results after each race
   - Leaderboard updates automatically
   - Number of races matches player count (8, 9, or 10 races)

4. **Declare Winner**:
   - After all races are complete, click "Complete Tournament"
   - Winner is displayed with confetti! 🎉

## Tournament Rules

### Scoring (F1 System)
- 1st Place: **25 points**
- 2nd Place: **18 points**
- 3rd Place: **15 points**
- 4th Place: **12 points**

### Race Schedule

Schedules are **dynamically generated** at tournament initialization to ensure fairness:

- **8 players** → 8 races (letters A-H)
- **9 players** → 9 races (letters A-I)  
- **10 players** → 10 races (letters A-J)

Each player races **exactly 4 times** with 4 players per race.

**Schedule Generation Goals:**
1. **Fair distribution**: Every player races exactly 4 times
2. **Minimize repeats**: Reduce the number of times players race against the same opponents
3. **Balance**: Avoid back-to-back races when possible
4. **Deterministic**: Same player count always produces the same schedule

### Tiebreakers
1. Total points
2. Most 1st places
3. Most 2nd places
4. Most 3rd places
5. Most 4th places

## API Endpoints

### Public Endpoints
- `GET /api/tournament/status` - Tournament info
- `GET /api/players` - List registered players
- `GET /api/players/schedule/:playerId` - Player's schedule
- `GET /api/leaderboard` - Current standings
- `GET /api/races` - All races

### Protected Endpoints (Organizer Only)
- `POST /api/organizer/login` - Login with PIN
- `POST /api/tournament/init` - Initialize/reset tournament (accepts `player_count: 8|9|10` in body)
- `POST /api/tournament/complete` - Declare winner
- `POST /api/race/result` - Submit race results

## Pages

- **/** - Home / Role selection
- **/register.html** - Player registration
- **/player.html?id=X** - Player dashboard
- **/organizer.html** - Organizer dashboard
- **/leaderboard.html** - Public leaderboard

## Development

### Scripts

```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start

# Reset database (uses default or PLAYER_COUNT env var)
npm run db:reset

# Reset with specific player count
PLAYER_COUNT=10 npm run db:reset

# Run schedule generator tests
npm run test:schedule
```

### Project Structure

```
mariokart/
├── server.js              # Express server
├── database.js            # SQLite operations with dynamic seeding
├── lib/
│   ├── schedule-generator.js      # Dynamic schedule generation
│   └── schedule-generator.test.js # Schedule tests
├── routes/
│   ├── organizer.js       # Auth routes
│   ├── tournament.js      # Tournament management
│   ├── players.js         # Registration & schedules
│   └── races.js           # Result submission
├── public/
│   ├── index.html         # Landing page
│   ├── register.html      # Registration
│   ├── player.html        # Player dashboard
│   ├── organizer.html     # Organizer dashboard
│   ├── leaderboard.html   # Public leaderboard
│   └── css/styles.css     # Mario Kart theme
└── scripts/
    └── reset-db.js        # Database reset utility
```

## Database Schema

- **tournament** - Single row with status, winner, `player_count`, and `total_races`
- **players** - Dynamic player count (8-10) with letters A-H/I/J
- **races** - Dynamic race count (8-10) with 4 participants each
- **results** - Individual race placements and points

## Configuration

### Environment Variables

```env
PORT=3000                    # Server port
ORGANIZER_PIN=1234          # Organizer access PIN
DB_FILE=./tournament.db     # Database location
PLAYER_COUNT=9              # Default player count (8, 9, or 10) - optional
```

### Configuration Priority

Player count is determined in the following order:
1. **Request body** - Organizer selects during initialization (highest priority)
2. **Config file** - `config/tournament-config.json` with `{"player_count": 10}`
3. **Environment variable** - `PLAYER_COUNT=8`
4. **Default** - 9 players (fallback)

### Mobile Optimization

- Large touch targets (minimum 54px)
- Prevents zoom on iOS
- Auto-refresh every 5-10 seconds
- Responsive grid layouts
- Touch-friendly form inputs

## Network Access

### Finding Your IP Address

**Mac**:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Linux**:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

**Windows**:
```cmd
ipconfig
```

Share `http://YOUR_IP:3000` with players on the same WiFi network.

## Troubleshooting

### Players Can't Connect
- Ensure all devices are on the same WiFi network
- Check firewall settings (allow port 3000)
- Verify server is bound to `0.0.0.0` (not `localhost`)

### Database Issues
```bash
# Reset database
npm run db:reset

# Or manually delete and restart
rm tournament.db
npm start
```

### Port Already in Use
```bash
# Change port in .env
PORT=3001
```

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite3
- **Frontend**: Vanilla JavaScript (no frameworks!)
- **Styling**: Custom CSS with Mario Kart theme
- **Deployment**: Docker or npm

## License

MIT

## Credits

Built with ❤️ for epic Mario Kart tournaments! 🏎️🏁
