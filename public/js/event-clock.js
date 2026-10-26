export function clockStats(state, now = Date.now()) {
  const clock = state?.clock;
  if (!clock) return null;
  const elapsed = (amount, since) => amount + (since == null ? 0 : Math.max(0, now - since));
  const elapsedMs = elapsed(clock.elapsed_ms, clock.running_since);
  const rounds = state.slots.flatMap(slot => slot.rounds);
  const played = rounds.filter(round => round.completed && !round.skipped).length;
  const remaining = state.slots
    .filter(slot => slot.participants.some(player => !player.withdrawn_at))
    .flatMap(slot => slot.rounds).filter(round => !round.completed).length;
  const estimatedMs = remaining * (played >= 4 ? elapsedMs / played : 360000);
  return {
    elapsedMs,
    eventMs: elapsed(clock.event_elapsed_ms, clock.event_running_since),
    estimatedMs,
    estimatedFinish: clock.running_since != null && remaining ? now + estimatedMs : null,
    measuredPace: played >= 4,
    remaining
  };
}

export function duration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 3600) > 0 ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function renderEventClock(state) {
  const stats = clockStats(state);
  const registration = state.championship.status === 'registration';
  const finished = ['awaiting_champion', 'completed'].includes(state.championship.status) || stats?.remaining === 0;
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  set('playElapsed', stats ? duration(stats.elapsedMs) : registration ? '00:00' : 'Not recorded');
  set('eventElapsed', stats ? duration(stats.eventMs) : registration ? '00:00' : 'Not recorded');
  set('playRemaining', finished ? '0 min' : stats ? `${Math.ceil(stats.estimatedMs / 60000)} min` : registration ? 'About 3–4 hours' : 'Not estimated');
  let finish = registration ? 'Waiting to start' : 'Timing not recorded';
  if (finished) finish = 'Events complete';
  else if (state.championship.paused) finish = 'On a break';
  else if (stats?.estimatedFinish)
    finish = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(stats.estimatedFinish);
  set('estimatedFinish', finish);
  let note = 'The clock starts with play. Breaks pause both timers.';
  if (!stats && !registration) note = 'Timing was not recorded for this tournament. New tournaments will track play and break time.';
  else if (finished) note = 'All scheduled rounds are saved. Allow extra time for any playoffs and the prize reveal.';
  else if (stats) note = `Breaks are excluded. ${stats.measuredPace ? 'Estimate follows your pace.' : 'Early estimate allows six minutes per round.'} Playoffs and prize time are extra.`;
  set('clockNote', note);
}
