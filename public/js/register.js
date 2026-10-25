import { mount, $, element, message, fillPlayerSelect } from './ui.js';
import { request, storage, randomToken, rememberPlayer, playerLink } from './championship-client.js';

let state,
  busy = false;
const joinEvent = new URLSearchParams(location.search).get('t');
const client = mount((value) => {
  state = value;
  const oldLink = joinEvent && state.championship?.id !== joinEvent;
  const open =
    state.initialized && !oldLink && state.championship.status === 'registration' && state.registered < 9;
  $('#registerForm').hidden = !open;
  $('#registrationCount').textContent = `${state.registered || 0} / 9`;
  $('#registrationState').textContent = oldLink
    ? 'This join link belongs to an earlier tournament. Open Race HQ for the current join link, or select your existing name below.'
    : !state.initialized
      ? 'The host will open registration soon.'
      : open
        ? `${9 - state.registered} spots left. Enter your name to join the grid.`
        : 'Registration is closed. Already registered? Select your name below.';
  $('#registerButton').disabled = busy || !open;
  fillPlayerSelect($('#returningPlayer'), state.players || []);
  $('#registeredPlayers').replaceChildren(
    ...(state.players || [])
      .filter((p) => p.name)
      .map((p) => element('span', 'compact-player', `${p.letter} · ${p.name}`))
  );
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !state?.initialized) return;
  const id = state.championship.id;
  const key = `mk:registration:${id}`;
  const registrationToken = storage.get(key) || randomToken();
  storage.set(key, registrationToken);
  busy = true;
  $('#registerButton').disabled = true;
  message($('#registerMessage'), 'Saving your place on the grid…');
  try {
    const result = await request(`/api/championship/${id}/players`, {
      name: $('#playerName').value,
      registrationToken
    });
    rememberPlayer(id, result.player.id);
    location.href = playerLink(id, result.player.id);
  } catch (error) {
    message($('#registerMessage'), error.message, 'error');
    if (error.snapshot) client.apply(error.snapshot);
  } finally {
    busy = false;
    $('#registerButton').disabled = false;
  }
});

$('#returnButton').addEventListener('click', () => {
  const id = $('#returningPlayer').value;
  if (!id || !state?.initialized) return;
  rememberPlayer(state.championship.id, id);
  location.href = playerLink(state.championship.id, id);
});
