# Tolsma Kart Championship 03

Run the third annual Mario Kart 8 Deluxe tournament from one shared website. Nine competitors play on one Switch, four at a time, while a separate host records results. Players use iPhone or Android browsers to join, follow their turns, and watch the standings.

## Start locally

Use Node.js 24 LTS (also recorded in `.nvmrc`).

```sh
npm ci
cp .env.example .env
```

Set your organizer PIN in `.env`, then start the server:

```sh
npm start
```

Open [Race HQ](http://localhost:3000) and [Host controls](http://localhost:3000/organizer.html). Log in, select **Set up tournament**, and share the join QR or link. Once nine players have registered, select **Start the tournament**.

The server listens on all network interfaces. Phones need to be on the host computer's WiFi, with access to its port. `localhost` on a phone points to that phone, so use the computer's WiFi address instead.

## Join address

Set `PUBLIC_BASE_URL` to the address phones can reach, especially with Docker or multiple network adapters:

```dotenv
PORT=3000
ORGANIZER_PIN=your-private-pin
DB_FILE=./tournament.db
PUBLIC_BASE_URL=http://192.168.1.100:3000
```

Use an HTTP(S) origin without a path or credentials. A working local hostname such as `http://mariokart.local:3000` also works if your network resolves it. When omitted, direct startup uses the first external IPv4 address; confirm that it is your WiFi adapter. The join link includes the tournament ID so an old link cannot register someone into a replacement event.

A returning player can reopen their saved dashboard or select their existing name on the join page. Retrying a registration after losing the reply recovers the same spot. Browser storage remembers the selection; it is not a private player account. Only the host can change results.

## The evening

There are **27 scheduled events and 36 gameplay rounds**:

| Category | Events | Each competitor plays | Scoring |
| --- | ---: | --- | --- |
| Race | 9 | 4 races | 25 / 18 / 15 / 12 by finish |
| Solo battle | 9 | 4 Balloon Battles + 4 Coin Runners | Average the two round scores in each event |
| Team battle | 9 | 4 Renegade Roundups, two vs two | Winners 25 each; losers 12 each |

Every competitor has four different teammates, faces each other competitor exactly once in team battles, and plays twice as cops and twice as robbers. The queue reduces long waits while keeping these participation rules. The same saved lineup survives refreshes, corrections, and restarts.

Each category has a 100-point ceiling, making the overall maximum **300 points**. Positions are relative to the four human competitors. Tied solo finishes share the points for the occupied places: two tied for first receive `(25 + 18) / 2 = 21.5` each. The host enters `1st, 1st, 3rd, 4th`. Scores use exact integer units internally, including three-way ties; the screen displays up to two decimal places.

A solo event keeps the same four players for Balloon Battle followed by Coin Runners. The first result and its wins are saved immediately, but championship points remain pending until both rounds are recorded. For example, first then fourth earns `(25 + 12) / 2 = 18.5` points.

The planning estimate is **218 minutes**, using six minutes per race/team event, ten per paired solo event, and twenty minutes of breaks. Actual play settings and controller changes need a Switch rehearsal. The host controls progression; there is no automatic timer.

## Run and finish

- Call the names and controller numbers under **Playing Now**. **Up Next** lets the next group prepare.
- Record four finishing positions, shared solo positions, or the winning team. Select **Save result**, then **Next event** once all rounds are saved.
- Select **Take a break** and **Resume play** to pause without changing the queue.
- Use **Correct a result** to replace a saved outcome. Points and wins recalculate without duplicate awards.
- After all events, confirm the points leader. Equal totals share a rank. If first place is tied, run a playoff and select its winner from the tied leaders.
- Completing the tournament reveals the champion on the shared screens. An effective correction afterward withdraws the declaration until the host confirms it again.

Host sessions last one hour and end on server restart. If a session expires during entry, log back in to recover the draft. Concurrent changes preserve the draft and require reloading the saved result; the app does not replay a stale submission automatically.

## Private gift-card prizes

In host controls, open **Gift-card prizes**, enable prizes, choose a currency, and save the amounts and vendor options. Defaults are 100 / 75 / 50 for the first three places and 15 for each of the other six players: a total budget of 315 in your chosen currency. These defaults and your saved configuration are returned only to the authenticated organizer.

Add the gift-card vendors you are offering. Each vendor includes a display card; you can upload your own PNG, JPEG, or WebP artwork up to 1 MB. Use ordinary display artwork without redemption codes. Amounts and vendor artwork stay out of public responses and assets before completion.

After you complete the tournament, each player opens **My private prize** from their dashboard to reveal their own amount and choose a vendor. Other players' prizes remain private. Vendor choices persist and appear in the host's prize panel so you can arrange the cards. Actual card purchases and delivery happen outside the app.

Select **Use saved settings for future tournaments** after saving your prize setup to remember its amounts, currency, vendors, and uploaded artwork. New tournaments use a separate copy of that setup automatically. Registrations, vendor choices, awards, and delivery records stay with their original tournament. Editing the current setup changes the default only when you save it again.

Under **Gift-card fulfillment**, mark each chosen card **Purchased** and then **Delivered**. Purchased cards lock the player's vendor choice; return the card to **To buy** if they need to choose again. Players see only their own status. Purchases from a retracted reveal remain in **Purchases from earlier results**, so a correction cannot erase cards you have already bought or handed out. Review that list before purchasing revised prizes.

The original registration phone provides private access automatically. For another device, select the player under **Help a player open their prize** and give them their private link. Treat that link as private: anyone holding it can view that player's prize. Selecting a public dashboard name alone does not grant access.

If equal points span different prize amounts, run playoffs and record the required finishing places in host controls before completing the tournament. First place uses the same playoff winner as the championship; lower tied groups have their own selectors. Players tied on equal prizes need no extra playoff. Points and public shared ranks stay unchanged; each private prize shows its settled finishing place. Only the places needed to distinguish amounts require a selection, so a nine-player tie with the default tiers needs the top three finishers.

Correcting completed results or changing prize settings/artwork seals the reveal and clears vendor choices. Complete the tournament again to assign the revised prizes and record fresh playoff placements when required. Old vendor submissions cannot apply to a new reveal.

## Persistence and older tournaments

Host controls include a persistent **event clock** with time in play, time in the current event, and an estimated finish. **Take a break** pauses both timers. Saving the last round stops that event's timer; **Next event** starts the next one. The play timer includes changeovers and stops when you advance past the final event. Refreshing or restarting the server preserves timing. Early estimates allow six minutes per round, then follow your pace after four played rounds; breaks, playoffs, and the prize reveal need additional time. Timing starts with play in newly started tournaments; historical play before this feature was installed cannot be reconstructed.

Players can choose **Withdraw from tournament** on their own phone's **My turn** dashboard any time before the host completes the event. Confirmation is final for that event. Their name, earned points, and completed results remain on record, but they leave the championship rankings and placement-prize playoffs. Their reserved spot remains theirs, including private prize access; it cannot be claimed by a new registration.

The first successful completion closes withdrawals permanently for that tournament. Correcting results or changing prizes afterward retracts the reveal so the host can complete it again, while withdrawals stay closed. Withdrawing during a break leaves the queue paused; resuming play skips newly empty events.

The schedule stays in place. Leave withdrawn players' seats empty and enter only the remaining players' finishing order, starting with first place. Remaining players use the usual 25/18/15/12 points. Team battles retain their assigned sides even when uneven; an empty side forfeits, and events with no remaining players are skipped automatically. If a player leaves between Balloon Battle and Coin Runners, their completed round still counts as half of that solo event and the other round earns zero. Saved results can still be corrected using the players who took part at the time.

With gift-card prizes enabled, withdrawn players receive the configurable **Everyone else / consolation** amount. That amount stays private until the host completes the tournament. They can reveal it and choose a vendor through the same private prize flow. If everybody withdraws, the host can finish the event and reveal consolation prizes without crowning a champion.

Ordinary startup adds championship tables without resetting existing data. A new championship archives the old event in the database, changes the active event, and rejects changes from old links. There is currently no archive browsing screen.

The older configurable race tournament tables and `/api/tournament`, `/api/players`, `/api/races`, and `/api/battle` routes remain available for compatibility. The new screens use `/api/championship` and the nine-player format above. The legacy `npm run db:reset` command seeds only the older tournament; it does not set up the new championship. Avoid it during a real event.

Back up the SQLite file while the server is stopped before moving or upgrading an event. Keep `DB_FILE` pointed at the same persistent file to resume it.

## Docker

```sh
cp .env.example .env
# Set ORGANIZER_PIN and PUBLIC_BASE_URL in .env first.
docker compose up --build -d
```

The image uses Node 24 and stores its database in the mounted `./data` directory. Docker publishes port 80 for **http://mariokart.local** and keeps port 3000 available for existing links. Its default join origin is `http://mariokart.local`; set `PUBLIC_BASE_URL` in `.env` to override it. The origin must name the host computer, not the container's internal address. `docker compose down` stops the service while retaining `./data`; do not delete that directory to upgrade.

On the Mac host, run `npm run mdns:start` to advertise **http://mariokart.local** to phones on the same WiFi. `npm run mdns:stop` removes the advertisement. The publisher runs as a managed service for the current login session; start it again after restarting the Mac. `npm run docker:up` starts Docker and the local-name service together. For direct Node startup on port 3000, use `MDNS_PORT=3000 npm run mdns:start` and a matching `PUBLIC_BASE_URL`.

Use the same address on a phone after registering so its private player access stays remembered.

## Development and verification

```sh
npm run dev
npm test
npx playwright install chromium webkit
npm run test:browser
```

Unit, storage, API, and full-event tests create disposable SQLite files. Browser tests use a separate server on port 3108. They do not open or reset the default tournament database. The classic generator remains covered by `npm run test:schedule`.

See [TESTING.md](TESTING.md) for verification results, container smoke steps, real-phone checks, and the console pacing rehearsal. No lint or TypeScript check is configured.
