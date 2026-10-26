async function syncChampionshipClock(tx, id, state, now) {
  const running = state.championship.status === 'running' && !state.championship.paused;
  const clock = state.clock;
  if (!clock) return;
  const elapsed = (amount, since) => (amount || 0) + (since == null ? 0 : Math.max(0, now - since));
  const slot = state.active_slot;
  const newEvent = slot && slot.id !== clock?.slot_id;
  const eventElapsed = newEvent ? 0 : elapsed(clock?.event_elapsed_ms, clock?.event_running_since);
  await tx.run(`INSERT INTO championship_clocks
    (championship_id, started_at, elapsed_ms, running_since, slot_id, event_elapsed_ms, event_running_since)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(championship_id) DO UPDATE SET
    elapsed_ms=excluded.elapsed_ms, running_since=excluded.running_since, slot_id=excluded.slot_id,
    event_elapsed_ms=excluded.event_elapsed_ms, event_running_since=excluded.event_running_since`,
  [id, clock?.started_at ?? now, elapsed(clock?.elapsed_ms, clock?.running_since), running ? now : null,
    slot?.id || clock?.slot_id || null, eventElapsed, running && slot && !slot.completed ? now : null]);
}

module.exports = { syncChampionshipClock };
