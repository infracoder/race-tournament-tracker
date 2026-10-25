import {
  $,
  element,
  message,
  mount,
  labels,
  eventCard,
  standingsTable,
  scheduleList,
  champion,
  fillPlayerSelect,
  points
} from './ui.js';
import { request } from './championship-client.js';

let state;
let authenticated = false;
let authenticationVersion = 0;
let busy = false;
let draft = null;
let correctionId = null;
const client = mount((next) => {
  state = next;
  render();
});

const roundIn = (snapshot, id) =>
  snapshot?.slots
    ?.flatMap((slot) => slot.rounds.map((round) => ({ slot, round })))
    .find((item) => item.round.id === id);
const signature = (round) => JSON.stringify([round.completed, round.winning_side, round.results]);

function setAuthenticated(value) {
  authenticationVersion++;
  authenticated = value;
  $('#loginPanel').hidden = value;
  $('#hostContent').hidden = !value;
  render();
}

async function perform(action, success) {
  if (busy) return;
  busy = true;
  message($('#hostMessage'), '');
  render();
  try {
    const result = await action();
    success?.(result);
    return result;
  } catch (error) {
    if (error.snapshot) client.apply(error.snapshot);
    if (error.status === 401) {
      setAuthenticated(false);
      message(
        $('#loginMessage'),
        'Your host session expired. Log in again; your entries are still here.',
        'warning'
      );
    }
    message($('#hostMessage'), error.message, 'error');
  } finally {
    busy = false;
    render();
  }
}

function api(action, body = {}, method = 'POST') {
  return request(
    `/api/championship/${state.championship.id}/${action}`,
    { expectedRevision: state.revision, ...body },
    method
  );
}

function buildFields(slot, round) {
  const fields = $('#resultFields');
  fields.replaceChildren();
  if (round.mode === 'renegade') {
    fields.append(
      element('p', 'result-guidance', 'Select the winning team. Every teammate earns the same points.')
    );
    for (const side of ['cops', 'robbers']) {
      const label = element('label', 'team-choice');
      const input = element('input');
      input.type = 'radio';
      input.name = 'winningSide';
      input.value = side;
      input.required = true;
      input.checked = round.winning_side === side;
      label.append(
        input,
        document.createTextNode(`${side === 'cops' ? 'Cops' : 'Robbers'} win`),
        element(
          'small',
          '',
          slot.participants
            .filter((p) => p.side === side)
            .map((p) => p.name)
            .join(' + ')
        )
      );
      fields.append(label);
    }
  } else {
    fields.append(
      element(
        'p',
        'result-guidance',
        round.mode === 'race'
          ? 'Enter each player’s finishing position.'
          : 'Enter the final standings. For a tie, choose the same position (for example: 1st, 1st, 3rd, 4th).'
      )
    );
    for (const player of slot.participants) {
      const row = element('div', 'result-row');
      const label = element('label', '', `${player.name} finish`);
      const select = element('select');
      select.id = `finish-${player.player_id}`;
      select.name = player.player_id;
      select.required = true;
      select.append(
        new Option('Choose…', ''),
        ...['1st', '2nd', '3rd', '4th'].map((label, index) => new Option(label, String(index + 1)))
      );
      select.value = String(round.results.find((r) => r.player_id === player.player_id)?.rank || '');
      label.htmlFor = select.id;
      row.append(label, select);
      fields.append(row);
    }
  }
}

function renderEditor() {
  const target = roundIn(state, correctionId || state.active_round?.id);
  if (
    !draft?.dirty &&
    (!target ||
      draft?.roundId !== target.round.id ||
      draft.championshipId !== state.championship.id ||
      draft.source !== signature(target.round))
  ) {
    draft = target
      ? {
          championshipId: state.championship.id,
          roundId: target.round.id,
          revision: state.revision,
          source: signature(target.round),
          ...target,
          dirty: false
        }
      : null;
    if (draft) buildFields(draft.slot, draft.round);
  }
  if (draft && !draft.dirty) draft.revision = state.revision;
  const stale =
    draft && (draft.championshipId !== state.championship.id || draft.revision !== state.revision);
  const slot = draft?.slot || state.active_slot;
  $('#editorHeading').textContent =
    correctionId || draft?.round.completed ? 'Review saved result' : 'Current event';
  $('#editorBadge').textContent = draft ? labels[draft.round.mode] : '';
  $('#editorEvent').replaceChildren(
    eventCard(slot, {
      heading: correctionId ? 'RESULT CORRECTION' : 'PLAYING NOW',
      activeRound: draft?.round || state.active_round,
      paused: state.championship.paused,
      status: state.championship.status
    })
  );
  $('#resultForm').hidden = !draft;
  $('#backToCurrent').hidden = !correctionId;
  message(
    $('#draftNotice'),
    stale
      ? 'The tournament changed while you were editing. Your entries are preserved. Reload the saved result before making a new change.'
      : '',
    'warning'
  );
  $('#reloadResult').hidden = !stale;
  $('#saveResult').disabled = busy || Boolean(stale);
  $('#advanceEvent').hidden = Boolean(
    draft || !state.active_slot?.completed || state.championship.status !== 'running'
  );
  $('#advanceEvent').disabled = busy || state.championship.paused;
  $('#eventWaiting').textContent =
    state.championship.status === 'registration'
      ? 'The first lineup is ready. Start once all nine players have joined.'
      : state.championship.status === 'awaiting_champion'
        ? 'Every event is saved. Review the standings, then complete the tournament below.'
        : state.championship.status === 'completed'
          ? 'Tournament complete. You can still correct a saved result below.'
          : state.active_slot?.completed && state.championship.paused
            ? 'Resume play when you are ready for the next event.'
            : '';
}

