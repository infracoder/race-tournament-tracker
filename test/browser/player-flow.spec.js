const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ request }) => {
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  const current = await (await request.get('/api/championship/current')).json();
  const created = await request.post('/api/championship', { data: { expectedActiveId: current.championship?.id || null, seed: 'browser' } });
  expect(created.status()).toBe(201);
});

test('player joins, returns to their dashboard, and names render as text', async ({ page }) => {
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('<b>Casey</b>');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByRole('heading', { name: 'Let’s go, <b>Casey</b>.' })).toBeVisible();
  await expect(page.locator('#mySchedule .schedule-row')).toHaveCount(12);
  await expect(page.locator('#playerHeading b')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Let’s go, <b>Casey</b>.' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open my dashboard' })).toBeVisible();
  await expect(page.locator('#joinQr')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('retry after a lost registration reply recovers the same player', async ({ page, request }) => {
  let first = true;
  await page.route('**/api/championship/*/players', async route => {
    if (!first) return route.continue();
    first = false;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.goto('/register.html');
  await page.getByLabel('Your name', { exact: true }).fill('Avery');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.locator('#registerMessage')).toContainText('Your entries are still here');
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Avery');
  await page.getByRole('button', { name: "I'm in" }).click();
  await expect(page.getByRole('heading', { name: 'Let’s go, Avery.' })).toBeVisible();
  const state = await (await request.get('/api/championship/current')).json();
  expect(state.registered).toBe(1);
});

test('small phone layout keeps long names readable without page overflow', async ({ page, request }, testInfo) => {
  const state = await (await request.get('/api/championship/current')).json();
  await request.post(`/api/championship/${state.championship.id}/players`, { data: { name: 'AlexandertheUnstoppableKartChampion', registrationToken: 'small-phone-registration' } });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.locator('#registeredCount')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('race-hq-small-phone.png'), fullPage: true });
  await page.goto(`/player.html?t=${state.championship.id}&id=A`);
  await expect(page.locator('#personalContent')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
