const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../../database');
const { createApp } = require('../../app');

(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mariokart-browser-'));
  const database = createDatabase(path.join(dir, 'test.db'));
  await database.initializeSchema();
  const app = createApp({ database, organizerPin: 'browser-test-2468', publicBaseUrl: 'http://mariokart.local:3108' });
  const server = app.listen(3108, '127.0.0.1');
  process.once('SIGTERM', () => server.close(async () => { await database.close(); await rm(dir, { recursive: true, force: true }); process.exit(0); }));
})().catch(error => { console.error(error); process.exit(1); });
