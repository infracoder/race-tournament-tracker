const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ request }) => {
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  const current = await (await request.get('/api/championship/current')).json();
  const created = await (await request.post('/api/championship', { data: { expectedActiveId: current.championship?.id || null, seed: 'host-management' } })).json();
  for (let i = 0; i < 9; i++) await request.post(`/api/championship/${created.championship.id}/players`, { data: { name: `Player ${i + 1}`, registrationToken: `host-management-player-${i}` } });
});

async function openHost(page) {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await expect(page.locator('#hostContent')).toBeVisible();
}

test('the host can reuse a private prize setup in a fresh tournament', async ({ page, request }) => {
  await openHost(page);
  await page.locator('#prizeSettingsPanel summary').click();
  await expect(page.getByLabel('First place', { exact: true })).toHaveValue('100.00');
  await page.getByLabel('Enable gift-card prizes').check();
  await page.getByLabel('Prize currency').selectOption('CAD');
  await page.getByLabel('First place', { exact: true }).fill('125.00');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await page.getByLabel('Vendor name').fill('Saved Jade');
  await expect(page.getByRole('button', { name: 'Use saved settings for future' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save private prize settings' }).click();
  await expect(page.locator('#prizeSettingsMessage')).toContainText('settings saved');
  try {
    await page.getByRole('button', { name: 'Use saved settings for future' }).click();
    await expect(page.locator('#prizeDefaultsStatus')).toContainText('automatically');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'New tournament', exact: true }).click();
    await expect(page.getByLabel('First place', { exact: true })).toHaveValue('125.00');
    await expect(page.getByLabel('Vendor name')).toHaveValue('Saved Jade');
    await expect(page.getByLabel('Prize currency')).toHaveValue('CAD');
    await expect(page.locator('#hostRegistration')).toHaveText('0 / 9 REGISTERED');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    // Restore the disposable server's default so other browser scenarios stay independent.
    let state = await (await request.get('/api/championship/current')).json();
    state = await (await request.put(`/api/championship/${state.championship.id}/prizes`, { data: {
      expectedRevision: state.revision, enabled: false, currency: '',
      tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: []
    } })).json();
    await request.post(`/api/championship/${state.championship.id}/prizes/defaults`, { data: { expectedRevision: state.revision } });
  }
});

test('the event clock survives refresh and a break on a phone', async ({ page }) => {
  await openHost(page);
  await expect(page.locator('#estimatedFinish')).toHaveText('Waiting to start');
  await page.getByRole('button', { name: 'Start the tournament' }).click();
  await expect(page.locator('#playRemaining')).toHaveText('216 min');
  await expect(page.locator('#estimatedFinish')).not.toHaveText('Waiting to start');
  await expect(page.locator('#playElapsed')).not.toHaveText('00:00');
  await page.getByRole('button', { name: 'Take a break' }).click();
  await expect(page.locator('#estimatedFinish')).toHaveText('On a break');
  const paused = await page.locator('#playElapsed').textContent();
  await page.reload();
  await expect(page.locator('#hostContent')).toBeVisible();
  await expect(page.locator('#playElapsed')).toHaveText(paused);
  await expect(page.locator('#estimatedFinish')).toHaveText('On a break');
  await page.getByRole('button', { name: 'Resume play' }).click();
  await expect(page.locator('#playElapsed')).not.toHaveText(paused);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('host purchase and delivery statuses reach only the owning player and retain corrected purchases', async ({ page, request, browser }, testInfo) => {
  test.setTimeout(90000);
  let state = await (await request.get('/api/championship/current')).json();
  const id = state.championship.id;
  state = await (await request.put(`/api/championship/${id}/prizes`, { data: {
    expectedRevision: state.revision, enabled: true, currency: 'CAD',
    tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Jade Card' }]
  } })).json();
  state = await (await request.post(`/api/championship/${id}/start`, { data: { expectedRevision: state.revision } })).json();
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) state = await (await request.put(`/api/championship/${id}/rounds/${round.id}/result`, { data: {
      expectedRevision: state.revision,
      ...(round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: slot.participants.map(p => p.player_id).sort().map(id => [id]) })
    } })).json();
    state = await (await request.post(`/api/championship/${id}/advance`, { data: { expectedRevision: state.revision } })).json();
  }
  state = await (await request.post(`/api/championship/${id}/complete`, { data: { expectedRevision: state.revision } })).json();
  await openHost(page);
  await page.locator('#prizeSettingsPanel summary').click();
  const status = page.getByLabel('Gift-card status for Player 1', { exact: true });
  await expect(status).toBeDisabled();
  const link = (await (await request.get(`/api/championship/${id}/players/A/prize-link`)).json()).path;
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const player = await playerContext.newPage();
    await player.goto(`http://127.0.0.1:3108${link}`);
    await player.getByRole('button', { name: 'Open my prize' }).click();
    await player.getByRole('radio', { name: /Jade Card/ }).check();
    await player.getByRole('button', { name: 'Save my choice' }).click();
    await expect(status).toBeEnabled();
    const fulfillmentRoute = '**/players/A/prize/fulfillment';
    await page.route(fulfillmentRoute, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary save failure.' }) }));
    await status.selectOption('purchased');
    await expect(page.locator('#prizeSettingsMessage')).toContainText('Could not confirm');
    await expect(status).toHaveValue('pending');
    await expect(player.getByRole('radio', { name: /Jade Card/ })).toBeEnabled();
    await page.unroute(fulfillmentRoute);
    await page.context().clearCookies();
    await status.selectOption('purchased');
    await expect(page.locator('#loginMessage')).toContainText('entries are still here');
    await page.getByLabel('Organizer PIN').fill('browser-test-2468');
    await page.getByRole('button', { name: 'Open host controls' }).click();
    await expect(status).toHaveValue('pending');
    await expect(page.locator('#prizeSettingsMessage')).toContainText('Could not confirm');
    await status.selectOption('purchased');
    await expect(page.locator('#prizeOrderSummary')).toContainText('1 purchased');
    await expect(player.locator('#vendorChoiceMessage')).toContainText('has purchased');
    await expect(player.getByRole('radio', { name: /Jade Card/ })).toBeDisabled();
    await page.reload();
    await page.locator('#prizeSettingsPanel summary').click();
    await expect(status).toHaveValue('purchased');
    await status.selectOption('delivered');
    await expect(player.locator('#vendorChoiceMessage')).toContainText('delivered');
    await expect(page.locator('#prizeOrderSummary')).toContainText('1 delivered');
    await page.screenshot({ path: testInfo.outputPath('host-fulfillment-phone.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const team = state.slots.find(s => s.category === 'team');
    state = await (await request.get('/api/championship/current')).json();
    await request.put(`/api/championship/${id}/rounds/${team.rounds[0].id}/result`, { data: { expectedRevision: state.revision, winningSide: 'robbers' } });
    await expect(page.locator('#earlierPrizePurchases')).toContainText('Jade Card');
    await expect(page.locator('#earlierPrizePurchases')).toContainText('Delivered');
    await expect(player.locator('#revealedPrize')).toBeHidden();
  } finally { await playerContext.close(); }
});
