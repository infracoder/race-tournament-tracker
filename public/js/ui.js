import { ChampionshipClient, selectedPlayer, playerLink } from './championship-client.js';

export const $ = (selector) => document.querySelector(selector);
export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
export const points = (units) =>
  (units / 12)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
export const labels = {
  race: 'Race',
  solo: 'Solo battle',
  team: 'Team battle',
  balloon: 'Balloon Battle',
  coin: 'Coin Runners',
  renegade: 'Renegade Roundup'
};
export function message(node, text, tone = 'info') {
  node.textContent = text;
  node.className = `notice ${tone}`;
  node.hidden = !text;
}

export function mount(render) {
  const client = new ChampionshipClient({
    onState(state) {
      message($('#connectionNotice'), '');
      const c = state.championship;
      const status = !c
        ? 'Getting ready'
        : c.paused && c.status === 'running'
          ? 'On a break'
          : {
              registration: 'Registration open',
              running: 'Live tournament',
              awaiting_champion: 'Final results',
              completed: 'Champion crowned'
            }[c.status];
      $('#liveStatus').textContent = status;
      $('#liveStatus').dataset.state = c?.paused ? 'paused' : c?.status || 'waiting';
      const me = state.initialized && selectedPlayer(state);
      for (const link of document.querySelectorAll('[data-my-link]'))
        link.href = me ? playerLink(c.id, me.id) : '/player.html';
      render(state);
    },
    onError() {
      message($('#connectionNotice'), 'Reconnecting… showing the last saved update.', 'warning');
    }
  });
  window.addEventListener('pagehide', () => client.stop(), { once: true });
  client.start();
  return client;
}

export function roster(slot, meId) {
  const grid = element('div', 'roster');
  for (const p of slot.participants) {
    const item = element('div', `racer ${p.player_id === meId ? 'is-me' : ''}`);
    item.append(element('span', `player-letter player-${p.letter.toLowerCase()}`, p.letter));
    const copy = element('div', 'racer-copy');
    copy.append(
      element('strong', '', p.name || `Player ${p.letter}`),
      element(
        'small',
        '',
        `Controller ${p.controller}${p.side ? ` · ${p.side === 'cops' ? 'Cops' : 'Robbers'}` : ''}`
      )
    );
    item.append(copy);
    grid.append(item);
  }
  return grid;
}

export function eventCard(
  slot,
  { heading = 'PLAYING NOW', activeRound, paused = false, meId, compact = false, status } = {}
) {
  const card = element('section', `event-card ${slot?.category || 'waiting'} ${compact ? 'compact' : ''}`);
  const top = element('div', 'event-top');
  top.append(
    element('span', 'eyebrow', heading),
    element('span', 'event-number', slot ? `EVENT ${String(slot.position).padStart(2, '0')} / 27` : '')
  );
  card.append(top);
  if (!slot) {
    const finished = ['awaiting_champion', 'completed'].includes(status);
    card.append(
      element('h2', '', finished ? 'All 27 events. In the books.' : 'The grid is getting ready.'),
      element(
        'p',
        'muted',
        finished
          ? 'See the final standings and celebrate a great tournament.'
          : 'Your host will open registration soon. In the meantime, pick your lucky kart.'
      )
    );
    return card;
  }
  const title = activeRound
    ? labels[activeRound.mode]
    : slot.category === 'solo'
      ? 'Balloon Battle + Coin Runners'
      : slot.category === 'team'
        ? 'Renegade Roundup'
        : 'Race time';
  card.append(element('div', 'mode-tag', labels[slot.category]), element('h2', '', title));
  const description = paused
    ? 'On a break. The lineup stays the same.'
    : slot.completed
      ? 'Results saved. Waiting for the host to advance.'
      : slot.category === 'solo'
        ? `Same four players for both rounds${activeRound ? ` · round ${activeRound.order} of 2` : ''}.`
        : slot.category === 'team'
          ? 'Two vs two. Win together, score together.'
          : 'Four players. One finish line.';
  card.append(element('p', 'event-description', description), roster(slot, meId));
  if (slot.category === 'solo' && !slot.completed && slot.rounds[0].completed) {
    const pending = element('div', 'pending-result');
    pending.append(
      element('strong', '', 'Balloon Battle saved · points pending Coin Runners'),
      element(
        'p',
        '',
        slot.rounds[0].results
          .map(
            (result) =>
              `${slot.participants.find((p) => p.player_id === result.player_id).name}: ${points(result.score_units)}`
          )
          .join(' · ')
      )
    );
    card.append(pending);
  }
  return card;
}

