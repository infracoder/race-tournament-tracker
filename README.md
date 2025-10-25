# 🏁 Mario Kart Tournament Tracker

A mobile-friendly web application for managing Mario Kart tournaments with 9 players, 9 races, and F1-style scoring.

## Features

- **🎮 Player Registration**: 9 players register and receive assigned letters (A-I)
- **📅 Smart Scheduling**: Each player races exactly 4 times across 9 races
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

2. **Player Registration**:
   - Share the network URL with players
   - Players visit `/register.html`
   - Each player registers with their name

3. **Run Races**:
   - Organizer enters results after each race
   - Leaderboard updates automatically

4. **Declare Winner**:
   - After all 9 races, click "Complete Tournament"
   - Winner is displayed with confetti! 🎉

## Tournament Rules

### Scoring (F1 System)
- 1st Place: **25 points**
- 2nd Place: **18 points**
- 3rd Place: **15 points**
- 4th Place: **12 points**

### Race Schedule
All 9 players race exactly 4 times:
```
Race 1: A, B, C, D
Race 2: E, F, G, H
Race 3: A, E, F, I
Race 4: B, C, G, I
Race 5: D, E, H, I
Race 6: A, F, G, H
Race 7: B, D, F, I
Race 8: A, C, E, H
Race 9: B, C, D, G
```

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
- `POST /api/tournament/init` - Initialize/reset tournament
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

# Reset database
npm run db:reset
```

### Project Structure

```
mariokart/
├── server.js              # Express server
├── database.js            # SQLite operations
├── schedule-seed.json     # Fixed race schedule
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

- **tournament** - Single row with status and winner
- **players** - 9 players with letters A-I
- **races** - 9 races with 4 participants each
- **results** - Individual race placements and points

## Configuration

### Environment Variables

```env
PORT=3000                    # Server port
ORGANIZER_PIN=1234          # Organizer access PIN
DB_FILE=./tournament.db     # Database location
```

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
