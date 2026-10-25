const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../database');
const { createApp } = require('../app');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-prizes-'));
  const filename = path.join(dir, 'event.db');
  const database = createDatabase(filename);
  await database.initializeSchema();
  const server = await new Promise(resolve => {
    const s = createApp({ database, organizerPin: 'prize-test-2468' }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(route, body, { host = true, token, method = body === undefined ? 'GET' : 'POST', raw, type, revision } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': type || 'application/json', ...(host ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(revision === undefined ? {} : { 'X-Tournament-Revision': String(revision) }) },
      body: raw || (body === undefined ? undefined : JSON.stringify(body))
    });
    if (route === '/api/organizer/login' && response.ok) cookie = response.headers.get('set-cookie').split(';')[0];
    const contentType = response.headers.get('content-type') || '';
    return { status: response.status, headers: response.headers, body: contentType.includes('json') ? await response.json() : await response.text() };
  }
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await database.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await call('/api/organizer/login', { pin: 'prize-test-2468' });
  let state = (await call('/api/championship', { expectedActiveId: null, seed: 'private-prizes' })).body;
  const id = state.championship.id;
  const settingsPath = `/api/championship/${id}/prizes`;
  const token = 'private-player-registration-A';
  await call(`/api/championship/${id}/players`, { name: 'Casey', registrationToken: token }, { host: false });
  state = (await call('/api/championship/current')).body;
  return { call, database, filename, id, settingsPath, token, state };
}

test('prize settings, artwork, and owner access stay private before completion', async t => {
  const { call, id, settingsPath, token, state } = await fixture(t);
  assert.equal((await call(settingsPath, undefined, { host: false })).status, 401);
  const initial = await call(settingsPath);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.tiers, { first: 10000, second: 7500, third: 5000, participation: 1500 });
  const config = { expectedRevision: state.revision, enabled: true, currency: 'CAD', tiers: { first: 98765, second: 87654, third: 76543, participation: 65432 }, vendors: [{ name: 'SecretVendor-Jade' }, { name: 'SecretVendor-Saffron' }] };
  assert.equal((await call(settingsPath, config, { host: false, method: 'PUT' })).status, 401);
  const saved = await call(settingsPath, config, { method: 'PUT' });
  assert.equal(saved.status, 200);
  const settings = (await call(settingsPath)).body;
  const vendor = settings.vendors[0];
  assert.ok(vendor.id);
  const publicState = (await call('/api/championship/current', undefined, { host: false })).body;
  const serialized = JSON.stringify(publicState);
  for (const secret of ['98765', '87654', '76543', '65432', 'SecretVendor', token, vendor.id]) assert.equal(serialized.includes(secret), false, secret);
  for (const asset of ['/', '/organizer.html', '/player.html', '/prize.html', '/js/prize.js', '/js/prizes-admin.js']) {
    const source = (await call(asset, undefined, { host: false })).body;
    assert.equal(source.includes('SecretVendor-Jade'), false, asset);
    assert.equal(source.includes('98765'), false, asset);
    assert.equal(source.includes(token), false, asset);
  }
  assert.equal('prizes' in publicState, false);
  const prizePath = `/api/championship/${id}/players/A/prize`;
  assert.equal((await call(prizePath, undefined, { host: false })).status, 401);
  const locked = await call(prizePath, undefined, { host: false, token });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.locked, true);
  assert.equal('award' in locked.body, false);
  assert.equal('vendors' in locked.body, false);
  assert.equal((await call(`/api/championship/${id}/players/B/prize`, undefined, { host: false, token })).status, 403);
  const artworkPath = `${settingsPath}/vendors/${vendor.id}/artwork`;
  assert.equal((await call(artworkPath, undefined, { host: false })).status, 401);
  const artwork = await call(artworkPath);
  assert.equal(artwork.status, 200);
  assert.match(artwork.body, /SecretVendor-Jade/);
  const playerArt = `/api/championship/${id}/players/A/prize/artwork/${vendor.id}`;
  assert.equal((await call(playerArt, undefined, { host: false, token })).status, 409);
  const link = await call(`/api/championship/${id}/players/A/prize-link`);
  assert.equal(link.status, 200);
  assert.equal(new URL(link.body.path, 'http://example.test').search.includes(token), false);
  assert.match(new URL(link.body.path, 'http://example.test').hash, /key=/);
  assert.equal((await call(`/api/championship/${id}/players/A/prize-link`, undefined, { host: false })).status, 401);
  assert.match(initial.headers.get('cache-control'), /no-store/);
  assert.match(artwork.headers.get('cache-control'), /no-store/);
});

