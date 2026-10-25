const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreIndividual, scoreTeam, calculateStandings } = require('./championship-scoring');

test('individual scoring pools tied places with exact twelfths', () => {
  const result = scoreIndividual([['A', 'B', 'C'], ['D']]);
  assert.deepEqual(result.map(r => r.score_units), [232, 232, 232, 144]);
  assert.deepEqual(result.map(r => r.rank), [1, 1, 1, 4]);
  assert.throws(() => scoreIndividual([['A', 'A'], ['B'], ['C']]));
  assert.throws(() => scoreIndividual([['A', 'B'], ['C'], ['D']], false));
});

test('solo points wait for both rounds and then average exactly', () => {
  const players = ['A', 'B', 'C', 'D'].map(id => ({ id, letter: id, name: id }));
  const slot = { category: 'solo', participants: players.map(p => ({ player_id: p.id })), rounds: [
    { mode: 'balloon', completed: true, results: scoreIndividual([['A', 'B', 'C'], ['D']]) },
    { mode: 'coin', completed: false, results: [] }
  ] };
  assert.equal(calculateStandings(players, [slot])[0].total_units, 0);
  slot.rounds[1] = { mode: 'coin', completed: true, results: scoreIndividual([['A'], ['B'], ['C'], ['D']]) };
  const a = calculateStandings(players, [slot]).find(p => p.id === 'A');
  assert.equal(a.total_units, 266);
  assert.equal(a.wins.balloon, 1);
  assert.equal(a.wins.coin, 1);
});

test('team points are identical for both teammates and equal totals share rank', () => {
  const participants = ['A', 'B', 'C', 'D'].map((id, i) => ({ player_id: id, side: i < 2 ? 'cops' : 'robbers' }));
  const results = scoreTeam(participants, 'cops');
  assert.deepEqual(results.map(r => r.score_units), [300, 300, 144, 144]);
  const players = participants.map(p => ({ id: p.player_id, letter: p.player_id, name: p.player_id }));
  const standings = calculateStandings(players, [{ category: 'team', participants, rounds: [{ mode: 'renegade', completed: true, results }] }]);
  assert.deepEqual(standings.map(p => p.rank), [1, 1, 3, 3]);
});
