const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configuredOrigin, joinUrl } = require('../lib/join-url');

test('join URLs use a configured phone origin and the active championship only', () => {
  const origin = configuredOrigin('https://kart.example.com:8443/');
  assert.equal(joinUrl('event/a', 1234, origin), 'https://kart.example.com:8443/register.html?t=event%2Fa');
  assert.equal(joinUrl(null, 1234, origin), null);
});

test('loopback, unspecified addresses, credentials and URL paths are rejected', () => {
  for (const url of ['http://localhost:3000', 'http://localhost.:3000', 'http://127.0.0.2:3000', 'http://0.0.0.0:3000', 'http://[::1]:3000', 'http://[::]:3000', 'https://user:secret@kart.example', 'https://kart.example/path', 'https://kart.example/?pin=1234', 'ftp://kart.example']) {
    assert.throws(() => configuredOrigin(url), /PUBLIC_BASE_URL/);
  }
});
