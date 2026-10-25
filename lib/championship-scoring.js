const POINTS_SCALE = 12;
const PLACEMENT_UNITS = [300, 216, 180, 144];

function scoreIndividual(groups, allowTies = true) {
  if (!Array.isArray(groups) || !groups.length || groups.some((g) => !Array.isArray(g) || !g.length)) {
    throw new Error('Enter all four players in finish order.');
  }
  const ids = groups.flat();
  if (ids.length !== 4 || new Set(ids).size !== 4 || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Each of the four players must appear exactly once.');
  }
  if (!allowTies && groups.some((g) => g.length !== 1)) throw new Error('Race placements must be unique.');
  let place = 0;
  return groups.flatMap((group) => {
    const rank = place + 1;
    const score_units =
      PLACEMENT_UNITS.slice(place, place + group.length).reduce((a, b) => a + b, 0) / group.length;
    place += group.length;
    return group.map((player_id) => ({ player_id, rank, score_units }));
  });
}

function scoreTeam(participants, winnerSide) {
  if (
    !['cops', 'robbers'].includes(winnerSide) ||
    participants.length !== 4 ||
    new Set(participants.map((p) => p.player_id)).size !== 4 ||
    ['cops', 'robbers'].some((side) => participants.filter((p) => p.side === side).length !== 2)
  ) {
    throw new Error('Select the winning side from this two-versus-two battle.');
  }
  return participants.map((p) => ({
    player_id: p.player_id,
    rank: p.side === winnerSide ? 1 : 2,
    score_units: p.side === winnerSide ? 300 : 144
  }));
}

function calculateStandings(players, slots) {
  const standings = players.map((p) => ({
    ...p,
    total_units: 0,
    category_units: { race: 0, solo: 0, team: 0 },
    wins: { race: 0, balloon: 0, coin: 0, team: 0 },
    slots_completed: 0,
    slots_total: 0
  }));
  const byId = new Map(standings.map((p) => [p.id, p]));
  for (const slot of slots) {
    const complete = slot.rounds.length > 0 && slot.rounds.every((r) => r.completed);
    for (const member of slot.participants) {
      const p = byId.get(member.player_id);
      if (!p) continue;
      p.slots_total++;
      if (complete) p.slots_completed++;
      let units = 0;
      for (const round of slot.rounds) {
        if (!round.completed) continue;
        const result = round.results.find((r) => r.player_id === p.id);
        if (!result) throw new Error('A completed round is missing a player result.');
        units += result.score_units;
        if (result.rank === 1) p.wins[round.mode === 'renegade' ? 'team' : round.mode]++;
      }
      if (complete) {
        const awarded = slot.category === 'solo' ? units / 2 : units;
        if (!Number.isSafeInteger(awarded)) throw new Error('Invalid score precision.');
        p.category_units[slot.category] += awarded;
        p.total_units += awarded;
      }
    }
  }
  standings.sort((a, b) => b.total_units - a.total_units || a.letter.localeCompare(b.letter));
  let rank = 0;
  standings.forEach((p, index) => {
    if (!index || p.total_units !== standings[index - 1].total_units) rank = index + 1;
    p.rank = rank;
  });
  return standings;
}

module.exports = { POINTS_SCALE, scoreIndividual, scoreTeam, calculateStandings };
