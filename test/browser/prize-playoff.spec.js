const { test, expect } = require('@playwright/test');

test('identical names remain distinct in championship and lower prize playoffs', async ({ page, request }) => {
  test.setTimeout(90000);
  await request.post('/api/organizer/login', { data: { pin: 'browser-test-2468' } });
  let state = await (await request.get('/api/championship/current')).json();
  state = await (await request.post('/api/championship', { data: { expectedActiveId: state.championship?.id || null, seed: 'browser-rehearsal' } })).json();
  const id = state.championship.id;
  for (let i = 0; i < 9; i++) await request.post(`/api/championship/${id}/players`, { data: { name: i < 2 ? 'Sam' : `Player ${i + 1}`, registrationToken: `same-name-registration-${i}` } });
  state = await (await request.get('/api/championship/current')).json();
  state = await (await request.put(`/api/championship/${id}/prizes`, { data: { expectedRevision: state.revision, enabled: true, currency: 'USD', tiers: { first: 10000, second: 7500, third: 5000, participation: 1500 }, vendors: [{ name: 'Game shop' }] } })).json();
  state = await (await request.post(`/api/championship/${id}/start`, { data: { expectedRevision: state.revision } })).json();
  while (state.championship.status === 'running') {
    const slot = state.active_slot;
    for (const round of slot.rounds) {
      const response = await request.put(`/api/championship/${id}/rounds/${round.id}/result`, { data: {
        expectedRevision: state.revision,
        ...(round.mode === 'renegade' ? { winningSide: 'cops' } : { groups: round.mode === 'race' ? slot.participants.map(p => [p.player_id]) : [slot.participants.map(p => p.player_id)] })
      } });
      expect(response.status()).toBe(200);
      state = await response.json();
    }
    state = await (await request.post(`/api/championship/${id}/advance`, { data: { expectedRevision: state.revision } })).json();
  }
  await page.goto('/organizer.html');
  await page.getByLabel('Organizer PIN').fill('browser-test-2468');
  await page.getByRole('button', { name: 'Open host controls' }).click();
  const second = page.getByLabel('Playoff place 2', { exact: true });
  const third = page.getByLabel('Playoff place 3', { exact: true });
  await expect(second).toContainText('Sam · Player A');
  await expect(second).toContainText('Sam · Player B');
  await page.getByLabel('Playoff winner', { exact: true }).selectOption('C');
  await second.selectOption({ label: 'Sam · Player B' });
  await third.selectOption({ label: 'Sam · Player A' });
  await page.getByLabel('Playoff winner', { exact: true }).selectOption('A');
  await expect(third).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Complete tournament' })).toBeDisabled();
  const race = state.slots.find(slot => slot.category === 'race' && !['A', 'B'].includes(slot.participants[0].player_id) && !['A', 'B'].includes(slot.participants[3].player_id));
  expect(race).toBeTruthy();
  const groups = race.participants.map(p => [p.player_id]);
  [groups[0], groups[3]] = [groups[3], groups[0]];
  state = await (await request.put(`/api/championship/${id}/rounds/${race.rounds[0].id}/result`, { data: { expectedRevision: state.revision, groups } })).json();
  expect(state.standings.filter(p => p.rank === 1)).toHaveLength(1);
  await expect(page.getByLabel('Playoff winner', { exact: true })).toBeHidden();
  await expect(second).toHaveValue('');
  await expect(third).toHaveValue('');
  await second.selectOption({ label: 'Sam · Player B' });
  await third.selectOption({ label: 'Sam · Player A' });
  await page.getByRole('button', { name: 'Complete tournament' }).click();
  await expect(page.locator('#hostChampion')).toContainText(state.standings[0].name);
  for (const [player, registration, cents, place] of [['A', 0, 5000, 3], ['B', 1, 7500, 2]]) {
    const prize = await (await request.get(`/api/championship/${id}/players/${player}/prize`, { headers: { Authorization: `Bearer same-name-registration-${registration}` } })).json();
    expect(prize.award.amount_cents).toBe(cents);
    expect(prize.award.place).toBe(place);
  }
  expect((await (await request.get('/api/championship/current')).json()).standings).toEqual(state.standings);
});