function render() {
  $('#loginButton').disabled = busy;
  if (!state || !authenticated) return;
  const initialized = state.initialized;
  const c = state.championship;
  $('#hostBody').hidden = !initialized;
  $('#hostStatus').textContent = !initialized
    ? 'Ready to set up the tournament'
    : {
        registration: 'Registration open',
        running: c.paused ? 'Play paused' : 'Tournament in progress',
        awaiting_champion: 'All events complete',
        completed: 'Champion crowned'
      }[c.status];
  $('#hostProgress').textContent = initialized
    ? `${state.slots_completed} / 27 events · ${state.rounds_completed} / 36 rounds`
    : 'Nine competitors. Three ways to win.';
  $('#createTournament').textContent = initialized ? 'New tournament' : 'Set up tournament';
  $('#createTournament').disabled = busy;
  $('#logoutButton').disabled = busy;
  $('#startTournament').hidden = !initialized || c.status !== 'registration';
  $('#startTournament').disabled = busy || state.registered !== 9;
  $('#pauseTournament').hidden = !initialized || c.status !== 'running';
  $('#pauseTournament').disabled = busy;
  $('#pauseTournament').textContent = c?.paused ? 'Resume play' : 'Take a break';
  if (!initialized) return;

  renderEditor();
  $('#hostNextEvent').replaceChildren(
    eventCard(state.up_next, { heading: 'UP NEXT', compact: true, status: state.championship.status })
  );
  $('#hostRegistration').textContent = `${state.registered} / 9 REGISTERED`;
  $('#hostPlayers').replaceChildren(
    ...state.players.map((p) => {
      const row = element('div', `grid-player ${p.name ? '' : 'unclaimed'}`);
      row.append(
        element('span', `player-letter player-${p.letter.toLowerCase()}`, p.letter),
        element('span', '', p.name || 'Open spot')
      );
      return row;
    })
  );
  $('#hostJoinUrl').value = state.join_url || 'Set PUBLIC_BASE_URL to your phone-reachable address.';
  $('#hostQr').hidden = !state.join_url;
  const qrPath = `/api/championship/current/qr.svg?t=${c.id}`;
  if ($('#hostQr').getAttribute('src') !== qrPath) $('#hostQr').src = qrPath;
  $('#hostStandings').replaceChildren(standingsTable(state));
  $('#hostSchedule').replaceChildren(scheduleList(state));
  champion(state, $('#hostChampion'));

  const savedRounds = state.slots.flatMap((slot) =>
    slot.rounds
      .filter((round) => round.completed)
      .map((round) => [round.id, `Event ${String(slot.position).padStart(2, '0')} · ${labels[round.mode]}`])
  );
  const select = $('#correctionRound');
  const key = JSON.stringify(savedRounds);
  if (select.dataset.rounds !== key) {
    const value = select.value;
    select.replaceChildren(
      new Option('Choose a saved round', ''),
      ...savedRounds.map(([id, text]) => new Option(text, id))
    );
    select.value = value;
    select.dataset.rounds = key;
  }
  $('#editCorrection').disabled = busy || !select.value;
  $('#finishPanel').hidden = c.status !== 'awaiting_champion';
  const leaders = state.standings.filter((p) => p.rank === 1);
  const tied = leaders.length > 1;
  $('#playoffPicker').hidden = !tied;
  fillPlayerSelect($('#playoffWinner'), leaders, 'Choose the playoff winner');
  $('#finishDescription').textContent = tied
    ? `First place is tied at ${points(leaders[0].total_units)} points. Run your playoff, then record its winner here.`
    : leaders.length
      ? `${leaders[0].name} leads with ${points(leaders[0].total_units)} points. Complete the tournament to reveal your champion to everyone.`
      : '';
  $('#completeTournament').disabled = busy || (tied && !$('#playoffWinner').value);
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $('#loginButton').disabled = true;
  message($('#loginMessage'), '');
  try {
    await request('/api/organizer/login', { pin: $('#pin').value });
    $('#pin').value = '';
    setAuthenticated(true);
    await client.refresh();
  } catch (error) {
    message($('#loginMessage'), error.message, 'error');
  } finally {
    busy = false;
    render();
  }
});

