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
