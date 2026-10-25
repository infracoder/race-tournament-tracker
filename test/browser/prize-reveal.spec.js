const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ request }) => {
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  const current = await (await request.get('/api/championship/current')).json();
  const created = await (await request.post('/api/championship', { data: { expectedActiveId: current.championship?.id || null, seed: 'browser-prizes' } })).json();
  for (let i = 0; i < 9; i++) await request.post(`/api/championship/${created.championship.id}/players`, { data: { name: `Player ${i + 1}`, registrationToken: `prize-browser-token-${i}` } });
});

test('private prize fields wait for their saved settings before accepting edits', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/championship/*/prizes', async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.locator('#prizeSettingsPanel summary').click();
  try { await expect(page.getByLabel('First place', { exact: true })).toBeDisabled(); }
  finally { release(); }
  await expect(page.getByLabel('First place', { exact: true })).toHaveValue('100.00');
  await expect(page.getByLabel('First place', { exact: true })).toBeEnabled();
});

test('host configures private amounts and vendor choices without leaking them to a player', async ({ page, request, browser }) => {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.locator('#prizeSettingsPanel summary').click();
  await expect(page.getByLabel('First place', { exact: true })).toHaveValue('100.00');
  await page.getByLabel('Enable gift-card prizes').check();
  await page.getByLabel('Prize currency').selectOption('CAD');
  await page.getByLabel('First place', { exact: true }).fill('123.45');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await page.getByLabel('Vendor name').fill('Secret Jade Card');
  await page.getByRole('button', { name: 'Save private prize settings' }).click();
  await expect(page.locator('#prizeSettingsMessage')).toContainText('settings saved');
  await expect(page.locator('#prizeSetupStatus')).toContainText('PRIZES ENABLED');
  await page.getByLabel('Player for private prize link').selectOption('A');
  await page.getByRole('button', { name: 'Get private prize link' }).click();
  await expect(page.locator('#privatePrizeLink')).toHaveValue(/#key=/);
  const privateLink = await page.locator('#privatePrizeLink').inputValue();
  const state = await (await request.get('/api/championship/current')).json();
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const playerPage = await playerContext.newPage();
  const link = new URL(privateLink);
  await playerPage.goto(`http://127.0.0.1:3108${link.pathname}${link.search}${link.hash}`);
  await expect(playerPage.locator('#prizeHeading')).toHaveText('Your prize is sealed.');
  await expect(playerPage.locator('#openPrize')).toBeHidden();
  expect(playerPage.url()).not.toContain('#key=');
  await expect(playerPage.locator('body')).not.toContainText('123.45');
  await expect(playerPage.locator('body')).not.toContainText('Secret Jade Card');
  expect(JSON.stringify(state)).not.toContain('Secret Jade Card');
  await playerContext.close();
});

test('private prize drafts survive session recovery and clear on explicit logout', async ({ page, context }) => {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.locator('#prizeSettingsPanel summary').click();
  await expect(page.getByLabel('First place', { exact: true })).toHaveValue('100.00');
  await page.getByLabel('Enable gift-card prizes').check();
  await page.getByLabel('Prize currency').selectOption('CAD');
  await page.getByLabel('First place', { exact: true }).fill('111.11');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await page.getByLabel('Vendor name').fill('Draft vendor');
  await context.clearCookies();
  await page.getByRole('button', { name: 'Save private prize settings' }).click();
  await expect(page.locator('#loginMessage')).toContainText('entries are still here');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await expect(page.getByLabel('First place', { exact: true })).toHaveValue('111.11');
  await expect(page.getByLabel('Vendor name')).toHaveValue('Draft vendor');
  await page.getByRole('button', { name: 'Save private prize settings' }).click();
  await expect(page.locator('#prizeSettingsMessage')).toContainText('settings saved');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.locator('#hostContent')).toBeHidden();
  await expect(page.locator('#prize-first')).toHaveValue('');
  await expect(page.locator('#prizeVendors')).toBeEmpty();
});

test('each player privately reveals a prize, chooses a vendor, and loses the reveal after correction', async ({ page, request, browser }, testInfo) => {
  test.setTimeout(90000);
  let state = await (await request.get('/api/championship/current')).json();
  const id = state.championship.id;
  await request.put(`/api/championship/${id}/prizes`, { data: { expectedRevision: state.revision, enabled: true, currency: 'USD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Jade Card' }, { name: 'Saffron Card' }] } });
  const link = (await (await request.get(`/api/championship/${id}/players/A/prize-link`)).json()).path;
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`http://127.0.0.1:3108${link}`);
  await expect(playerPage.locator('#openPrize')).toBeHidden();
  state = await (await request.get('/api/championship/current')).json();
  state = await (await request.post(`/api/championship/${id}/start`, { data: { expectedRevision: state.revision } })).json();
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) state = await (await request.put(`/api/championship/${id}/rounds/${round.id}/result`, { data: {
      expectedRevision: state.revision,
      ...(round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: slot.participants.map(p => p.player_id).sort().map(id => [id]) })
    } })).json();
    state = await (await request.post(`/api/championship/${id}/advance`, { data: { expectedRevision: state.revision } })).json();
  }
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.getByRole('button', { name: 'Complete tournament' }).click();
  await expect(playerPage.getByRole('button', { name: 'Open my prize' })).toBeVisible();
  await playerPage.getByRole('button', { name: 'Open my prize' }).click();
  await expect(playerPage.locator('#prizeAmount')).toHaveText('$100.00');
  await expect(playerPage.locator('.vendor-choice-image:visible')).toHaveCount(2);
  await playerPage.getByRole('radio', { name: /Saffron Card/ }).check();
  const otherPrize = await (await request.get(`/api/championship/${id}/players/B/prize`, { headers: { Authorization: 'Bearer prize-browser-token-1' } })).json();
  await request.put(`/api/championship/${id}/players/B/prize/vendor`, { headers: { Authorization: 'Bearer prize-browser-token-1' }, data: { vendorId: otherPrize.vendors[0].id, revealId: otherPrize.award.reveal_id } });
  await playerPage.waitForResponse(response => response.url().endsWith('/players/A/prize'));
  await expect(playerPage.getByRole('radio', { name: /Saffron Card/ })).toBeChecked();
  await playerPage.screenshot({ path: testInfo.outputPath('private-prize-phone.png'), fullPage: true });
  await playerPage.getByRole('button', { name: 'Save my choice' }).click();
  await expect(playerPage.locator('#vendorChoiceMessage')).toContainText('Your choice is saved');
  await playerPage.reload();
  await playerPage.getByRole('button', { name: 'Open my prize' }).click();
  await expect(playerPage.getByRole('radio', { name: /Saffron Card/ })).toBeChecked();
  await page.locator('#prizeSettingsPanel summary').click();
  await expect(page.locator('#prizeOrders')).toContainText('Saffron Card');
  state = await (await request.get('/api/championship/current')).json();
  const team = state.slots.find(slot => slot.category === 'team');
  await request.put(`/api/championship/${id}/rounds/${team.rounds[0].id}/result`, { data: { expectedRevision: state.revision, winningSide: 'robbers' } });
  await expect(playerPage.locator('#revealedPrize')).toBeHidden();
  await expect(playerPage.locator('#prizeAmount')).toHaveText('');
  await expect(playerPage.locator('#openPrize')).toBeHidden();
  expect(await playerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await playerContext.close();
});
