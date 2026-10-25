export class ChampionshipClient {
  constructor({
    onState = () => {},
    onError = () => {},
    fetcher = (...args) => globalThis.fetch(...args),
    document = globalThis.document,
    interval = 3000
  } = {}) {
    Object.assign(this, { onState, onError, fetcher, document, interval });
    this.state = null;
    this.generation = 0;
    this.running = false;
    this.onVisibility = () => {
      clearTimeout(this.timer);
      if (!this.document.hidden) this.refresh();
    };
  }
  apply(state) {
    const previousId = this.state?.championship?.id;
    const nextId = state.championship?.id;
    if (previousId === nextId && state.revision < this.state?.revision) return;
    if (previousId !== nextId) {
      this.generation++;
      this.controller?.abort();
    }
    this.state = state;
    this.onState(state);
  }
  refresh() {
    if (this.inFlight) return this.inFlight;
    clearTimeout(this.timer);
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.inFlight = (async () => {
      try {
        const response = await this.fetcher('/api/championship/current', {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Live updates are temporarily unavailable.');
        const state = await response.json();
        if (generation === this.generation) this.apply(state);
      } catch (error) {
        if (error.name !== 'AbortError' && generation === this.generation) this.onError(error);
      } finally {
        this.inFlight = null;
        if (this.running && !this.document?.hidden)
          this.timer = setTimeout(() => this.refresh(), this.interval);
      }
    })();
    return this.inFlight;
  }
  start() {
    this.running = true;
    this.document?.addEventListener('visibilitychange', this.onVisibility);
    return this.refresh();
  }
  stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.document?.removeEventListener('visibilitychange', this.onVisibility);
  }
}

export async function request(path, body, method = 'POST') {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
  } catch {
    throw new Error('Connection lost. Your entries are still here. Try again when you are connected.');
  }
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Please try again.'), {
      status: response.status,
      snapshot: data.snapshot
    });
  return data;
}

const memory = new Map();
export const storage = {
  get(key) {
    try {
      return localStorage.getItem(key) || memory.get(key) || null;
    } catch {
      return memory.get(key) || null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Name selection remains available if browser storage is blocked. */
    }
  }
};

export function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function rememberPlayer(championshipId, id) {
  storage.set('mk:identity', JSON.stringify({ championshipId, id }));
}

export function selectedPlayer(state) {
  try {
    const saved = JSON.parse(storage.get('mk:identity') || 'null');
    return saved?.championshipId === state.championship?.id
      ? state.players.find((p) => p.id === saved.id && p.name) || null
      : null;
  } catch {
    return null;
  }
}

export const playerLink = (championshipId, id) =>
  `/player.html?t=${encodeURIComponent(championshipId)}&id=${encodeURIComponent(id)}`;
