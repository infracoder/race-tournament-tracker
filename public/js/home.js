import { mount, $, element, eventCard, champion } from './ui.js';
import { selectedPlayer, playerLink } from './championship-client.js';

mount((state) => {
  const me = state.initialized && selectedPlayer(state);
  $('#registeredCount').textContent = state.registered ?? 0;
  $('#eventsCount').textContent = state.slots_completed ?? 0;
  $('#roundsCount').textContent = state.rounds_completed ?? 0;
  const join = $('#joinAction');
  join.href = me ? playerLink(state.championship.id, me.id) : '/register.html';
  join.textContent = me
    ? 'Open my dashboard ↗'
    : state.registered === 9
      ? 'Find your dashboard ↗'
      : 'Claim your spot ↗';
  const current = state.active_slot || state.up_next;
  const upcoming = state.championship?.status === 'registration' ? state.slots[1] : state.up_next;
  $('#currentEvent').replaceChildren(
    eventCard(current, {
      heading: state.championship?.status === 'registration' ? 'FIRST ON THE GRID' : 'PLAYING NOW',
      activeRound: state.active_round,
      paused: state.championship?.paused,
      meId: me?.id,
      status: state.championship?.status
    })
  );
  $('#upNext').replaceChildren(
    upcoming
      ? eventCard(upcoming, { heading: 'UP NEXT', compact: true, meId: me?.id })
      : element(
          'p',
          'muted',
          state.winner ? 'That’s a wrap. See you next year!' : 'Your next lineup will appear here.'
        )
  );
  $('#rosterCaption').textContent = `${state.registered || 0} OF 9 REGISTERED`;
  $('#playerGrid').replaceChildren(
    ...(state.players || []).map((p) => {
      const card = element('div', `grid-player ${p.name ? '' : 'unclaimed'}`);
      card.append(
        element('span', `player-letter player-${p.letter.toLowerCase()}`, p.letter),
        element('span', '', p.name || 'Open spot')
      );
      return card;
    })
  );
  $('#joinQr').hidden = !state.join_url;
  if (state.join_url) {
    const qrPath = `/api/championship/current/qr.svg?t=${encodeURIComponent(state.championship.id)}`;
    if ($('#joinQr').getAttribute('src') !== qrPath) $('#joinQr').src = qrPath;
    $('#joinUrl').href = state.join_url;
    $('#joinUrl').textContent = state.join_url;
  } else $('#joinUrl').textContent = 'The host will share a join address.';
  champion(state, $('#championBanner'));
});
