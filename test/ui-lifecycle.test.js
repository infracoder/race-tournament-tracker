const { test } = require('node:test');
const assert = require('node:assert/strict');

test('shared pages resume live updates after repeated cached navigation', async t => {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const page = new EventTarget();
  const document = new EventTarget();
  const nodes = new Map([
    ['#connectionNotice', {}],
    ['#liveStatus', { dataset: {} }]
  ]);
  document.hidden = false;
  document.querySelector = selector => nodes.get(selector);
  document.querySelectorAll = () => [];
  let requests = 0;
  globalThis.window = page;
  globalThis.document = document;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ initialized: false, championship: null, revision: ++requests }) });
  let client;
  t.after(() => {
    client?.stop();
    Object.assign(globalThis, original);
  });
  const { mount } = await import('../public/js/ui.js');
  const seen = [];
  client = mount(state => seen.push(state.revision));
  await client.inFlight;
  assert.deepEqual(seen, [1]);
  for (let cycle = 0; cycle < 2; cycle++) {
    page.dispatchEvent(new Event('pagehide'));
    assert.equal(client.running, false);
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    page.dispatchEvent(restored);
    await client.inFlight;
    assert.equal(client.running, true);
    assert.equal(requests, cycle + 2);
  }
  assert.deepEqual(seen, [1, 2, 3]);
});