$('#createTournament').addEventListener('click', () => {
  if (
    state?.initialized &&
    !confirm(
      'Start a new tournament? The current tournament will be archived and its player links will stop accepting changes.'
    )
  )
    return;
  perform(
    () => request('/api/championship', { expectedActiveId: state?.championship?.id || null }),
    (next) => {
      draft = null;
      correctionId = null;
      client.apply(next);
    }
  );
});
$('#startTournament').addEventListener('click', () =>
  perform(
    () => api('start'),
    (next) => client.apply(next)
  )
);
$('#pauseTournament').addEventListener('click', () =>
  perform(
    () => api('pause', { paused: !state.championship.paused }, 'PUT'),
    (next) => {
      const saved = draft && roundIn(next, draft.roundId);
      if (saved && draft.championshipId === next.championship.id && draft.source === signature(saved.round))
        draft.revision = next.revision;
      client.apply(next);
    }
  )
);
$('#advanceEvent').addEventListener('click', () =>
  perform(
    () => api('advance'),
    (next) => client.apply(next)
  )
);
$('#logoutButton').addEventListener('click', () =>
  perform(
    () => request('/api/organizer/logout'),
    () => {
      draft = null;
      correctionId = null;
      setAuthenticated(false);
    }
  )
);

$('#resultFields').addEventListener('change', () => {
  if (draft) {
    draft.dirty = true;
    renderEditor();
  }
});
$('#resultForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!draft) return;
  perform(
    () => {
      const body = { expectedRevision: draft.revision };
      if (draft.round.mode === 'renegade') body.winningSide = $('#resultFields input:checked')?.value;
      else {
        const grouped = new Map();
        for (const select of $('#resultFields').querySelectorAll('select')) {
          const rank = Number(select.value);
          if (!rank) throw new Error('Choose a finish for all four players.');
          if (!grouped.has(rank)) grouped.set(rank, []);
          grouped.get(rank).push(select.name);
        }
        const entries = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
        let expected = 1;
        for (const [rank, players] of entries) {
          if (rank !== expected)
            throw new Error(
              'Use consecutive finishing positions. After two players tie for 1st, the next position is 3rd.'
            );
          if (draft.round.mode === 'race' && players.length > 1)
            throw new Error('Race positions must be unique.');
          expected += players.length;
        }
        body.groups = entries.map(([, players]) => players);
      }
      return request(`/api/championship/${draft.championshipId}/rounds/${draft.roundId}/result`, body, 'PUT');
    },
    (next) => {
      draft = null;
      correctionId = null;
      client.apply(next);
      message($('#hostMessage'), 'Result saved. Standings are up to date.', 'success');
    }
  );
});

function reloadEditor() {
  draft = null;
  if (!roundIn(state, correctionId)?.round.completed) correctionId = null;
  render();
}
$('#reloadResult').addEventListener('click', reloadEditor);
$('#correctionRound').addEventListener('change', render);
$('#editCorrection').addEventListener('click', () => {
  if (!$('#correctionRound').value) return;
  correctionId = $('#correctionRound').value;
  draft = null;
  render();
  $('#editorHeading').scrollIntoView({ block: 'start' });
});
$('#backToCurrent').addEventListener('click', () => {
  correctionId = null;
  draft = null;
  render();
});
$('#playoffWinner').addEventListener('change', render);
$('#completeTournament').addEventListener('click', () =>
  perform(
    () => api('complete', { playoffWinnerId: $('#playoffWinner').value || undefined }),
    (next) => client.apply(next)
  )
);

const initialAuthenticationVersion = authenticationVersion;
request('/api/organizer/check', undefined, 'GET')
  .then((result) => {
    if (authenticationVersion === initialAuthenticationVersion) setAuthenticated(result.authenticated);
  })
  .catch((error) => {
    if (authenticationVersion === initialAuthenticationVersion)
      message($('#loginMessage'), error.message, 'error');
  });
