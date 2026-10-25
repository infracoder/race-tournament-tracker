import {
  mount,
  $,
  element,
  points,
  eventCard,
  scheduleList,
  standingsTable,
  fillPlayerSelect,
  champion
} from './ui.js';
import { selectedPlayer, rememberPlayer, playerLink } from './championship-client.js';

const params = new URLSearchParams(location.search);
let chosen = params.get('id'),
  expectedEvent = params.get('t'),
  state;

function render(value) {
  state = value;
  fillPlayerSelect($('#playerSelect'), state.players || []);
  if (!state.initialized) {
    $('#personalContent').hidden = true;
    return;
  }
  if (!chosen && !expectedEvent) chosen = selectedPlayer(state)?.id;
  const correctEvent = !expectedEvent || expectedEvent === state.championship.id;
  const player = correctEvent && state.players.find((p) => p.id === chosen && p.name);
  $('#playerChooser').hidden = Boolean(player);
  $('#personalContent').hidden = !player;
  if (!player) {
    $('#playerSubtitle').textContent = correctEvent
      ? 'Select your name to see your schedule and points.'
      : 'That link belongs to an earlier tournament. Choose your name for the current event.';
    return;
  }
  expectedEvent = state.championship.id;
  rememberPlayer(expectedEvent, player.id);
  $('#playerHeading').textContent = `Let’s go, ${player.name}.`;
  const stat = state.standings.find((p) => p.id === player.id);
  $('#playerSubtitle').textContent =
    `Player ${player.letter} · Rank ${stat.rank} · ${stat.slots_completed} of ${stat.slots_total} events complete`;
  $('#personalStats').replaceChildren(
    ...['total', 'race', 'solo', 'team'].map((category) => {
      const box = element('article', `personal-stat ${category}`);
      box.append(
        element(
          'span',
          'stat-label',
          category === 'total'
            ? 'Overall points'
            : `${category === 'solo' ? 'Solo battle' : category === 'team' ? 'Team battle' : 'Race'} points`
        ),
        element('strong', '', points(category === 'total' ? stat.total_units : stat.category_units[category]))
      );
      const wins =
        category === 'total'
          ? `${stat.slots_completed} events complete`
          : category === 'solo'
            ? `${stat.wins.balloon} balloon · ${stat.wins.coin} coin wins`
            : `${stat.wins[category]} ${stat.wins[category] === 1 ? 'win' : 'wins'}`;
      box.append(element('small', '', wins));
      return box;
    })
  );
  const current = state.active_slot;
  const mePlaying = current?.participants.some((p) => p.player_id === player.id);
  const next = state.slots.find(
    (s) =>
      s.position >= (state.championship.cursor || 1) &&
      !s.completed &&
      s.participants.some((p) => p.player_id === player.id)
  );
  $('#myNextEvent').replaceChildren(
    next
      ? eventCard(next, {
          heading: mePlaying && !current.completed ? 'YOU’RE UP! GRAB A CONTROLLER' : 'YOUR NEXT TURN',
          activeRound: mePlaying ? state.active_round : null,
          paused: state.championship.paused,
          meId: player.id
        })
      : element('div', 'card', 'Your events are complete. Keep an eye on the standings!')
  );
  $('#globalEvent').replaceChildren(
    eventCard(mePlaying ? state.up_next : current || state.up_next, {
      heading: mePlaying
        ? 'UP NEXT'
        : state.championship.status === 'registration'
          ? 'FIRST ON THE GRID'
          : 'PLAYING NOW',
      activeRound: mePlaying ? null : state.active_round,
      compact: true,
      paused: state.championship.paused,
      meId: player.id,
      status: state.championship.status
    })
  );
  $('#myProgress').textContent = `${stat.slots_completed} OF ${stat.slots_total} EVENTS COMPLETE`;
  $('#mySchedule').replaceChildren(scheduleList(state, player.id));
  $('#myStandings').replaceChildren(standingsTable(state, player.id));
  champion(state, $('#playerChampion'));
}
mount(render);
$('#choosePlayer').addEventListener('click', () => {
  if (!$('#playerSelect').value || !state?.initialized) return;
  chosen = $('#playerSelect').value;
  expectedEvent = state.championship.id;
  rememberPlayer(expectedEvent, chosen);
  history.replaceState(null, '', playerLink(expectedEvent, chosen));
  render(state);
});
