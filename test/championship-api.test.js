const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../database');
const { createApp } = require('../app');

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariokart-api-'));
  const database = createDatabase(path.join(dir, 'test.db'));
  await database.initializeSchema();
  const app = createApp({ database, organizerPin: '2468', publicBaseUrl: 'http://mariokart.local:3000', ...options });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await database.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  async function request(route, body, auth = true, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (route === '/api/organizer/login' && response.ok) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  await request('/api/organizer/login', { pin: '2468' });
  return { request, database, base, get cookie() { return cookie; } };
}

test('registration is atomic, retry-safe, and snapshots expose no private fields', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/championship', { expectedActiveId: null }, false)).status, 401);
  const created = await request('/api/championship', { expectedActiveId: null, seed: 'api' });
  assert.equal(created.status, 201);
  const id = created.body.championship.id;
  const joined = await Promise.all(Array.from({ length: 9 }, (_, i) => request(`/api/championship/${id}/players`, { name: `Player ${i + 1}`, registrationToken: `registration-token-${i}` }, false)));
  assert.ok(joined.every(r => r.status === 200));
  assert.equal(new Set(joined.map(r => r.body.player.id)).size, 9);
  assert.equal((await request(`/api/championship/${id}/players`, { name: 'Extra', registrationToken: 'registration-token-extra' }, false)).status, 409);
  const snap = await request('/api/championship/current');
  assert.match(snap.headers.get('cache-control'), /no-store/);
  assert.equal(JSON.stringify(snap.body).includes('registration_token'), false);
  assert.equal('prizes' in snap.body, false);
  const started = await request(`/api/championship/${id}/start`, { expectedRevision: snap.body.revision });
  assert.equal(started.status, 200);
  const replay = await request(`/api/championship/${id}/players`, { name: 'Retry', registrationToken: 'registration-token-0' }, false);
  assert.equal(replay.body.player.id, joined[0].body.player.id);
  assert.equal(replay.body.player.name, 'Player 1');
  const stale = await request(`/api/championship/${id}/pause`, { expectedRevision: 0, paused: true }, true, 'PUT');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.snapshot.revision, started.body.revision);
});

test('organizer sessions and data are scoped to each application and expire safely', async t => {
  let clock = 1000;
  const a = await fixture(t, { now: () => clock });
  const b = await fixture(t);
  const cross = await fetch(b.base + '/api/championship', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: a.cookie }, body: JSON.stringify({ expectedActiveId: null }) });
  assert.equal(cross.status, 401);
  const created = await a.request('/api/championship', { expectedActiveId: null, seed: 'scoped' });
  assert.equal((await b.request('/api/championship/current')).body.initialized, false);
  clock += 3600001;
  assert.equal((await a.request('/api/organizer/check')).body.authenticated, false);
  assert.equal((await a.request(`/api/championship/${created.body.championship.id}/start`, { expectedRevision: 0 })).status, 401);
  assert.equal((await a.database.get('SELECT COUNT(*) AS count FROM championships')).count, 1);
});

test('obsolete championships, future rounds and duplicate result players cannot mutate state', async t => {
  const { request } = await fixture(t);
  const first = (await request('/api/championship', { expectedActiveId: null, seed: 'older' })).body;
  const second = (await request('/api/championship', { expectedActiveId: first.championship.id, seed: 'newer' })).body;
  assert.equal((await request(`/api/championship/${first.championship.id}/players`, { name: 'Old', registrationToken: 'old-registration-token' }, false)).status, 409);
  const future = second.slots[1].rounds[0];
  const refused = await request(`/api/championship/${second.championship.id}/rounds/${future.id}/result`, { expectedRevision: 0, groups: [['A'], ['B'], ['C'], ['D']] }, true, 'PUT');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.snapshot.revision, 0);
  assert.equal((await request('/api/tournament/status')).status, 200);
});

test('full event, partial solo, correction, pause, and completion share one source of truth', async t => {
  const { request } = await fixture(t);
  let { body: state } = await request('/api/championship', { expectedActiveId: null, seed: 'rehearsal' });
  const id = state.championship.id;
  for (let i = 0; i < 9; i++) await request(`/api/championship/${id}/players`, { name: `Player ${i + 1}`, registrationToken: `rehearsal-token-${i}` }, false);
  state = (await request('/api/championship/current')).body;
  state = (await request(`/api/championship/${id}/start`, { expectedRevision: state.revision })).body;
  const played = [];
  let checkedPartial = false;
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) {
      const payload = round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: slot.participants.map(p => p.player_id).sort().map(id => [id]) };
      const saved = await request(`/api/championship/${id}/rounds/${round.id}/result`, { ...payload, expectedRevision: state.revision }, true, 'PUT');
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      state = saved.body;
      played.push({ slot, round });
      if (slot.category === 'solo' && round.order === 1 && !checkedPartial) {
        checkedPartial = true;
        assert.equal(state.active_round.mode, 'coin');
        assert.equal(state.active_slot.participants.map(p => p.player_id).join(), slot.participants.map(p => p.player_id).join());
        const paused = await request(`/api/championship/${id}/pause`, { expectedRevision: state.revision, paused: true }, true, 'PUT');
        state = paused.body;
        assert.equal((await request(`/api/championship/${id}/advance`, { expectedRevision: state.revision })).status, 409);
        state = (await request(`/api/championship/${id}/pause`, { expectedRevision: state.revision, paused: false }, true, 'PUT')).body;
      }
    }
    const advanced = await request(`/api/championship/${id}/advance`, { expectedRevision: state.revision });
    assert.equal(advanced.status, 200);
    state = advanced.body;
  }
  assert.equal(played.length, 36);
  assert.equal(state.slots_completed, 27);
  assert.equal(checkedPartial, true);
  const leaders = state.standings.filter(p => p.rank === 1);
  const finished = await request(`/api/championship/${id}/complete`, { expectedRevision: state.revision, ...(leaders.length > 1 ? { playoffWinnerId: leaders[0].id } : {}) });
  assert.equal(finished.status, 200);
  state = finished.body;
  assert.equal(state.championship.status, 'completed');
  assert.equal(state.winner.id, leaders[0].id);
  const prior = played.find(p => p.round.mode === 'renegade');
  const changed = await request(`/api/championship/${id}/rounds/${prior.round.id}/result`, { expectedRevision: state.revision, winningSide: 'robbers' }, true, 'PUT');
  assert.equal(changed.status, 200);
  assert.equal(changed.body.championship.status, 'awaiting_champion');
  assert.equal(changed.body.winner, null);
  assert.equal(changed.body.slots_completed, 27);
});
