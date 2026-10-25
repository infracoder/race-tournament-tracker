import {
  mount,
  $,
  element,
  points,
  eventCard,
  scheduleList,
  standingsTable,
  fillPlayerSelect,
  message,
  champion
} from './ui.js';
import { selectedPlayer, rememberPlayer, playerLink, storage, fetchData } from './championship-client.js';

const params = new URLSearchParams(location.search);
let chosen = params.get('id'),
  expectedEvent = params.get('t'),
  state,
  busy = false,
  accessKey = '',
  ownsPlayer = false;

const playerToken = (id, playerId) =>
  storage.get(`mk:prize-access:${id}:${playerId}`) || storage.get(`mk:registration:${id}`);

function checkPlayerAccess(id, player) {
  const token = playerToken(id, player.id);
  const key = JSON.stringify([id, player.id, token]);
  if (accessKey === key) return;
  accessKey = key;
  ownsPlayer = false;
  if (!token) return;
  fetchData(`/api/championship/${encodeURIComponent(id)}/players/${encodeURIComponent(player.id)}/membership`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
  }).then(({ response }) => {
    if (accessKey !== key) return;
    if (!response.ok && ![401, 403].includes(response.status)) {
      accessKey = '';
      return;
    }
    ownsPlayer = response.ok;
    render(state);
  }).catch(() => {
    if (accessKey === key) accessKey = '';
  });
}

function render(value) {
  state = value;
  fillPlayerSelect($('#playerSelect'), state.players || []);
  if (!state.initialized) {
    accessKey = '';
    ownsPlayer = false;
    $('#personalContent').hidden = true;
    return;
  }
  if (!chosen && !expectedEvent) chosen = selectedPlayer(state)?.id;
  const correctEvent = !expectedEvent || expectedEvent === state.championship.id;
  const player = correctEvent && state.players.find((p) => p.id === chosen && p.name);
  $('#playerChooser').hidden = Boolean(player);
  $('#personalContent').hidden = !player;
  if (!player) {
    accessKey = '';
    ownsPlayer = false;
    $('#playerSubtitle').textContent = correctEvent
      ? 'Select your name to see your schedule and points.'
      : 'That link belongs to an earlier tournament. Choose your name for the current event.';
    return;
  }
  expectedEvent = state.championship.id;
  rememberPlayer(expectedEvent, player.id);
  checkPlayerAccess(expectedEvent, player);
  $('#withdrawalPanel').hidden = !ownsPlayer || Boolean(player.withdrawn_at) || Boolean(state.championship.first_completed_at) || state.championship.status === 'completed';
  $('#withdrawTournament').disabled = busy;
  message($('#withdrawalStatus'), player.withdrawn_at
    ? state.championship.status === 'completed'
      ? 'You’ve withdrawn. Your earned points stay on record. Open your private consolation prize below.'
      : 'You’ve withdrawn. Your earned points stay on record, your remaining seats stay empty, and your consolation prize stays sealed until the host completes the tournament.'
    : '', 'warning');
  $('#myPrizeLink').href =
    `/prize.html?t=${encodeURIComponent(expectedEvent)}&id=${encodeURIComponent(player.id)}`;
  $('#playerHeading').textContent = `Let’s go, ${player.name}.`;
  const stat = state.standings.find((p) => p.id === player.id);
  $('#playerSubtitle').textContent =
    `Player ${player.letter} · ${player.withdrawn_at ? 'Withdrawn' : `Rank ${stat.rank}`} · ${stat.slots_completed} of ${stat.slots_total} events complete`;
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
  const mePlaying = !player.withdrawn_at && current?.participants.some((p) => p.player_id === player.id);
  const next = !player.withdrawn_at && state.slots.find(
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
      : element('div', 'card', player.withdrawn_at
        ? 'No more turns are scheduled for you. You can still follow the tournament and open your consolation prize when it ends.'
        : 'Your events are complete. Keep an eye on the standings!')
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
const client = mount(render);
$('#withdrawTournament').addEventListener('click', async () => {
  const id = state?.championship?.id;
  const player = state?.players.find((p) => p.id === chosen);
  if (busy || !ownsPlayer || !player || player.withdrawn_at || state.championship.first_completed_at || state.championship.status === 'completed') return;
  if (!confirm('Withdraw from this tournament? You cannot rejoin this event. Your remaining seats will stay empty, and you will receive a consolation prize instead of a placement prize when the host completes the tournament.')) return;
  const expectedRevision = state.revision;
  busy = true;
  message($('#withdrawalMessage'), '');
  render(state);
  try {
    const { response, data } = await fetchData(`/api/championship/${encodeURIComponent(id)}/players/${encodeURIComponent(player.id)}/withdraw`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${playerToken(id, player.id)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision }), cache: 'no-store'
    });
    if (!response.ok) {
      if (data.snapshot) client.apply(data.snapshot);
      throw new Error(data.error || 'Could not withdraw. Please try again.');
    }
    client.apply(data);
  } catch (error) {
    message($('#withdrawalMessage'), error.message, 'error');
  } finally {
    busy = false;
    render(state);
  }
});
$('#choosePlayer').addEventListener('click', () => {
  if (!$('#playerSelect').value || !state?.initialized) return;
  chosen = $('#playerSelect').value;
  expectedEvent = state.championship.id;
  rememberPlayer(expectedEvent, chosen);
  history.replaceState(null, '', playerLink(expectedEvent, chosen));
  render(state);
});
