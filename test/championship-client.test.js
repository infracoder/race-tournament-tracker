const { test } = require('node:test');
const assert = require('node:assert/strict');

test('client discards older revisions and a delayed response from a superseded event', async () => {
  const { ChampionshipClient } = await import('../public/js/championship-client.js');
  const seen = [];
  let finish;
  const client = new ChampionshipClient({ document: null, onState: s => seen.push(s), fetcher: () => new Promise(resolve => { finish = resolve; }) });
  client.apply({ initialized: true, championship: { id: 'old' }, revision: 5 });
  client.apply({ initialized: true, championship: { id: 'old' }, revision: 4 });
  assert.equal(client.state.revision, 5);
  const poll = client.refresh();
  client.apply({ initialized: true, championship: { id: 'new' }, revision: 0 });
  finish({ ok: true, json: async () => ({ initialized: true, championship: { id: 'old' }, revision: 6 }) });
  await poll;
  assert.equal(client.state.championship.id, 'new');
  assert.equal(seen.length, 2);
  client.stop();
});

test('client keeps the last good state on failure without overlapping requests', async () => {
  const { ChampionshipClient } = await import('../public/js/championship-client.js');
  let finish, requests = 0, failure;
  const client = new ChampionshipClient({ document: null, onError: e => { failure = e; }, fetcher: () => { requests++; return new Promise((resolve, reject) => { finish = reject; }); } });
  client.apply({ initialized: false });
  const a = client.refresh(), b = client.refresh();
  assert.equal(requests, 1);
  finish(new Error('offline'));
  await Promise.all([a, b]);
  assert.equal(client.state.initialized, false);
  assert.equal(failure.message, 'offline');
  client.stop();
});

test('leaving a page fences delayed updates even if a transport ignores abort', async () => {
  const { ChampionshipClient } = await import('../public/js/championship-client.js');
  let finish;
  const seen = [];
  const client = new ChampionshipClient({ document: null, onState: state => seen.push(state), fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const pending = client.refresh();
  client.stop();
  finish({ ok: true, json: async () => ({ initialized: false }) });
  await pending;
  assert.equal(seen.length, 0);
});

function stalledOnce(stage, result) {
  let calls = 0, active = 0, maxActive = 0, aborted = false;
  let startBody;
  const bodyStarted = new Promise(resolve => { startBody = resolve; });
  return {
    bodyStarted,
    get calls() { return calls; },
    get maxActive() { return maxActive; },
    get aborted() { return aborted; },
    fetcher(_path, { signal }) {
      calls++;
      maxActive = Math.max(maxActive, ++active);
      if (calls > 1) return Promise.resolve({
        ok: true,
        json: async () => { active--; return result; },
        blob: async () => { active--; return result; }
      });
      const pending = new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          active--;
          reject(signal.reason);
        }, { once: true });
      });
      return stage === 'fetch'
        ? pending
        : Promise.resolve({
          ok: true,
          json: () => { startBody(); return pending; },
          blob: () => { startBody(); return pending; }
        });
    }
  };
}

for (const stage of ['fetch', 'json']) {
  test(`polling recovers after a stalled ${stage} without overlapping requests`, { timeout: 1000 }, async (t) => {
    const { ChampionshipClient } = await import('../public/js/championship-client.js');
    const next = { initialized: false, revision: 2 };
    const transport = stalledOnce(stage, next);
    const errors = [];
    let recovered;
    const recovery = new Promise(resolve => { recovered = resolve; });
    const client = new ChampionshipClient({
      document: null,
      fetcher: transport.fetcher,
      interval: 5,
      timeout: 20,
      onError: error => errors.push(error),
      onState: state => { if (state === next) recovered(); }
    });
    t.after(() => client.stop());
    client.apply({ initialized: false, revision: 1 });
    const first = client.start();
    assert.equal(client.refresh(), first);
    await first;
    assert.equal(transport.aborted, true);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, 'TimeoutError');
    assert.equal(client.state.revision, 1);
    await recovery;
    assert.equal(client.state, next);
    assert.equal(transport.calls, 2);
    assert.equal(transport.maxActive, 1);
  });

  test(`a stalled ${stage} releases a mutation for an explicit retry`, { timeout: 1000 }, async () => {
    const { request } = await import('../public/js/championship-client.js');
    const saved = { revision: 3 };
    const transport = stalledOnce(stage, saved);
    const options = { fetcher: transport.fetcher, timeout: 20 };
    await assert.rejects(request('/save', { value: 7 }, 'PUT', options), { name: 'TimeoutError' });
    assert.equal(transport.aborted, true);
    assert.equal(transport.calls, 1);
    assert.equal(await request('/save', { value: 7 }, 'PUT', options), saved);
    assert.equal(transport.calls, 2);
    assert.equal(transport.maxActive, 1);
  });
}

test('the shared deadline covers artwork body reading and permits a later load', { timeout: 1000 }, async () => {
  const { fetchData } = await import('../public/js/championship-client.js');
  const artwork = new Blob(['artwork']);
  const transport = stalledOnce('blob', artwork);
  const options = { fetcher: transport.fetcher, timeout: 20, responseType: 'blob' };
  await assert.rejects(fetchData('/artwork', {}, options), { name: 'TimeoutError' });
  assert.equal(transport.aborted, true);
  const { data } = await fetchData('/artwork', {}, options);
  assert.equal(data, artwork);
  assert.equal(transport.maxActive, 1);
});

test('stop cancels a stalled body quietly and a later start can refresh', { timeout: 1000 }, async (t) => {
  const { ChampionshipClient } = await import('../public/js/championship-client.js');
  const transport = stalledOnce('json', { initialized: false, revision: 2 });
  const errors = [];
  const client = new ChampionshipClient({
    document: null,
    fetcher: transport.fetcher,
    onError: error => errors.push(error),
    timeout: 20
  });
  t.after(() => client.stop());
  const pending = client.start();
  await transport.bodyStarted;
  client.stop();
  await pending;
  assert.deepEqual(errors, []);
  assert.equal(transport.aborted, true);
  await client.start();
  assert.equal(client.state.revision, 2);
  assert.equal(transport.maxActive, 1);
});

test('visibility changes keep one request and stop fences its delayed response', { timeout: 1000 }, async (t) => {
  const { ChampionshipClient } = await import('../public/js/championship-client.js');
  const document = new EventTarget();
  document.hidden = false;
  const seen = [], errors = [];
  let finish, calls = 0;
  const client = new ChampionshipClient({
    document,
    timeout: 100,
    fetcher: () => {
      calls++;
      return calls === 1
        ? new Promise(resolve => { finish = resolve; })
        : Promise.resolve({ ok: true, json: async () => ({ initialized: false, revision: 2 }) });
    },
    onState: state => seen.push(state),
    onError: error => errors.push(error)
  });
  t.after(() => client.stop());
  const pending = client.start();
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 1);
  assert.equal(client.refresh(), pending);
  client.stop();
  await pending;
  finish({ ok: true, json: async () => ({ initialized: false, revision: 1 }) });
  await new Promise(resolve => setImmediate(resolve));
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 1);
  assert.deepEqual(seen, []);
  assert.deepEqual(errors, []);
  await client.start();
  assert.equal(calls, 2);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].revision, 2);
});
