# Championship verification

Use disposable event data. Never reset the real tournament to run these checks.

## Automated checks

On Node 24:

```sh
npm ci
npm test
npx playwright install chromium webkit
npm run test:browser
```

`npm test` covers the classic schedules, championship fairness, exact tied scoring, atomic storage, API access, concurrent edits, registration recovery, application isolation, delayed client responses, and a full-event restart rehearsal. Browser tests use mobile Chromium (Pixel 7) and WebKit (iPhone 13) profiles. Their server creates a temporary database and listens on port 3108.

The browser rehearsal plays all 36 rounds through the host UI. Its equal-performance fixture produces nine players tied on 214 points, requires a playoff winner, reveals the champion on a separate public screen, then corrects a team result and requires completion again.

The restart rehearsal closes and reopens the database midway through Balloon Battle / Coin Runners while paused. It checks the exact saved snapshot, completes the queue, and reconciles every player's category total and four win counters to independently calculated expected results.

## Verification record

Implementation checks run on October 24–25, 2026:

- Domain, database, API, client, and full-event tests: passing.
- Chromium-mobile and WebKit-mobile browser flows: passing, including the full 36-round playoff/correction rehearsal, preserved host drafts, session recovery, and retrying a lost registration reply.
- Desktop Race HQ: visually inspected in the in-app browser against disposable preview data.
- Physical iPhone and Android devices: not yet exercised.
- Switch round timing and controller swaps: not yet measured.

The Node 24 Trixie image was built and exercised with native SQLite 3.52.0. Its tests passed, and a disposable volume smoke preserved the full snapshot across container restart while paused between Balloon Battle and Coin Runners. The first Bookworm build exposed an upstream binary's GLIBC requirement; Trixie resolves that mismatch. Browser emulation does not prove an actual phone can resolve the event address or reach the host over WiFi.

## Disposable container smoke

Build a new image and create a separate test volume. Use unique names if these already exist:

```sh
docker build -t mariokart-championship:local .
docker volume create mariokart-championship-smoke
docker run -d --name mariokart-championship-smoke \
  -p 127.0.0.1:3110:3000 \
  -v mariokart-championship-smoke:/data \
  -e ORGANIZER_PIN=container-test-only \
  -e PUBLIC_BASE_URL=http://mariokart.local:3110 \
  mariokart-championship:local
```

Open the host controls at `http://localhost:3110/organizer.html`, use the test PIN above, and set up a disposable tournament. Register a sample player, record its tournament ID and name, then restart:

```sh
docker restart mariokart-championship-smoke
```

Check that the tournament ID, player, schedule, and saved results persist. Log in again; organizer sessions deliberately do not survive restart. The QR must use the configured host origin, never a container bridge address.

Only after confirming these are your disposable resources, clean them up:

```sh
docker rm -f mariokart-championship-smoke
docker volume rm mariokart-championship-smoke
```

## Real-phone rehearsal

Use a separate test database and the actual event WiFi:

1. Set `PUBLIC_BASE_URL` to the host's reachable WiFi address and start the server. Check the firewall permits the configured port and guest WiFi does not isolate devices.
2. Scan the join QR on an iPhone using Safari and an Android phone using Chrome. Both should open the same current tournament.
3. Register, reload, close/reopen the page, and use **Select your name** from another browser. None should create another competitor accidentally.
4. Confirm Playing Now, Up Next, personal schedules, controller numbers, team sides, and category points are readable. Try enlarged text and browser zoom.
5. Enter Balloon Battle results, confirm points remain pending, then enter Coin Runners and confirm the average is awarded.
6. Pause/resume, edit a saved result, and advance the queue. Public screens should update within a few seconds.
7. Disconnect a phone briefly. It should show the last saved update and a reconnection notice, then recover when online or foregrounded.
8. Complete a disposable tournament, resolve a tie through a playoff, and confirm everyone sees the same champion.

## Switch pacing rehearsal

Use four human players, the intended game settings, and the actual controllers. Time one race, one Balloon Battle / Coin Runners pair, and one two-vs-two Renegade Roundup, including setup and controller handoff. The current planning budget is six, ten, and six minutes respectively, plus twenty minutes of breaks across the evening. Record measured times before promising a three-to-four-hour finish.

## Prize follow-up

Gift-card storage, private image serving, amounts, placement allocation, and the prize reveal remain deferred. Prize tests must verify server-side confidentiality and post-correction withdrawal before that feature is called complete.