test('artwork upload stays authenticated, validates bytes, and survives reopening storage', async t => {
  const { call, database, filename, id, settingsPath, state } = await fixture(t);
  const config = { expectedRevision: state.revision, enabled: true, currency: 'USD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: '<script>Vendor</script>' }] };
  const saved = await call(settingsPath, config, { method: 'PUT' });
  const settings = (await call(settingsPath)).body;
  const route = `${settingsPath}/vendors/${settings.vendors[0].id}/artwork`;
  const generic = await call(route);
  assert.match(generic.body, /&lt;script&gt;Vendor&lt;\/script&gt;/);
  assert.equal(generic.body.includes('<script>'), false);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y8d8AAAAASUVORK5CYII=', 'base64');
  const unauthorized = await call(route, undefined, { host: false, method: 'PUT', raw: png, type: 'image/png' });
  assert.equal(unauthorized.status, 401);
  const bad = await call(route, undefined, { method: 'PUT', raw: Buffer.from('<svg onload="alert(1)"/>'), type: 'image/png' });
  assert.equal(bad.status, 400);
  const uploaded = await call(route, undefined, { method: 'PUT', raw: png, type: 'image/png', revision: saved.body.revision });
  assert.equal(uploaded.status, 200);
  assert.equal((await call(route)).headers.get('content-type'), 'image/png');
  const reopened = createDatabase(filename);
  try {
    const row = await reopened.get('SELECT artwork, artwork_type FROM championship_prize_vendors WHERE championship_id = ?', [id]);
    assert.deepEqual(row.artwork, png);
    assert.equal(row.artwork_type, 'image/png');
  } finally { await reopened.close(); }
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards WHERE championship_id = ?', [id])).count, 0);
  assert.equal(saved.status, 200);
});

async function finishEvent(call, id, tied = false) {
  let state = (await call('/api/championship/current')).body;
  state = (await call(`/api/championship/${id}/start`, { expectedRevision: state.revision })).body;
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) {
      const saved = await call(`/api/championship/${id}/rounds/${round.id}/result`, {
        expectedRevision: state.revision,
        ...(round.mode === 'renegade' ? { winningSide: 'cops' } : {
          groups: tied
            ? round.mode === 'race' ? slot.participants.map(p => [p.player_id]) : [slot.participants.map(p => p.player_id)]
            : slot.participants.map(p => p.player_id).sort().map(id => [id])
        })
      }, { method: 'PUT' });
      assert.equal(saved.status, 200);
      state = saved.body;
    }
    state = (await call(`/api/championship/${id}/advance`, { expectedRevision: state.revision })).body;
  }
  return state;
}

test('completion assigns nine private prizes once and vendor choices survive unrelated selections', async t => {
  const { call, database, id, settingsPath, token, state } = await fixture(t);
  for (let i = 1; i < 9; i++) await call(`/api/championship/${id}/players`, { name: `Player ${i + 1}`, registrationToken: `prize-competitor-token-${i}` }, { host: false });
  let current = (await call('/api/championship/current')).body;
  await call(settingsPath, { expectedRevision: current.revision, enabled: true, currency: 'CAD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Jade' }, { name: 'Saffron' }] }, { method: 'PUT' });
  current = await finishEvent(call, id);
  assert.equal(current.standings[0].id, 'A');
  assert.equal(new Set(current.standings.slice(0, 4).map(p => p.total_units)).size, 4);
  const completed = await call(`/api/championship/${id}/complete`, { expectedRevision: current.revision });
  assert.equal(completed.status, 200);
  let owned = (await call(`/api/championship/${id}/players/A/prize`, undefined, { host: false, token })).body;
  assert.equal(owned.locked, false);
  assert.equal(owned.award.amount_cents, 10000);
  assert.equal(owned.award.currency, 'CAD');
  assert.equal('awards' in owned, false);
  const assignments = await database.all('SELECT amount_cents FROM championship_prize_awards WHERE championship_id = ? ORDER BY amount_cents DESC', [id]);
  assert.deepEqual(assignments.map(a => a.amount_cents), [10000, 7500, 5000, 1500, 1500, 1500, 1500, 1500, 1500]);
  assert.equal(assignments.reduce((sum, a) => sum + a.amount_cents, 0), 31500);
  const vendor = owned.vendors[0];
  const selected = await Promise.all([
    call(`/api/championship/${id}/players/A/prize/vendor`, { vendorId: vendor.id, revealId: owned.award.reveal_id }, { host: false, token, method: 'PUT' }),
    call(`/api/championship/${id}/players/B/prize/vendor`, { vendorId: vendor.id, revealId: owned.award.reveal_id }, { host: false, token: 'prize-competitor-token-1', method: 'PUT' })
  ]);
  assert.ok(selected.every(r => r.status === 200));
  assert.ok(selected.every(r => r.body.award.vendor_id === vendor.id));
  assert.equal((await call(`/api/championship/${id}/players/B/prize`, undefined, { host: false, token })).status, 403);
  assert.equal((await call(`/api/championship/${id}/players/A/prize/artwork/${vendor.id}`, undefined, { host: false })).status, 401);
  assert.equal((await call(`/api/championship/${id}/players/A/prize/artwork/${vendor.id}`, undefined, { host: false, token })).status, 200);
  current = (await call('/api/championship/current')).body;
  assert.equal(JSON.stringify(current).includes(vendor.id), false);
  const repeated = await call(`/api/championship/${id}/complete`, { expectedRevision: current.revision });
  assert.equal(repeated.body.revision, current.revision);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards')).count, 9);
  owned = (await call(`/api/championship/${id}/players/A/prize`, undefined, { host: false, token })).body;
  const oldReveal = owned.award.reveal_id;
  const team = current.slots.find(slot => slot.category === 'team');
  const changed = await call(`/api/championship/${id}/rounds/${team.rounds[0].id}/result`, { expectedRevision: current.revision, winningSide: 'robbers' }, { method: 'PUT' });
  assert.equal(changed.body.championship.status, 'awaiting_champion');
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards')).count, 0);
  assert.equal((await call(`/api/championship/${id}/players/A/prize`, undefined, { host: false, token })).body.locked, true);
  assert.equal((await call(`/api/championship/${id}/players/A/prize/artwork/${vendor.id}`, undefined, { host: false, token })).status, 409);
  const recompleted = await call(`/api/championship/${id}/complete`, { expectedRevision: changed.body.revision });
  assert.equal(recompleted.status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards')).count, 9);
  assert.equal((await call(`/api/championship/${id}/players/A/prize/vendor`, { vendorId: vendor.id, revealId: oldReveal }, { host: false, token, method: 'PUT' })).status, 409);
});

