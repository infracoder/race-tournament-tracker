require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initializeSchema } = require('./database');

// Import routes
const { router: organizerRouter, requireOrganizer } = require('./routes/organizer');
const tournamentRouter = require('./routes/tournament');
const playersRouter = require('./routes/players');
const racesRouter = require('./routes/races');
const { submitRaceResult } = require('./routes/races');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Bind to all interfaces for LAN access

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/organizer', organizerRouter);
app.use('/api/players', playersRouter);

// Protected tournament routes
app.post('/api/tournament/init', requireOrganizer, tournamentRouter);
app.post('/api/tournament/complete', requireOrganizer, tournamentRouter);
app.use('/api/tournament', tournamentRouter);

// Protected race result submission
app.post('/api/race/result', (req, res, next) => {
  console.log('🎯 Race result endpoint hit!');
  next();
}, requireOrganizer, submitRaceResult);

// General races routes (public)
app.use('/api/races', racesRouter);

// Disable caching for API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Mario Kart Tournament Server is running!' });
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('🏁 Starting Mario Kart Tournament Server...');
    
    await initializeSchema();
    
    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('═══════════════════════════════════════════════');
      console.log('🏎️  MARIO KART TOURNAMENT SERVER READY! 🏁');
      console.log('═══════════════════════════════════════════════');
      console.log(`🌐 Local:    http://localhost:${PORT}`);
      console.log(`📱 Network:  http://${getLocalIP()}:${PORT}`);
      console.log('═══════════════════════════════════════════════');
      console.log('');
      console.log('📋 Available Routes:');
      console.log('  🏠 Home:         /');
      console.log('  📝 Register:     /register.html');
      console.log('  👤 Player:       /player.html?id=<player_id>');
      console.log('  🎮 Organizer:    /organizer.html');
      console.log('  🏆 Leaderboard:  /leaderboard.html');
      console.log('');
      console.log('🔐 Organizer PIN:', process.env.ORGANIZER_PIN || '1234 (default)');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Get local IP address for network access
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  
  return 'localhost';
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
