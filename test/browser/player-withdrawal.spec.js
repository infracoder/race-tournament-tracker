const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ request }) => {
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  const current = await (await request.get('/api/championship/current')).json();
  await request.post('/api/championship', { data: { expectedActiveId: current.championship?.id || null, seed: 'withdrawals-10' } });
});

test('a player confirms withdrawal on their own phone and other viewers cannot withdraw them', async ({ page, browser, request }, testInfo) => {
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('Casey');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByRole('heading', { name: 'Let’s go, Casey.' })).toBeVisible();
  const withdraw = page.getByRole('button', { name: 'Withdraw from tournament', exact: true });
  await expect(withdraw).toBeVisible();
  const context = await browser.newContext();
  try {
    const viewer = await context.newPage();
    await viewer.goto(page.url());
    await expect(viewer.getByRole('heading', { name: 'Let’s go, Casey.' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Withdraw from tournament', exact: true })).toBeHidden();
    page.once('dialog', dialog => dialog.dismiss());
    await withdraw.click();
    expect((await (await request.get('/api/championship/current')).json()).players[0].withdrawn_at).toBeNull();
    page.once('dialog', dialog => dialog.accept());
    await withdraw.click();
    await expect(page.locator('#withdrawalStatus')).toContainText('You’ve withdrawn');
    await expect(page.locator('#playerSubtitle')).toContainText('Withdrawn');
    await expect(page.locator('#myNextEvent')).toContainText('No more turns');
    await expect(page.locator('#myStandings')).toContainText('Withdrawn');
    await expect(withdraw).toBeHidden();
    await page.reload();
    await expect(page.locator('#withdrawalStatus')).toContainText('You’ve withdrawn');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('withdrawn-player-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('withdrawn-player-desktop.png'), fullPage: true });
  } finally { await context.close(); }
});

test('all players withdrawing still permits a private consolation reveal without crowning a champion', async ({ page, request }) => {
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('Casey');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByRole('button', { name: 'Withdraw from tournament', exact: true })).toBeVisible();
  let state = await (await request.get('/api/championship/current')).json();
  const id = state.championship.id;
  const token = await page.evaluate(id => localStorage.getItem(`mk:registration:${id}`), id);
  const tokens = { A: token };
  for (let i = 1; i < 9; i++) {
    const token = `browser-withdrawal-token-${i}`;
    const joined = await (await request.post(`/api/championship/${id}/players`, { data: { name: `Player ${i + 1}`, registrationToken: token } })).json();
    tokens[joined.player.id] = token;
    state = joined.snapshot;
  }
  state = await (await request.put(`/api/championship/${id}/prizes`, { data: { expectedRevision: state.revision, enabled: true, currency: 'CAD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1700 }, vendors: [{ name: 'Game shop' }] } })).json();
  state = await (await request.post(`/api/championship/${id}/start`, { data: { expectedRevision: state.revision } })).json();
  for (const player of state.players) {
    const response = await request.post(`/api/championship/${id}/players/${player.id}/withdraw`, { headers: { Authorization: `Bearer ${tokens[player.id]}` }, data: { expectedRevision: state.revision } });
    expect(response.status()).toBe(200);
    state = await response.json();
  }
  await page.getByRole('link', { name: 'My private prize' }).click();
  await expect(page.locator('#prizeHeading')).toHaveText('Your prize is sealed.');
  await expect(page.locator('#prizeAmount')).toBeEmpty();
  const host = await page.context().newPage();
  await host.goto('/organizer.html');
  await host.getByLabel('Organizer PIN').fill('browser-test-2468');
  await host.getByRole('button', { name: 'Open host controls' }).click();
  await expect(host.locator('#finishDescription')).toContainText('Everyone has withdrawn');
  await host.locator('#prizeSettingsPanel summary').click();
  await expect(host.locator('#prizeBudget')).toContainText('153.00');
  await host.getByRole('button', { name: 'Complete tournament', exact: true }).click();
  await expect(host.locator('#hostStatus')).toHaveText('Tournament complete');
  const hq = await page.context().newPage();
  await hq.goto('/');
  await expect(hq.locator('#upNext')).toContainText('That’s a wrap');
  await expect(page.getByRole('button', { name: 'Open my prize' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my prize' }).click();
  await expect(page.locator('#prizePlacement')).toContainText('Consolation prize');
  await expect(page.locator('#prizePlacement')).not.toContainText('place 0');
  await expect(page.locator('#prizeAmount')).toContainText('17.00');
  await page.getByRole('radio', { name: /Game shop/ }).check();
  await page.getByRole('button', { name: 'Save my choice' }).click();
  await expect(page.locator('#vendorChoiceMessage')).toContainText('Your choice is saved');
});

test('host preserves a draft when a player withdraws and reloads a result form with only remaining players', async ({ page, request }) => {
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('Casey');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByRole('button', { name: 'Withdraw from tournament', exact: true })).toBeVisible();
  let state = await (await request.get('/api/championship/current')).json();
  const id = state.championship.id;
  for (let i = 1; i < 9; i++) {
    const joined = await (await request.post(`/api/championship/${id}/players`, { data: { name: `Player ${i + 1}`, registrationToken: `host-withdrawal-token-${i}` } })).json();
    state = joined.snapshot;
  }
  const start = await request.post(`/api/championship/${id}/start`, { data: { expectedRevision: state.revision } });
  expect(start.status()).toBe(200);
  const host = await page.context().newPage();
  await host.goto('/organizer.html');
  await host.getByLabel('Organizer PIN').fill('browser-test-2468');
  await host.getByRole('button', { name: 'Open host controls' }).click();
  await expect(host.locator('#resultFields select')).toHaveCount(4);
  await host.getByRole('button', { name: 'Take a break', exact: true }).click();
  await expect(host.locator('#hostStatus')).toHaveText('Play paused');
  await expect(host.locator('#hostMessage')).toBeHidden();
  await host.getByRole('button', { name: 'Resume play', exact: true }).click();
  const firstId = await host.locator('#resultFields select').first().getAttribute('id');
  await host.locator(`#${firstId}`).selectOption('1');
  await host.getByRole('button', { name: 'Take a break', exact: true }).click();
  await expect(host.locator('#hostMessage')).toBeHidden();
  await expect(host.locator(`#${firstId}`)).toHaveValue('1');
  await host.getByRole('button', { name: 'Resume play', exact: true }).click();
  await expect(host.locator('#draftNotice')).toBeHidden();
  await expect(host.locator('#hostMessage')).toBeHidden();
  await expect(host.locator(`#${firstId}`)).toHaveValue('1');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Withdraw from tournament', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Withdraw from tournament', exact: true }).click();
  await expect(page.locator('#withdrawalStatus')).toContainText('You’ve withdrawn');
  await expect(host.locator('#draftNotice')).toBeVisible();
  await expect(host.locator(`#${firstId}`)).toHaveValue('1');
  await expect(host.getByRole('button', { name: 'Save result' })).toBeDisabled();
  await host.getByRole('button', { name: 'Reload saved result' }).click();
  await expect(host.locator('#resultFields select')).toHaveCount(3);
  await expect(host.getByLabel('Casey finish')).toHaveCount(0);
  for (let i = 0; i < 3; i++) await host.locator('#resultFields select').nth(i).selectOption(String(i + 1));
  await host.getByRole('button', { name: 'Save result' }).click();
  await expect(host.locator('#hostMessage')).toContainText('Result saved');
  const saved = await (await request.get('/api/championship/current')).json();
  expect(saved.active_slot.rounds[0].results).toHaveLength(3);
  expect(saved.active_slot.rounds[0].results.map(r => r.player_id)).not.toContain('A');
});


test('player controls recover after a temporary membership error', async ({ page }) => {
  let failOnce = true;
  await page.route('**/api/championship/*/players/*/membership', async route => {
    if (!failOnce) return route.continue();
    failOnce = false;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) });
  });
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('Casey');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByRole('button', { name: 'Withdraw from tournament', exact: true })).toBeVisible({ timeout: 10000 });
});

test('withdrawal stays closed after the first completion when the host corrects a score', async ({ page, request }) => {
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('Casey');
  await page.getByRole('button', { name: "I'm in" }).click();
  const withdraw = page.getByRole('button', { name: 'Withdraw from tournament', exact: true });
  await expect(withdraw).toBeVisible();
  let state = await (await request.get('/api/championship/current')).json();
  const id = state.championship.id;
  const token = await page.evaluate(id => localStorage.getItem(`mk:registration:${id}`), id);
  for (let i = 1; i < 9; i++) {
    state = (await (await request.post(`/api/championship/${id}/players`, { data: { name: `Player ${i + 1}`, registrationToken: `closed-withdrawal-player-${i}` } })).json()).snapshot;
  }
  state = await (await request.post(`/api/championship/${id}/start`, { data: { expectedRevision: state.revision } })).json();
  while (state.championship.status === 'running') {
    const round = state.active_round;
    const response = round
      ? await request.put(`/api/championship/${id}/rounds/${round.id}/result`, { data: {
        expectedRevision: state.revision,
        ...(round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: state.active_slot.participants.map(p => p.player_id).sort().map(id => [id]) })
      } })
      : await request.post(`/api/championship/${id}/advance`, { data: { expectedRevision: state.revision } });
    expect(response.status()).toBe(200);
    state = await response.json();
  }
  await expect(page.locator('#liveStatus')).toHaveText('Final results');
  await expect(withdraw).toBeVisible();
  state = await (await request.post(`/api/championship/${id}/complete`, { data: { expectedRevision: state.revision, playoffWinnerId: state.standings.find(p => p.rank === 1).id } })).json();
  await expect(page.locator('#liveStatus')).toHaveText('Champion crowned');
  await expect(withdraw).toBeHidden();
  const race = state.slots.find(s => s.category === 'race').rounds[0];
  const correction = await request.put(`/api/championship/${id}/rounds/${race.id}/result`, { data: { expectedRevision: state.revision, groups: race.results.map(r => [r.player_id]).reverse() } });
  expect(correction.status()).toBe(200);
  state = await correction.json();
  await expect(page.locator('#liveStatus')).toHaveText('Final results');
  await expect(withdraw).toBeHidden();
  const rejected = await request.post(`/api/championship/${id}/players/A/withdraw`, { headers: { Authorization: `Bearer ${token}` }, data: { expectedRevision: state.revision } });
  expect(rejected.status()).toBe(409);
});
