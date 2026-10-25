const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ request }) => {
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  const current = await (await request.get('/api/championship/current')).json();
  const created = await (await request.post('/api/championship', { data: { expectedActiveId: current.championship?.id || null, seed: 'browser-host' } })).json();
  for (let i = 0; i < 9; i++) await request.post(`/api/championship/${created.championship.id}/players`, { data: { name: `Player ${i + 1}`, registrationToken: `browser-registration-${i}` } });
});

test('organizer can save the current result and advance the event', async ({ page, request }) => {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.getByRole('button', { name: 'Start the tournament' }).click();
  const current = await (await request.get('/api/championship/current')).json();
  const slot = current.active_slot;
  if (current.active_round.mode === 'renegade') {
    await page.getByRole('radio', { name: /Cops/ }).check();
  } else {
    for (const [index, p] of slot.participants.entries()) await page.getByLabel(`${p.name} finish`).selectOption(String(index + 1));
  }
  await page.getByRole('button', { name: 'Save result' }).click();
  if (slot.category === 'solo') {
    await expect(page.locator('#editorEvent')).toContainText('Coin Runners');
    for (const [index, p] of slot.participants.entries()) await page.getByLabel(`${p.name} finish`).selectOption(String(index + 1));
    await page.getByRole('button', { name: 'Save result' }).click();
  }
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.locator('#hostProgress')).toContainText('1 / 27');
  await page.getByRole('button', { name: 'Take a break' }).click();
  await expect(page.getByRole('button', { name: 'Resume play' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('polling preserves a draft and requires review after a concurrent change', async ({ page, request }) => {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.getByRole('button', { name: 'Start the tournament' }).click();
  const state = await (await request.get('/api/championship/current')).json();
  if (state.active_round.mode === 'renegade') await page.getByRole('radio', { name: /Cops/ }).check();
  else await page.getByLabel(`${state.active_slot.participants[0].name} finish`).selectOption('1');
  await request.put(`/api/championship/${state.championship.id}/pause`, { data: { expectedRevision: state.revision, paused: true } });
  await expect(page.locator('#draftNotice')).toContainText('Your entries are preserved');
  if (state.active_round.mode === 'renegade') await expect(page.getByRole('radio', { name: /Cops/ })).toBeChecked();
  else await expect(page.getByLabel(`${state.active_slot.participants[0].name} finish`)).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Save result' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload saved result' }).click();
  await expect(page.locator('#draftNotice')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save result' })).toBeEnabled();
});

test('host can log back in after session loss without losing result entries', async ({ page, context, request }) => {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.getByRole('button', { name: 'Start the tournament' }).click();
  const state = await (await request.get('/api/championship/current')).json();
  if (state.active_round.mode === 'renegade') await page.getByRole('radio', { name: /Cops/ }).check();
  else for (const [index, p] of state.active_slot.participants.entries()) await page.getByLabel(`${p.name} finish`).selectOption(String(index + 1));
  await context.clearCookies();
  await page.getByRole('button', { name: 'Save result' }).click();
  await expect(page.locator('#loginMessage')).toContainText('entries are still here');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  if (state.active_round.mode === 'renegade') await expect(page.getByRole('radio', { name: /Cops/ })).toBeChecked();
  else for (const [index, p] of state.active_slot.participants.entries()) await expect(page.getByLabel(`${p.name} finish`)).toHaveValue(String(index + 1));
  await page.getByRole('button', { name: 'Save result' }).click();
  await expect(page.locator('#hostMessage')).toContainText('Result saved');
});

test('a delayed initial session check cannot undo a successful host login', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/organizer/check', async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await expect(page.getByRole('button', { name: 'Start the tournament' })).toBeVisible();
  const checked = page.waitForResponse(r => r.url().endsWith('/organizer/check'));
  release();
  await checked;
  await expect(page.getByRole('button', { name: 'Start the tournament' })).toBeVisible();
});

test('result fields and editor navigation stay locked until a slow save finishes', async ({ page, request }) => {
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.getByRole('button', { name: 'Start the tournament' }).click();
  const state = await (await request.get('/api/championship/current')).json();
  if (state.active_round.mode === 'renegade') await page.getByRole('radio', { name: /Cops/ }).check();
  else for (const [index, p] of state.active_slot.participants.entries()) await page.getByLabel(`${p.name} finish`).selectOption(String(index + 1));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/rounds/*/result', async route => {
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Save result' }).click();
    for (const control of await page.locator('#resultFields input, #resultFields select').all()) await expect(control).toBeDisabled();
    await expect(page.locator('#correctionRound')).toBeDisabled();
    await expect(page.locator('#reloadResult')).toBeDisabled();
    await expect(page.locator('#backToCurrent')).toBeDisabled();
    const saved = page.waitForResponse(r => r.url().endsWith('/result') && r.request().method() === 'PUT');
    release();
    expect((await saved).status()).toBe(200);
    await expect(page.locator('#hostMessage')).toContainText('Result saved');
    await expect(page.locator('#correctionRound')).toBeEnabled();
    for (const control of await page.locator('#resultFields input, #resultFields select').all()) await expect(control).toBeEnabled();
  } finally {
    release();
  }
});
