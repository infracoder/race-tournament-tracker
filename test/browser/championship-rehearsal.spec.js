const { test, expect } = require('@playwright/test');

test('full championship, playoff reveal, and a correction update every screen', async ({ page, context, request }) => {
  test.setTimeout(120000);
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  let state = await (await request.get('/api/championship/current')).json();
  state = await (await request.post('/api/championship', { data: { expectedActiveId: state.championship?.id || null, seed: 'browser-rehearsal' } })).json();
  const id = state.championship.id;
  for (let i = 0; i < 9; i++) await request.post(`/api/championship/${id}/players`, { data: { name: `Racer ${i + 1}`, registrationToken: `rehearsal-browser-${i}` } });
  state = await (await request.get('/api/championship/current')).json();
  expect((await request.put(`/api/championship/${id}/prizes`, { data: { expectedRevision: state.revision, enabled: true, currency: 'USD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Game shop' }] } })).status()).toBe(200);
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  await page.getByRole('button', { name: 'Start the tournament' }).click();
  const publicPage = await context.newPage();
  await publicPage.goto('/leaderboard.html');
  state = await (await request.get('/api/championship/current')).json();
  let rounds = 0;
  async function save() {
    const response = page.waitForResponse(r => r.url().endsWith('/result') && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save result' }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    return result.json();
  }
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) {
      if (round.mode === 'renegade') await page.getByRole('radio', { name: /Cops/ }).check();
      else for (const [index, p] of slot.participants.entries()) await page.getByLabel(`${p.name} finish`).selectOption(round.mode === 'race' ? String(index + 1) : '1');
      state = await save();
      rounds++;
      if (slot.category === 'solo' && round.order === 1) await expect(page.locator('#editorEvent')).toContainText('points pending Coin Runners');
    }
    const advanced = page.waitForResponse(r => r.url().endsWith('/advance'));
    await page.getByRole('button', { name: 'Next event' }).click();
    state = await (await advanced).json();
  }
  expect(rounds).toBe(36);
  expect(state.standings.map(p => p.total_units / 12)).toEqual(Array(9).fill(214));
  await expect(page.locator('#finishDescription')).toContainText('First place is tied');
  await expect(page.getByRole('button', { name: 'Complete tournament' })).toBeDisabled();
  await page.getByLabel('Playoff winner', { exact: true }).selectOption('C');
  await expect(page.getByRole('button', { name: 'Complete tournament' })).toBeDisabled();
  await page.getByLabel('Playoff place 2', { exact: true }).selectOption('A');
  await expect(page.getByLabel('Playoff place 3', { exact: true }).locator('option[value="A"]')).toHaveCount(0);
  await page.getByLabel('Playoff place 3', { exact: true }).selectOption('I');
  await page.waitForResponse(response => response.url().endsWith('/api/championship/current'));
  await expect(page.getByLabel('Playoff place 2', { exact: true })).toHaveValue('A');
  await expect(page.getByLabel('Playoff place 3', { exact: true })).toHaveValue('I');
  await page.getByRole('button', { name: 'Complete tournament' }).click();
  await expect(page.locator('#hostChampion')).toContainText('Racer 3');
  await expect(publicPage.locator('#leaderboardChampion')).toContainText('Racer 3');
  await expect(publicPage.locator('#leaderboardChampion')).toContainText('Playoff winner');
  const owned = await (await request.get(`/api/championship/${id}/players/A/prize`, { headers: { Authorization: 'Bearer rehearsal-browser-0' } })).json();
  expect(owned.award.amount_cents).toBe(7500);
  expect(owned.award.place).toBe(2);
  const teamSlot = state.slots.find(slot => slot.category === 'team');
  await page.getByLabel('Saved round').selectOption(teamSlot.rounds[0].id);
  await page.getByRole('button', { name: 'Review result' }).click();
  await page.getByRole('radio', { name: /Robbers/ }).check();
  state = await save();
  await expect(page.locator('#hostChampion')).toBeHidden();
  await expect(publicPage.locator('#leaderboardChampion')).toBeHidden();
  expect(state.championship.status).toBe('awaiting_champion');
  expect((await (await request.get(`/api/championship/${id}/players/A/prize`, { headers: { Authorization: 'Bearer rehearsal-browser-0' } })).json()).locked).toBe(true);
  const leaders = state.standings.filter(p => p.rank === 1);
  await expect(page.getByLabel('Playoff winner', { exact: true })).toHaveValue('');
  if (leaders.length > 1) await page.getByLabel('Playoff winner', { exact: true }).selectOption(leaders[0].id);
  const settings = await (await request.get(`/api/championship/${id}/prizes`)).json();
  for (const group of settings.playoffs) {
    for (const place of group.places.filter(place => place !== 1)) {
      const select = page.getByLabel(`Playoff place ${place}`, { exact: true });
      const value = await select.locator('option').evaluateAll(options => options.find(option => option.value)?.value);
      await select.selectOption(value);
    }
  }
  await page.getByRole('button', { name: 'Complete tournament' }).click();
  await expect(publicPage.locator('#leaderboardChampion')).toContainText(leaders[0].name);
  expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await publicPage.close();
});