test('unequal prize ties reject completion atomically while equal amounts allow shared places', async t => {
  const { call, database, id, settingsPath, token } = await fixture(t);
  for (let i = 1; i < 9; i++) await call(`/api/championship/${id}/players`, { name: `Player ${i + 1}`, registrationToken: `tied-prize-token-${i}` }, { host: false });
  let current = (await call('/api/championship/current')).body;
  const config = { enabled: true, currency: 'CAD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Jade' }] };
  assert.equal((await call(settingsPath, { ...config, expectedRevision: current.revision }, { method: 'PUT' })).status, 200);
  current = await finishEvent(call, id, true);
  assert.equal(new Set(current.standings.map(p => p.total_units)).size, 1);
  assert.equal(current.championship.status, 'awaiting_champion');
  const rejected = await call(`/api/championship/${id}/complete`, { expectedRevision: current.revision, playoffWinnerId: 'C' });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Prize places are tied/);
  const unchanged = (await call('/api/championship/current')).body;
  assert.equal(unchanged.revision, current.revision);
  assert.equal(unchanged.championship.status, 'awaiting_champion');
  assert.equal(unchanged.winner, null);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards WHERE championship_id = ?', [id])).count, 0);
  const settings = (await call(settingsPath)).body;
  current = (await call(settingsPath, { ...config, expectedRevision: current.revision, tiers: { first: 1500, second: 1500, third: 1500, participation: 1500 }, vendors: settings.vendors.map(({ id, name }) => ({ id, name })) }, { method: 'PUT' })).body;
  const completed = await call(`/api/championship/${id}/complete`, { expectedRevision: current.revision, playoffWinnerId: 'C' });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.winner.id, 'C');
  const awards = await database.all('SELECT amount_cents, reveal_id FROM championship_prize_awards WHERE championship_id = ?', [id]);
  assert.equal(awards.length, 9);
  assert.ok(awards.every(award => award.amount_cents === 1500));
  assert.equal(new Set(awards.map(award => award.reveal_id)).size, 1);
  const owned = (await call(`/api/championship/${id}/players/A/prize`, undefined, { host: false, token })).body;
  assert.equal(owned.locked, false);
  assert.equal(owned.award.amount_cents, 1500);
});

