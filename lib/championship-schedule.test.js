const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateChampionshipSchedule, validateChampionshipSchedule } = require('./championship-schedule');

test('all seeds produce 27 slots, 36 rounds and fair individual/team rotation', () => {
  for (const seed of ['third-annual', 'family-night', '42']) {
    const { slots, metrics, initialMetrics } = generateChampionshipSchedule(seed);
    assert.equal(slots.length, 27);
    assert.equal(slots.flatMap(s => s.rounds).length, 36);
    for (const id of 'ABCDEFGHI') {
      const played = slots.filter(s => s.participants.some(p => p.player_id === id));
      for (const category of ['race', 'solo', 'team']) assert.equal(played.filter(s => s.category === category).length, 4);
      const partners = [], opponents = [], roles = [];
      for (const s of played.filter(s => s.category === 'team')) {
        const me = s.participants.find(p => p.player_id === id);
        roles.push(me.side);
        partners.push(...s.participants.filter(p => p.side === me.side && p.player_id !== id).map(p => p.player_id));
        opponents.push(...s.participants.filter(p => p.side !== me.side).map(p => p.player_id));
      }
      assert.equal(new Set(partners).size, 4);
      assert.equal(new Set(opponents).size, 8);
      assert.equal(roles.filter(r => r === 'cops').length, 2);
    }
    assert.ok(metrics.max_wait_minutes <= initialMetrics.max_wait_minutes);
    assert.deepEqual(validateChampionshipSchedule(slots), []);
  }
});

test('schedule is deterministic and validator rejects corrupt rosters', () => {
  const a = generateChampionshipSchedule('same');
  assert.deepEqual(a, generateChampionshipSchedule('same'));
  a.slots[0].participants[1].player_id = a.slots[0].participants[0].player_id;
  assert.ok(validateChampionshipSchedule(a.slots).length > 0);
});
