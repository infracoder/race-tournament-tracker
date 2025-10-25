# mDNS (Bonjour) support: mariokart.local

This app can be advertised on your local network via Bonjour (mDNS) so players can visit:
http://mariokart.local:3000

This uses macOS's built-in `dns-sd` tool (no Avahi or Docker changes required).

## How it works

- We publish an HTTP service (`_http._tcp`) named "Mario Kart Tournament" on port 3000.
- We also publish a host A record for `mariokart.local` that points to your Mac's current LAN IP.
- All devices on the same network that support mDNS can resolve `mariokart.local`.

## Start/Stop mDNS advertisement

Prerequisite: Start the app (dev or prod) so port 3000 is reachable.

- Start (standalone):
  - `npm run mdns:start`
- Stop:
  - `npm run mdns:stop`

With Docker:
- Up (starts containers then mDNS): `npm run docker:up`
- Down (stops mDNS then containers): `npm run docker:down`

Logs: `/tmp/mariokart-mdns.log`
PID: `/tmp/mariokart-mdns.pid`

## Accessing the app

- URL: `http://mariokart.local:3000`
- Service browser (debug): `dns-sd -B _http._tcp` then `dns-sd -L "Mario Kart Tournament" _http._tcp local`

## Notes and limitations

- macOS host only: Advertisement is done from your Mac (not inside Docker).
- Same LAN/subnet: All players must be on the same local network.
- Port: Defaults to 3000. Change by setting `PORT` env var before `npm run mdns:start`.
- Docker: Ensure port mapping `3000:3000` and the app listens on `0.0.0.0`.

## Troubleshooting

- Can't resolve `mariokart.local`:
  - Ensure you're connected to the same Wi‑Fi/LAN.
  - Restart mDNS: `npm run mdns:stop && npm run mdns:start` (IP may have changed).
  - Check log: `tail -n +1 /tmp/mariokart-mdns.log`
  - Verify service: `dns-sd -B _http._tcp` (should list "Mario Kart Tournament")
  - Verify host record: `ping mariokart.local`

- Name conflict:
  - If another device uses `mariokart.local`, change `HOST_LABEL` in `scripts/advertise-mdns.sh`.

- Firewalls:
  - mDNS uses UDP 5353. macOS typically allows this by default. Allow Node/Docker on port 3000 as needed.

- Platform support:
  - iOS/macOS work out of the box.
  - Windows requires Bonjour (installed with iTunes or Bonjour Print Services).
  - Many Android browsers don't resolve `.local`. Use the device's IP if needed.

## Uninstall/cleanup

- Stop advertisement: `npm run mdns:stop`
- Remove generated files: Nothing persistent is created (PID/log are in `/tmp`).
