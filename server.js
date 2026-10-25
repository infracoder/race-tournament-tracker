require('dotenv').config();
const { networkInterfaces } = require('node:os');
const { createDatabase } = require('./database');
const { createApp } = require('./app');

function getLocalIP() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const net of addresses || []) if (net.family === 'IPv4' && !net.internal) return net.address;
  }
  return 'localhost';
}

async function startServer() {
  const database = createDatabase();
  await database.initializeSchema();
  const app = createApp({ database, organizerPin: process.env.ORGANIZER_PIN, publicBaseUrl: process.env.PUBLIC_BASE_URL });
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🏁 Tolsma 3rd Annual Mario Kart Tournament\nLocal: http://localhost:${server.address().port}\nPhones: http://${getLocalIP()}:${server.address().port}\nOrganizer: /organizer.html`);
  });
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.close(async () => { await database.close(); process.exit(0); });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return { app, server, database };
}

if (require.main === module) startServer().catch(error => { console.error('Unable to start tournament:', error); process.exitCode = 1; });
module.exports = { startServer };
