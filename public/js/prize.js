import { $, element, message, mount, money } from './ui.js';
import { storage, playerLink, fetchData } from './championship-client.js';

const params = new URLSearchParams(location.search);
const id = params.get('t');
const playerId = params.get('id');
const accessKey = `mk:prize-access:${id}:${playerId}`;
const suppliedKey = new URLSearchParams(location.hash.slice(1)).get('key');
if (suppliedKey) {
  storage.set(accessKey, suppliedKey);
  history.replaceState(null, '', location.pathname + location.search);
}
const token = storage.get(accessKey) || storage.get(`mk:registration:${id}`);
const endpoint = `/api/championship/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/prize`;
if (id && playerId) $('#backToPlayer').href = playerLink(id, playerId);
let state,
  prize = null,
  opened = false,
  busy = false,
  pending = false,
  generation = 0;
let loadedRevision = -1;
const imageUrls = new Set();

function clearImages() {
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
}

function closePrize() {
  generation++;
  prize = null;
  opened = false;
  loadedRevision = -1;
  clearImages();
  $('#revealedPrize').hidden = true;
  $('#sealedPrize').hidden = false;
  $('#prizeAmount').textContent = '';
  $('#prizePlacement').textContent = '';
  $('#prizePlayerName').textContent = '';
  $('#vendorChoices').replaceChildren();
  message($('#vendorChoiceMessage'), '');
}

async function privateRequest(path = endpoint, body) {
  let response, result;
  try {
    ({ response, data: result } = await fetchData(path, {
      method: body === undefined ? 'GET' : 'PUT',
      headers: {
        Authorization: `Bearer ${token || ''}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    }));
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw error;
    throw new Error('Could not reach the tournament. Reconnect and open your prize again.');
  }
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Could not open your prize.'), { status: response.status });
  return result;
}

function renderPrize(result) {
  if (prize?.award && result.award && prize.award.reveal_id !== result.award.reveal_id) {
    closePrize();
    message(
      $('#prizeMessage'),
      'Your host updated the prizes. Open the latest reveal to see yours.',
      'warning'
    );
    return;
  }
  const unchanged =
    prize && JSON.stringify([prize.award, prize.vendors]) === JSON.stringify([result.award, result.vendors]);
  prize = result;
  loadedRevision = result.revision;
  if (unchanged && !result.locked) return;
  if (result.locked) {
    closePrize();
    message(
      $('#prizeMessage'),
      result.message || 'Your surprise is still sealed. Your host will open it after the tournament.'
    );
    return;
  }
  const firstReveal = $('#revealedPrize').hidden;
  $('#sealedPrize').hidden = true;
  $('#revealedPrize').hidden = false;
  $('#prizePlayerName').textContent = `${result.player.name}, you earned this.`;
  $('#prizePlacement').textContent = `Finishing place ${result.award.place} · Tolsma Kart Championship 03`;
  $('#prizeAmount').textContent = money(result.award.amount_cents, result.award.currency);
  if (firstReveal) $('#prizePlayerName').focus({ preventScroll: true });
  clearImages();
  const version = generation;
  $('#vendorChoices').replaceChildren(
    ...result.vendors.map((vendor) => {
      const label = element('label', 'vendor-choice');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'vendor';
      radio.value = vendor.id;
      radio.required = true;
      radio.checked = vendor.id === result.award.vendor_id;
      const image = element('img', 'vendor-choice-image');
      image.alt = `${vendor.name} gift card`;
      image.hidden = true;
      const title = element('span', 'vendor-choice-name', vendor.name);
      label.append(radio, image, title);
      fetchData(
        `${endpoint}/artwork/${encodeURIComponent(vendor.id)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        { responseType: 'blob' }
      )
        .then(({ response, data: blob }) => {
          if (!response.ok) throw new Error('Artwork is unavailable.');
          if (version !== generation || !opened || !prize || state?.championship?.status !== 'completed')
            return;
          const url = URL.createObjectURL(blob);
          imageUrls.add(url);
          image.src = url;
          image.hidden = false;
        })
        .catch(() => {
          image.hidden = true;
        });
      return label;
    })
  );
  $('#saveVendorChoice').textContent = result.award.vendor_id ? 'Update my choice →' : 'Save my choice →';
  message(
    $('#vendorChoiceMessage'),
    result.award.vendor_id ? 'Your choice is saved. Your host can see your preference.' : '',
    'success'
  );
}

async function loadPrize() {
  if (pending || !opened) return;
  pending = true;
  const version = generation;
  $('#openPrize').disabled = true;
  message($('#prizeMessage'), '');
  try {
    const result = await privateRequest();
    if (version !== generation || !opened || result.revision < Math.max(state.revision, loadedRevision))
      return;
    renderPrize(result);
  } catch (error) {
    if (version === generation) {
      closePrize();
      message($('#prizeMessage'), error.message, 'error');
    }
  } finally {
    pending = false;
    $('#openPrize').disabled = false;
  }
}

mount((next) => {
  state = next;
  const sameEvent = next.championship?.id === id;
  const complete = sameEvent && next.championship.status === 'completed';
  if (!complete && (opened || prize)) closePrize();
  $('#openPrize').hidden = !complete;
  $('#prizeHeading').textContent = complete ? 'The wait is over.' : 'Your prize is sealed.';
  $('#prizeDescription').textContent = !sameEvent
    ? 'This link belongs to an earlier tournament. Ask your host for the current private prize link.'
    : complete
      ? 'One last surprise from your host. Open it to see your prize and pick a gift card.'
      : 'Keep racing. Your host will unlock your surprise when the tournament is complete.';
  if (complete && opened && next.revision > loadedRevision) loadPrize();
});

$('#openPrize').addEventListener('click', () => {
  opened = true;
  loadPrize();
});
$('#vendorChoiceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !prize || prize.locked) return;
  const vendorId = $('#vendorChoices input:checked')?.value;
  if (!vendorId) return;
  busy = true;
  const version = generation;
  $('#saveVendorChoice').disabled = true;
  try {
    const result = await privateRequest(`${endpoint}/vendor`, { vendorId, revealId: prize.award.reveal_id });
    if (version === generation && opened) renderPrize(result);
  } catch (error) {
    if (version === generation) {
      if (error.status === 409 || error.status === 401 || error.status === 403) closePrize();
      message($('#prizeMessage'), error.message, 'error');
    }
  } finally {
    busy = false;
    $('#saveVendorChoice').disabled = false;
  }
});
window.addEventListener('pagehide', closePrize);
