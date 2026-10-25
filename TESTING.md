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

Review regressions additionally cover interrupted legacy migrations and rollback, four scoring appearances in every classic configuration, consistent battle rosters and completion, stalled fetch/body recovery, repeated cached-page restoration, and locked result fields during a pending save. Prize tests assert unequal-amount ties reject completion atomically and equal-amount ties succeed.

The browser rehearsal plays all 36 rounds through the host UI with prizes enabled. Its equal-performance fixture produces nine players tied on 214 points, requires a championship playoff winner and the remaining prize places, preserves those selections during polling, and reveals the champion on a separate public screen. It verifies the second-place private award, then corrects a team result, checks the reveal is sealed and playoff fields are cleared, and completes again with fresh selections.

The restart rehearsal closes and reopens the database midway through Balloon Battle / Coin Runners while paused. It checks the exact saved snapshot, completes the queue, and reconciles every player's category total and four win counters to independently calculated expected results.

## Verification record

Implementation checks run on October 24–25, 2026:

- Domain, database, API, client, and full-event tests: 46 passing on the host and Node 24 container, including prize playoffs.
- Chromium-mobile and WebKit-mobile browser flows: 28 passing, including the full 36-round playoff/correction rehearsal, lower-place and identical-name playoffs, preserved host drafts, session recovery, private prizes, slow-save protection, and retrying a lost registration reply.
- Desktop Race HQ: visually inspected in the in-app browser against disposable preview data.
- Prize playoff panel: visually inspected at 1280-pixel desktop and 390-pixel phone widths; no page overflow at phone width.
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

## Prize verification

`test/championship-prizes.test.js` exercises organizer-only configuration, owner-bound access, private artwork serving, image validation and persistence, default nine-player allocation totaling 315, concurrent vendor choices, completion replay, and withdrawing prizes after correction. Sentinel amounts and vendor names must not appear in public snapshots or static sources. Guessing an image URL or selecting another player's dashboard must not grant access.

`test/browser/prize-reveal.spec.js` verifies setup, private link import, the sealed pre-completion screen, amount reveal, vendor selection, refresh persistence, an unsaved choice surviving another player's update, and retraction after correction in both mobile engines.

`test/browser/prize-playoff.spec.js` distinguishes identically named finishers using their player letters, blocks conflicting choices after a winner change, and verifies lower-place playoff selections award the intended players without changing points.

Exact point ties affecting different prize amounts require playoff placements. API tests reject missing, duplicate, ineligible, stale, and champion-mismatched selections without changing points or releasing any award. They verify lower-place playoffs, unchanged equal-amount groups, allocation persistence in reopened storage, and idempotent completion. Physical-phone testing should additionally cover returning on the original registration phone and opening its private prize.
