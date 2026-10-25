import { mount, $, message, eventCard, standingsTable, champion } from './ui.js';
import { selectedPlayer } from './championship-client.js';

mount((state) => {
  $('#leaderboardProgress').textContent = state.slots_completed || 0;
  $('#standingsTable').replaceChildren(
    state.initialized
      ? standingsTable(state, selectedPlayer(state)?.id)
      : document.createTextNode('Waiting for the host to open this year’s tournament.')
  );
  $('#leaderboardCurrent').replaceChildren(
    eventCard(state.active_slot || state.up_next, {
      activeRound: state.active_round,
      compact: true,
      paused: state.championship?.paused,
      status: state.championship?.status
    })
  );
  const tied =
    state.championship?.status === 'awaiting_champion' &&
    state.standings.filter((p) => p.rank === 1).length > 1;
  message(
    $('#tieNotice'),
    tied ? 'A tie at the top! The host will record the playoff winner before crowning the champion.' : ''
  );
  champion(state, $('#leaderboardChampion'));
});