export function standingsTable(state, meId, limit) {
  const wrap = element('div', 'table-scroll');
  if (!state.standings.length) {
    wrap.append(element('p', 'empty-state', 'The leaderboard starts with your first player.'));
    return wrap;
  }
  const table = element('table', 'standings');
  const thead = element('thead');
  const tr = element('tr');
  for (const label of ['Rank', 'Player', 'Race', 'Solo', 'Team', 'Total'])
    tr.append(element('th', '', label));
  thead.append(tr);
  table.append(thead);
  const body = element('tbody');
  for (const p of state.standings.slice(0, limit || 9)) {
    const row = element('tr', p.id === meId ? 'my-row' : '');
    row.append(element('td', 'rank', String(p.rank).padStart(2, '0')));
    const playerCell = element('td');
    const link = element('a', 'player-link', p.name);
    link.href = playerLink(state.championship.id, p.id);
    playerCell.append(
      link,
      element(
        'small',
        'win-count',
        `${p.wins.race} race · ${p.wins.balloon + p.wins.coin} solo · ${p.wins.team} team wins`
      )
    );
    row.append(playerCell);
    for (const category of ['race', 'solo', 'team'])
      row.append(element('td', 'category-score', points(p.category_units[category])));
    row.append(element('td', 'total-score', points(p.total_units)));
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

export function scheduleList(state, meId) {
  const list = element('ol', 'schedule-list');
  for (const slot of state.slots.filter((s) => !meId || s.participants.some((p) => p.player_id === meId))) {
    const current = state.active_slot?.id === slot.id;
    const item = element(
      'li',
      `schedule-row ${current ? 'is-current' : ''} ${slot.completed ? 'is-complete' : ''}`
    );
    item.append(element('span', 'schedule-number', String(slot.position).padStart(2, '0')));
    const copy = element('div', 'schedule-copy');
    copy.append(
      element(
        'strong',
        '',
        slot.category === 'solo'
          ? 'Balloon Battle + Coin Runners'
          : slot.category === 'team'
            ? 'Renegade Roundup'
            : 'Race'
      )
    );
    copy.append(element('small', '', slot.participants.map((p) => p.name || p.letter).join(' · ')));
    item.append(
      copy,
      element(
        'span',
        `status-tag ${slot.category}`,
        slot.completed ? 'Complete' : current ? 'Now playing' : labels[slot.category]
      )
    );
    list.append(item);
  }
  return list;
}

export function fillPlayerSelect(select, players, placeholder = 'Choose your name') {
  const signature = JSON.stringify(players.map((p) => [p.id, p.name]));
  if (select.dataset.players === signature) return;
  const value = select.value;
  select.replaceChildren(
    new Option(placeholder, ''),
    ...players.filter((p) => p.name).map((p) => new Option(`${p.name} · Player ${p.letter}`, p.id))
  );
  select.value = value;
  select.dataset.players = signature;
}

export function champion(state, container) {
  container.hidden = !state.winner;
  if (!state.winner) {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(
    element('span', 'eyebrow', 'THE 3RD ANNUAL CHAMPION'),
    element('div', 'trophy', '🏆'),
    element('h2', '', state.winner.name),
    element(
      'p',
      '',
      `${points(state.winner.total_units)} points · ${state.championship.winner_source === 'playoff' ? 'Playoff winner' : 'A night to remember.'}`
    )
  );
}
