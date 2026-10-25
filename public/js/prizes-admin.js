import { $, element, message, money } from './ui.js';
import { request, fetchData } from './championship-client.js';

const tierKeys = ['first', 'second', 'third', 'participation'];

export function createPrizeAdmin({ run, applyState, onAuthLost, onChange }) {
  let state,
    authenticated = false,
    busy = false,
    dirty = false,
    loaded = null,
    pending = null;
  let generation = 0;
  let eventId = null;
  const form = $('#prizeSettingsForm');
  const vendors = $('#prizeVendors');

  function reset() {
    generation++;
    eventId = null;
    loaded = null;
    dirty = false;
    pending = null;
    form.reset();
    for (const input of form.querySelectorAll('[data-prize-tier]')) input.value = '';
    vendors.replaceChildren();
    $('#prizeOrders').replaceChildren();
    $('#privatePrizeLink').value = '';
    $('#privateLinkResult').hidden = true;
    $('#prizeBudget').textContent = '';
    $('#prizeSetupStatus').textContent = '';
    message($('#prizeSettingsMessage'), '');
    message($('#prizeLinkMessage'), '');
  }

  function vendorRow(vendor = {}) {
    const row = element('div', 'vendor-editor');
    row.dataset.vendorId = vendor.id || '';
    const heading = element('div', 'vendor-editor-heading');
    const label = element('label', '', 'Vendor name');
    const name = element('input');
    name.value = vendor.name || '';
    name.maxLength = 60;
    name.required = true;
    label.append(name);
    const remove = element('button', 'text-button', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      row.remove();
      dirty = true;
      renderStatus();
    });
    heading.append(label, remove);
    row.append(heading);
    if (vendor.id) {
      const preview = element('img', 'vendor-preview');
      preview.alt = `${vendor.name} gift-card artwork`;
      preview.src = `/api/championship/${eventId}/prizes/vendors/${vendor.id}/artwork?v=${loaded.revision}`;
      const uploadLabel = element('label', 'artwork-label', 'Choose gift-card artwork');
      const input = element('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      uploadLabel.append(
        input,
        element(
          'small',
          'muted',
          'PNG, JPEG, or WebP · up to 1 MB. Use display artwork without redemption codes.'
        )
      );
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        if (dirty)
          return message(
            $('#prizeSettingsMessage'),
            'Save your vendor and amount changes before adding artwork.',
            'warning'
          );
        if (file.size > 1048576)
          return message($('#prizeSettingsMessage'), 'Choose an image no larger than 1 MB.', 'error');
        await run(
          async () => {
            const { response, data: result } = await fetchData(
              `/api/championship/${eventId}/prizes/vendors/${vendor.id}/artwork`,
              {
                method: 'PUT',
                headers: { 'Content-Type': file.type, 'X-Tournament-Revision': String(loaded.revision) },
                body: file,
                cache: 'no-store'
              }
            );
            if (!response.ok)
              throw Object.assign(new Error(result.error || 'Could not save the artwork.'), {
                status: response.status,
                snapshot: result.snapshot
              });
            return result;
          },
          (next) => {
            loaded = null;
            applyState(next);
            message($('#prizeSettingsMessage'), 'Gift-card artwork saved.', 'success');
          }
        );
      });
      row.append(preview, uploadLabel);
    } else
      row.append(element('p', 'muted', 'Save this vendor to add its artwork. A display card is included.'));
    return row;
  }

  function renderSettings(settings) {
    loaded = settings;
    $('#prizesEnabled').checked = settings.enabled;
    $('#prizeCurrency').value = settings.currency;
    for (const [key, value] of Object.entries(settings.tiers))
      $(`#prize-${key}`).value = (value / 100).toFixed(2);
    vendors.replaceChildren(...settings.vendors.map(vendorRow));
    dirty = false;
    if ($('#prizeSettingsMessage').classList.contains('error')) message($('#prizeSettingsMessage'), '');
    renderOrders(settings);
    renderStatus();
  }

  function renderOrders(settings) {
    const orders = $('#prizeOrders');
    if (!settings.awards.length) {
      orders.replaceChildren(
        element('p', 'muted', 'Player vendor choices will appear here after you complete the tournament.')
      );
      return;
    }
    const table = element('table', 'prize-orders');
    const header = element('tr');
    for (const text of ['Player', 'Prize', 'Chosen vendor']) header.append(element('th', '', text));
    const head = element('thead');
    head.append(header);
    const body = element('tbody');
    for (const award of settings.awards) {
      const row = element('tr');
      row.append(
        element('td', '', award.name),
        element('td', '', money(award.amount_cents, award.currency)),
        element('td', '', award.vendor_name || 'Awaiting choice')
      );
      body.append(row);
    }
    table.append(head, body);
    orders.replaceChildren(table);
  }

  function renderStatus() {
    const stale = dirty && loaded && loaded.revision !== state?.revision;
    for (const field of form.elements) field.disabled = busy || !loaded;
    $('#savePrizeSettings').disabled = busy || !loaded || Boolean(stale);
    $('#prizeLinkPlayer').disabled = busy;
    $('#getPrivatePrizeLink').disabled = busy || !$('#prizeLinkPlayer').value;
    $('#reloadPrizeSettings').hidden = !dirty;
    message(
      $('#prizeDraftNotice'),
      stale
        ? 'The tournament changed. Your prize entries are preserved. Reload saved settings before making a new change.'
        : '',
      'warning'
    );
    $('#prizeSetupStatus').textContent = loaded?.enabled
      ? 'PRIZES ENABLED · PRIVATE UNTIL COMPLETION'
      : 'PRIZES NOT ENABLED';
    const total = [...form.querySelectorAll('[data-prize-tier]')].map((input) => Number(input.value));
    const currency = $('#prizeCurrency').value;
    $('#prizeBudget').textContent =
      currency && total.every(Number.isFinite)
        ? `Nine-player prize budget: ${money(Math.round((total[0] + total[1] + total[2] + total[3] * 6) * 100), currency)}`
        : 'Choose a currency to see your prize budget.';
    onChange?.();
  }

  async function load() {
    if (!authenticated || !state?.initialized || dirty) return;
    const key = `${state.championship.id}:${state.revision}`;
    if (pending === key || (loaded && loaded.revision === state.revision)) return;
    const version = generation;
    const requestedId = state.championship.id;
    pending = key;
    try {
      const result = await request(`/api/championship/${requestedId}/prizes`, undefined, 'GET');
      if (
        version !== generation ||
        !authenticated ||
        state.championship.id !== requestedId ||
        dirty ||
        result.revision < state.revision
      )
        return;
      renderSettings(result);
    } catch (error) {
      if (version === generation) {
        if (error.status === 401) onAuthLost();
        else message($('#prizeSettingsMessage'), error.message, 'error');
      }
    } finally {
      if (pending === key) pending = null;
    }
  }

  form.addEventListener('input', () => {
    dirty = true;
    renderStatus();
  });
  $('#addPrizeVendor').addEventListener('click', () => {
    if (vendors.children.length >= 12)
      return message($('#prizeSettingsMessage'), 'You can offer up to twelve vendors.', 'warning');
    const row = vendorRow();
    vendors.append(row);
    dirty = true;
    row.querySelector('input').focus();
    renderStatus();
  });
  $('#reloadPrizeSettings').addEventListener('click', () => {
    dirty = false;
    loaded = null;
    load();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!loaded) return;
    const tiers = {};
    for (const key of tierKeys) {
      const value = $(`#prize-${key}`).value;
      if (!/^\d+(\.\d{1,2})?$/.test(value))
        return message(
          $('#prizeSettingsMessage'),
          'Enter amounts with no more than two decimal places.',
          'error'
        );
      tiers[key] = Math.round(Number(value) * 100);
    }
    const body = {
      expectedRevision: loaded.revision,
      enabled: $('#prizesEnabled').checked,
      currency: $('#prizeCurrency').value,
      tiers,
      vendors: [...vendors.children].map((row) => ({
        ...(row.dataset.vendorId ? { id: row.dataset.vendorId } : {}),
        name: row.querySelector('input').value
      }))
    };
    run(
      () => request(`/api/championship/${eventId}/prizes`, body, 'PUT'),
      (next) => {
        dirty = false;
        loaded = null;
        applyState(next);
        message($('#prizeSettingsMessage'), 'Private prize settings saved.', 'success');
      }
    );
  });
  $('#getPrivatePrizeLink').addEventListener('click', () => {
    const playerId = $('#prizeLinkPlayer').value;
    if (!playerId) return;
    const id = eventId;
    run(
      () => request(`/api/championship/${id}/players/${playerId}/prize-link`, undefined, 'GET'),
      (result) => {
        if (eventId !== id || $('#prizeLinkPlayer').value !== playerId) return;
        $('#privatePrizeLink').value = new URL(result.path, state.join_url || location.origin).href;
        $('#privateLinkResult').hidden = false;
      }
    );
  });
  $('#prizeLinkPlayer').addEventListener('change', () => {
    $('#privatePrizeLink').value = '';
    $('#privateLinkResult').hidden = true;
    message($('#prizeLinkMessage'), '');
    renderStatus();
  });
  $('#copyPrivatePrizeLink').addEventListener('click', async () => {
    const input = $('#privatePrizeLink');
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(input.value);
        return message(
          $('#prizeLinkMessage'),
          'Private link copied. Share it only with this player.',
          'success'
        );
      } catch {
        /* A selectable link works when clipboard permission is unavailable. */
      }
    }
    input.focus();
    input.select();
    message($('#prizeLinkMessage'), 'Link selected. Copy it and share it only with this player.');
  });

  return {
    completion() {
      return {
        ready: Boolean(loaded && loaded.revision === state?.revision && !dirty),
        dirty,
        playoffs: loaded?.playoffs || []
      };
    },
    update(next, host, waiting) {
      state = next;
      authenticated = host;
      busy = waiting;
      if (!host) {
        generation++;
        pending = null;
        return;
      }
      if (!next?.initialized) {
        reset();
        return;
      }
      if (eventId !== next.championship.id) {
        reset();
        eventId = next.championship.id;
      }
      const picker = $('#prizeLinkPlayer');
      const signature = JSON.stringify(next.players.filter((p) => p.name).map((p) => [p.id, p.name]));
      if (picker.dataset.players !== signature) {
        const selected = picker.value;
        picker.replaceChildren(
          new Option('Choose a player', ''),
          ...next.players.filter((p) => p.name).map((p) => new Option(p.name, p.id))
        );
        picker.value = selected;
        picker.dataset.players = signature;
      }
      renderStatus();
      load();
    },
    clear: reset
  };
}
