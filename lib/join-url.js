const { networkInterfaces } = require('node:os');

function configuredOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.$/, '');
  const localOnly =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\./.test(hostname) ||
    ['0.0.0.0', '[::]', '[::1]'].includes(hostname);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname) ||
    localOnly
  ) {
    throw new Error(
      'PUBLIC_BASE_URL must be a phone-reachable HTTP(S) origin, without a path or credentials.'
    );
  }
  return url.origin;
}

function joinUrl(championshipId, port, explicitOrigin) {
  if (!championshipId) return null;
  let origin = explicitOrigin;
  if (!origin) {
    const address = Object.values(networkInterfaces())
      .flat()
      .find((net) => net?.family === 'IPv4' && !net.internal)?.address;
    if (!address) return null;
    origin = `http://${address}:${port}`;
  }
  return `${origin}/register.html?t=${encodeURIComponent(championshipId)}`;
}

module.exports = { configuredOrigin, joinUrl };