test('playoff placements settle different prizes without changing points and persist in reopened storage', async t => {
  const { call, database, filename, id, settingsPath, token } = await fixture(t);
  for (let i = 1; i < 9; i++) await call(`/api/championship/${id}/players`, { name: `Player ${i + 1}`, registrationToken: `playoff-prize-token-${i}` }, { host: false });
  let current = (await call('/api/championship/current')).body;
  await call(settingsPath, { expectedRevision: current.revision, enabled: true, currency: 'USD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Jade' }] }, { method: 'PUT' });
  current = await finishEvent(call, id, true);
  const before = current.standings;
  const completion = { expectedRevision: current.revision, playoffWinnerId: 'C', prizePlayoffs: { 1: ['C', 'A', 'I'] } };
  const settings = (await call(settingsPath)).body;
  assert.deepEqual(settings.playoffs.map(({ rank, places, players }) => ({ rank, places, players: players.map(p => p.id) })), [{ rank: 1, places: [1, 2, 3], players: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] }]);
  assert.equal('playoffs' in current, false);
  for (const prizePlayoffs of [{ 1: ['C', 'A'] }, { 1: ['C', 'A', 'A'] }, { 1: ['C', 'A', 'Z'] }, { 1: ['A', 'C', 'I'] }, { 1: ['C', 'A', 'I'], 2: ['B'] }, [], null]) {
    const rejected = await call(`/api/championship/${id}/complete`, { ...completion, prizePlayoffs });
    assert.ok([400, 409].includes(rejected.status));
    const unchanged = (await call('/api/championship/current')).body;
    assert.equal(unchanged.revision, current.revision);
    assert.equal(unchanged.winner, null);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM championship_prize_awards WHERE championship_id = ?', [id])).count, 0);
  }
  assert.equal((await call(`/api/championship/${id}/complete`, { ...completion, expectedRevision: current.revision - 1 })).status, 409);
  assert.equal((await call(`/api/championship/${id}/complete`, completion, { host: false })).status, 401);
  const completed = await call(`/api/championship/${id}/complete`, completion);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.winner.id, 'C');
  assert.equal(completed.body.championship.winner_source, 'playoff');
  assert.deepEqual(completed.body.standings, before);
  const awards = await database.all('SELECT player_id, place, amount_cents, reveal_id FROM championship_prize_awards WHERE championship_id = ? ORDER BY place, player_id', [id]);
  assert.deepEqual(awards.slice(0, 3).map(({ player_id, place, amount_cents }) => ({ player_id, place, amount_cents })), [
    { player_id: 'C', place: 1, amount_cents: 10000 },
    { player_id: 'A', place: 2, amount_cents: 7500 },
    { player_id: 'I', place: 3, amount_cents: 5000 }
  ]);
  assert.ok(awards.slice(3).every(award => award.place === 4 && award.amount_cents === 1500));
  assert.equal(awards.reduce((sum, award) => sum + award.amount_cents, 0), 31500);
  const owned = (await call(`/api/championship/${id}/players/A/prize`, undefined, { host: false, token })).body;
  assert.equal(owned.award.place, 2);
  assert.equal(owned.award.amount_cents, 7500);
  const reopened = createDatabase(filename);
  try {
    await reopened.initializeSchema();
    assert.deepEqual(await reopened.all('SELECT player_id, place, amount_cents, reveal_id FROM championship_prize_awards WHERE championship_id = ? ORDER BY place, player_id', [id]), awards);
  } finally { await reopened.close(); }
  const replay = await call(`/api/championship/${id}/complete`, { ...completion, expectedRevision: completed.body.revision, prizePlayoffs: { 1: ['I', 'C', 'A'] } });
  assert.equal(replay.body.revision, completed.body.revision);
  assert.deepEqual(await database.all('SELECT player_id, place, amount_cents, reveal_id FROM championship_prize_awards WHERE championship_id = ? ORDER BY place, player_id', [id]), awards);
});

test('a playoff below the leader changes only the tied prize places', async t => {
  const { database, id } = await fixture(t);
  const { prizePlayoffGroups, writePrizeAwards } = require('../lib/championship-prizes');
  const standings = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((id, index) => ({ id, name: id, total_units: [3600, 2400, 2400, 2400, 1200, 1200, 600, 600, 600][index] }));
  const settings = { enabled: true, currency: 'USD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 } };
  assert.deepEqual(prizePlayoffGroups(standings, settings), [{ rank: 2, places: [2, 3], players: [{ id: 'B', name: 'B' }, { id: 'C', name: 'C' }, { id: 'D', name: 'D' }] }]);
  await assert.rejects(database.transaction(tx => writePrizeAwards(tx, id, standings, settings, { 2: ['A', 'B'] }, 'A')), /tied group/);
  await database.transaction(tx => writePrizeAwards(tx, id, standings, settings, { 2: ['D', 'B'] }, 'A'));
  const awards = await database.all('SELECT player_id, place, amount_cents FROM championship_prize_awards WHERE championship_id = ? ORDER BY place, player_id', [id]);
  assert.deepEqual(awards.slice(0, 4), [
    { player_id: 'A', place: 1, amount_cents: 10000 },
    { player_id: 'D', place: 2, amount_cents: 7500 },
    { player_id: 'B', place: 3, amount_cents: 5000 },
    { player_id: 'C', place: 4, amount_cents: 1500 }
  ]);
  assert.deepEqual(awards.slice(4).map(a => a.place), [5, 5, 7, 7, 7]);
});
