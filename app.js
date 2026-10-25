const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const { createOrganizer } = require('./routes/organizer');
const { createChampionshipService } = require('./lib/championship-service');

function createApp({ database, organizerPin, now, publicBaseUrl } = {}) {
  if (!database) throw new Error('A database must be supplied.');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    next();
  });
  const { router, requireOrganizer } = createOrganizer({ pin: organizerPin, now });
  app.use('/api/organizer', router);
  app.use(
    '/api/championship',
    require('./routes/championship')(createChampionshipService(database), requireOrganizer, { publicBaseUrl })
  );
  app.use('/api/players', require('./routes/players')(database));
  app.use('/api/battle', require('./routes/battle')(database));
  app.use(
    '/api/tournament',
    (req, res, next) => (req.method === 'POST' ? requireOrganizer(req, res, next) : next()),
    require('./routes/tournament')(database)
  );
  const races = require('./routes/races')(database);
  app.post('/api/race/result', requireOrganizer, races.submitRaceResult);
  app.use('/api/races', races.router);
  app.get('/health', (req, res) =>
    res.json({ status: 'ok', message: 'Mario Kart Tournament Server is running!' })
  );
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.status || 500)
      .json({ error: error.status === 400 ? 'Invalid request body.' : 'Unable to process this request.' });
  });
  return app;
}

module.exports = { createApp };
