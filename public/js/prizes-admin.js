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
    $('#prizeOrderSummary').textContent = '';
    $('#earlierPrizePurchases').replaceChildren();
    $('#earlierPrizePurchases').hidden = true;
    $('#privatePrizeLink').value = '';
    $('#privateLinkResult').hidden = true;
    $('#prizeBudget').textContent = '';
    $('#prizeSetupStatus').textContent = '';
    $('#prizeDefaultsStatus').textContent = '';
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
    const counts = { awaiting: 0, pending: 0, purchased: 0, delivered: 0 };
    for (const award of settings.awards) counts[!award.vendor_id ? 'awaiting' : award.fulfillment_status]++;
    $('#prizeOrderSummary').textContent = settings.awards.length
      ? `${counts.awaiting} awaiting choice · ${counts.pending} to buy · ${counts.purchased} purchased · ${counts.delivered} delivered`
      : '';
    const earlier = $('#earlierPrizePurchases');
    earlier.hidden = !settings.earlier_fulfillments.length;
    earlier.replaceChildren();
    if (settings.earlier_fulfillments.length) {
      earlier.append(element('h3', '', 'Purchases from earlier results'), element('p', 'notice warning',
        'Results or prize settings changed after these cards were purchased. Review these records before buying any revised prizes.'));
      for (const record of settings.earlier_fulfillments) earlier.append(element('p', 'earlier-prize-record',
        `${record.name} · ${money(record.amount_cents, record.currency)} · ${record.vendor_name} · ${record.status === 'delivered' ? 'Delivered' : 'Purchased'}`));
    }
    if (!settings.awards.length) {
      orders.replaceChildren(
        element('p', 'muted', 'Player vendor choices will appear here after you complete the tournament.')
      );
      return;
    }
    const list = element('div', 'prize-order-list');
    for (const award of settings.awards) {
      const row = element('article', 'prize-order');
      row.append(
        element('h4', '', `${award.name}${award.kind === 'consolation' ? ' · Consolation' : ''}`),
        element('p', 'prize-order-amount', money(award.amount_cents, award.currency)),
        element('p', 'muted', award.vendor_name || 'Awaiting vendor choice')
      );
      const label = element('label', '', `Gift-card status for ${award.name}`);
      const select = element('select', 'prize-fulfillment-control');
      select.id = `fulfillment-${award.player_id}`;
      label.htmlFor = select.id;
      select.dataset.hasVendor = String(Boolean(award.vendor_id));
      select.append(new Option('To buy', 'pending'), new Option('Purchased', 'purchased'), new Option('Delivered', 'delivered'));
      select.value = award.fulfillment_status;
      select.addEventListener('change', async () => {
        if (!loaded) return;
        const id = eventId;
        const status = select.value;
        select.value = award.fulfillment_status;
        message($('#prizeSettingsMessage'), 'Saving gift-card status…');
        const result = await run(
          () => request(`/api/championship/${id}/players/${award.player_id}/prize/fulfillment`,
            { expectedRevision: loaded.revision, revealId: award.reveal_id, status }, 'PUT'),
          (next) => {
            loaded = null;
            applyState(next);
            message($('#prizeSettingsMessage'), 'Gift-card status saved.', 'success');
          }
        );
        if (!result && eventId === id)
          message($('#prizeSettingsMessage'), 'Could not confirm the gift-card status. Reconnect or log in, then try again.', 'error');
      });
      row.append(label, select);
      list.append(row);
    }
    orders.replaceChildren(list);
  }

  function renderStatus() {
    const stale = dirty && loaded && loaded.revision !== state?.revision;
    for (const field of form.elements) field.disabled = busy || !loaded;
    $('#savePrizeSettings').disabled = busy || !loaded || Boolean(stale);
    $('#savePrizeDefaults').disabled = busy || !loaded || dirty || loaded.revision !== state?.revision;
    for (const control of $('#prizeOrders').querySelectorAll('select'))
      control.disabled = busy || !loaded || loaded.revision !== state?.revision || control.dataset.hasVendor !== 'true';
    $('#prizeDefaultsStatus').textContent = dirty
      ? 'Save your prize changes before saving the default setup.'
      : loaded?.defaults_saved_at
        ? 'A default setup is saved. New tournaments will use it automatically.'
        : 'No default setup saved yet.';
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
    const withdrawn = state.players.filter((p) => p.withdrawn_at).length;
    const placements = Math.min(3, 9 - withdrawn);
    const budget = total.slice(0, placements).reduce((sum, amount) => sum + amount, 0) + total[3] * (9 - placements);
    $('#prizeBudget').textContent =
      currency && total.every(Number.isFinite)
        ? `Nine-player prize budget: ${money(Math.round(budget * 100), currency)}`
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
    if (vendors.children.length >= 32)
      return message($('#prizeSettingsMessage'), 'You can offer up to 32 vendors.', 'warning');
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
  $('#savePrizeDefaults').addEventListener('click', () => {
    if (!loaded || dirty) return;
    run(
      () => request(`/api/championship/${eventId}/prizes/defaults`, { expectedRevision: loaded.revision }),
      (next) => {
        loaded = null;
        applyState(next);
        message($('#prizeSettingsMessage'), 'Default prize setup saved for future tournaments.', 'success');
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
