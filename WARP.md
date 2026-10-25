# Repository guide

## Current product

The primary experience is the Tolsma 3rd Annual Mario Kart Tournament: nine competitors, one Switch, four players at a time, and a non-playing organizer. A shared responsive website serves iPhone and Android browsers. The older configurable race-only tournament remains as a compatibility API and separate tables.

Read README.md for event rules and TESTING.md for verification and event-day checks. The current requirements plan lives under docs/plans/; do not infer that deferred prize requirements have been implemented.

## Commands

Use Node 24 LTS (`.nvmrc`).

```sh
npm ci
npm start
npm run dev
npm test
npm run test:schedule
npx playwright install chromium webkit
npm run test:browser
docker compose up --build -d
```

No lint or typecheck command is configured. `npm run db:reset` seeds the older tournament and must not be part of testing or normal championship startup.

## Architecture

- `server.js` owns process startup/shutdown and creates the database. It binds to `0.0.0.0`.
- `app.js` exports `createApp({ database, organizerPin, now, publicBaseUrl })` without opening files or listening. All routers receive application-scoped dependencies.
- `database.js` exports `createDatabase(filename)` plus lazy legacy wrappers. Importing it must not open the default database. Tests supply temporary filenames and close their handles.
- Database operations share one FIFO queue. `transaction(tx => …)` owns BEGIN IMMEDIATE through COMMIT/ROLLBACK; `readTransaction` keeps a snapshot consistent. Inside a transaction use only its `tx.run/get/all` handle, never queued database methods.
- `lib/championship-schema.js` installs additive tables. Composite keys bind rounds and results to the championship, slot, and scheduled player. Do not reset or convert legacy records during startup.
- `lib/championship-schedule.js` generates and independently validates the persisted seeded 27-event, 36-round queue. Participation and team fairness are hard constraints; queue swaps improve estimated waits.
- `lib/championship-scoring.js` is the sole score calculator. Units are integer twelfths of a point so three-way solo ties and paired averages stay exact. Pending solo rounds count saved wins but do not award category points until both are complete.
- `lib/championship-service.js` owns registration, canonical results, current snapshots, revisions, progression, and champion eligibility. Equal totals share ranks. An effective post-completion correction withdraws the champion.
- `routes/championship.js` projects service results through one API, returning fresh state on conflicts. Every host mutation includes the observed revision and active championship ID. Never replay a conflict automatically.
- `routes/organizer.js` creates per-application PIN sessions, expiring in one hour. Restart clears sessions. Do not print the PIN.
- `lib/join-url.js` supplies the join URL from PUBLIC_BASE_URL or a direct host network address. Never trust the request Host header as the QR origin or present localhost as a reachable phone address.

## Frontend

The pages under `public/` use browser ES modules in `public/js/` and shared CSS. There is no bundler. `public/js/package.json` scopes those modules while server files remain CommonJS.

`championship-client.js` serializes polling, ignores stale revisions and delayed old-event replies, refreshes on visibility return, and retains the last good state on network failure. Local storage remembers a player selection and a retry-safe registration token scoped to its championship.

`ui.js` renders shared DOM elements using textContent for player names and owns polling stop/restart across cached browser navigation. Keep all names out of HTML interpolation. `organizer.js` keeps result drafts separate from polled state and requires explicit review after a conflicting revision. Result inputs and editor navigation stay disabled during a pending save. Preserve input and accessibility labels during polling.

## Test boundaries

Node tests use `node:test`, real SQLite files in temporary directories, and scoped application factories. Browser tests run a separate server with its own temporary database. Never read or reset the user's default tournament as test setup.

The automated full-event fixtures prove all scores, a mid-solo restart, shared ranks, playoff selection, champion withdrawal after correction, and live display updates. Real phone networking and Switch pacing are separate manual checks.

## Private prizes

`lib/championship-prizes.js` owns private configuration, raster artwork validation, display SVGs, and transactional award allocation. The additive prize tables keep settings and vendor images separate from public snapshots. The host configures currency, tier amounts, and up to twelve vendor options. Default amounts live only in server code.

Prize APIs under `/api/championship/:id/prizes` require the organizer session. Player prize and artwork requests require the registration capability in an Authorization bearer header, bound to both championship and player. A host-only endpoint generates a private recovery link with that capability in its URL fragment. `public/js/prize.js` imports the fragment into local storage and immediately removes it from the address. Do not put that token in a query, public snapshot, log, or image URL.

Awards are generated in the completion transaction and remain invisible to other players even after completion. Private artwork is fetched with authorization into object URLs. Completion withdrawal removes awards and seals the player view. Each completion issues a fresh reveal ID; vendor choice submissions must match it. Separate players' choices do not conflict on a global revision, and they never publish preference data in the public snapshot.

`prizes-admin.js` owns private host drafts, uploads, recovery links, and the vendor preference table. `prize.js` owns each player's reveal and preference. Purchases, codes, and actual card delivery are outside the feature.

Registered phones can confirm withdrawal through the player-bound bearer endpoint. `championship_players.withdrawn_at` retains their identity and prior results while future seats remain empty. Standings give withdrawn players no eligible rank; award `kind=consolation` uses the participation amount and exposes no finishing place. Empty events skip at the cursor; skipping waits during a pause and runs on resume. Completed result corrections use the recorded round roster. Retracting completion also reopens withdrawal until the revised tournament is completed.

The host records playoffs when equal point totals span different prize amounts. Private settings expose the required tied groups and places; the public snapshot does not. Completion accepts `prizePlayoffs` keyed by the tied group's starting rank, with player IDs in playoff order for only the required places. The first selection must agree with `playoffWinnerId` when first place is tied. Allocation validates the group membership and unique selections, preserves accumulated points, and persists settled places in the award rows in the same transaction as the champion declaration. Corrections clear awards and the host must enter fresh selections against the new revision. Equal-amount ties need no additional playoff.
