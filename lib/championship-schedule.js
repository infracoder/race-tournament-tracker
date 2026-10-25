const LETTERS = [...'ABCDEFGHI'];
const DURATIONS = { race: 6, solo: 10, team: 6 };

function randomFor(seed) {
  let state = [...String(seed)].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function scheduleMetrics(slots) {
  const waits = Object.fromEntries(LETTERS.map(id => [id, { minutes: 0, idle: 0 }]));
  const pairCounts = new Map();
  let max_wait_minutes = 0, max_idle_slots = 0, squared_wait = 0, consecutive = 0;
  let previous = new Set();
  for (const slot of slots) {
    const playing = new Set(slot.participants.map(p => p.player_id));
    if (slot.category !== 'team') {
      const ids = [...playing].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}:${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
    for (const id of LETTERS) {
      const w = waits[id];
      if (playing.has(id)) {
        squared_wait += w.minutes ** 2;
        if (previous.has(id)) consecutive++;
        w.minutes = w.idle = 0;
      } else {
        w.minutes += DURATIONS[slot.category];
        w.idle++;
        max_wait_minutes = Math.max(max_wait_minutes, w.minutes);
        max_idle_slots = Math.max(max_idle_slots, w.idle);
      }
    }
    previous = playing;
  }
  return { max_wait_minutes, max_idle_slots, squared_wait, consecutive,
    max_individual_pair_repeats: Math.max(0, ...pairCounts.values()), estimated_minutes: 218 };
}

function better(a, b) {
  for (const key of ['max_wait_minutes', 'max_idle_slots', 'squared_wait', 'consecutive']) {
    if (a[key] !== b[key]) return a[key] < b[key];
  }
  return false;
}

function generateChampionshipSchedule(seed = 'third-annual') {
  const random = randomFor(seed);
  const permutations = Object.fromEntries(['race', 'solo', 'team'].map(c => [c, shuffle(LETTERS, random)]));
  let slots = [];
  for (let i = 0; i < 9; i++) {
    for (const category of ['race', 'solo', 'team']) {
      const id = `${category}-${i + 1}`;
      const participants = [0, 1, 2, 4].map((offset, index) => ({
        player_id: permutations[category][(i + offset) % 9],
        controller: index + 1,
        side: category === 'team' ? (index < 2 ? 'cops' : 'robbers') : null
      }));
      const modes = category === 'solo' ? ['balloon', 'coin'] : [category === 'team' ? 'renegade' : 'race'];
      slots.push({ id, category, participants, rounds: modes.map((mode, index) => ({
        id: `${id}-${mode}`, mode, order: index + 1, completed: false, results: []
      })) });
    }
  }
  const initialMetrics = scheduleMetrics(slots);
  let metrics = initialMetrics;
  for (let i = 0; i < 3000; i++) {
    const a = Math.floor(random() * slots.length), b = Math.floor(random() * slots.length);
    [slots[a], slots[b]] = [slots[b], slots[a]];
    const candidate = scheduleMetrics(slots);
    if (better(candidate, metrics)) metrics = candidate;
    else [slots[a], slots[b]] = [slots[b], slots[a]];
  }
  slots = slots.map((slot, index) => ({ ...slot, position: index + 1 }));
  const errors = validateChampionshipSchedule(slots);
  if (errors.length) throw new Error(errors.join(' '));
  return { seed: String(seed), slots, metrics, initialMetrics };
}

function validateChampionshipSchedule(slots) {
  const errors = [];
  if (!Array.isArray(slots) || slots.length !== 27) return ['Expected 27 event slots.'];
  if (new Set(slots.map(s => s.id)).size !== 27) errors.push('Duplicate slot IDs.');
  if (new Set(slots.flatMap(s => s.rounds.map(r => r.id))).size !== 36) errors.push('Expected 36 distinct rounds.');
  for (const category of ['race', 'solo', 'team']) {
    if (slots.filter(s => s.category === category).length !== 9) errors.push(`Expected nine ${category} slots.`);
  }
  for (const slot of slots) {
    if (slot.participants.length !== 4 || new Set(slot.participants.map(p => p.player_id)).size !== 4 ||
        slot.participants.some(p => !LETTERS.includes(p.player_id))) errors.push('Invalid four-player roster.');
    const modes = slot.rounds.map(r => r.mode).join(',');
    if (modes !== ({ race: 'race', solo: 'balloon,coin', team: 'renegade' })[slot.category]) errors.push('Invalid event rounds.');
    if (slot.category === 'team' && ['cops', 'robbers'].some(side => slot.participants.filter(p => p.side === side).length !== 2)) errors.push('Invalid team sides.');
  }
  for (const id of LETTERS) {
    const played = slots.filter(s => s.participants.some(p => p.player_id === id));
    for (const category of ['race', 'solo', 'team']) {
      if (played.filter(s => s.category === category).length !== 4) errors.push(`Unequal participation for ${id}.`);
    }
    const partners = [], opponents = [], roles = [];
    for (const slot of played.filter(s => s.category === 'team')) {
      const me = slot.participants.find(p => p.player_id === id);
      roles.push(me.side);
      partners.push(...slot.participants.filter(p => p.side === me.side && p.player_id !== id).map(p => p.player_id));
      opponents.push(...slot.participants.filter(p => p.side !== me.side).map(p => p.player_id));
    }
    if (partners.length !== 4 || new Set(partners).size !== 4 || opponents.length !== 8 || new Set(opponents).size !== 8 ||
        roles.filter(r => r === 'cops').length !== 2 || roles.filter(r => r === 'robbers').length !== 2) errors.push(`Unbalanced teams for ${id}.`);
  }
  return errors;
}

module.exports = { LETTERS, generateChampionshipSchedule, validateChampionshipSchedule, scheduleMetrics };
