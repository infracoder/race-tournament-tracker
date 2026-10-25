const { randomUUID } = require('node:crypto');

const DEFAULT_TIERS = Object.freeze({ first: 10000, second: 7500, third: 5000, participation: 1500 });
const TIER_KEYS = Object.keys(DEFAULT_TIERS);

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function validatePrizeSettings(body) {
  if (!body || typeof body.enabled !== 'boolean') invalid('Choose whether gift-card prizes are enabled.');
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase().trim() : '';
  if (currency && !Intl.supportedValuesOf('currency').includes(currency))
    invalid('Choose a supported currency.');
  if (body.enabled && !currency) invalid('Choose the currency for your prizes.');
  const tiers = Object.fromEntries(TIER_KEYS.map((key) => [key, body.tiers?.[key]]));
  if (Object.values(tiers).some((value) => !Number.isSafeInteger(value) || value < 0 || value > 100000000))
    invalid('Enter each prize amount with no more than two decimal places.');
  if (!Array.isArray(body.vendors) || body.vendors.length > 12 || (body.enabled && !body.vendors.length))
    invalid('Add between one and twelve gift-card vendors.');
  const vendors = body.vendors.map((vendor) => {
    if (!vendor || typeof vendor.name !== 'string' || !vendor.name.trim() || vendor.name.trim().length > 60)
      invalid('Give each vendor a name of up to 60 characters.');
    if (vendor.id !== undefined && (typeof vendor.id !== 'string' || !vendor.id)) invalid('Invalid vendor.');
    return { ...(vendor.id ? { id: vendor.id } : {}), name: vendor.name.trim() };
  });
  if (
    new Set(vendors.map((v) => v.name.toLocaleLowerCase('en'))).size !== vendors.length ||
    new Set(vendors.filter((v) => v.id).map((v) => v.id)).size !== vendors.filter((v) => v.id).length
  )
    invalid('Each vendor must appear only once.');
  return { enabled: body.enabled, currency, tiers, vendors };
}

async function readPrizeSettings(tx, id) {
  const row = await tx.get(
    'SELECT enabled, currency, first_cents, second_cents, third_cents, participation_cents FROM championship_prize_settings WHERE championship_id = ?',
    [id]
  );
  const vendors = await tx.all(
    'SELECT id, name, artwork IS NOT NULL AS has_artwork FROM championship_prize_vendors WHERE championship_id = ? ORDER BY position',
    [id]
  );
  return {
    enabled: Boolean(row?.enabled),
    currency: row?.currency || '',
    tiers: row
      ? Object.fromEntries(TIER_KEYS.map((key) => [key, row[`${key}_cents`]]))
      : { ...DEFAULT_TIERS },
    vendors: vendors.map((v) => ({ ...v, has_artwork: Boolean(v.has_artwork) }))
  };
}

async function writePrizeSettings(tx, id, settings) {
  const existing = await readPrizeSettings(tx, id);
  if (settings.vendors.some((v) => v.id && !existing.vendors.some((old) => old.id === v.id)))
    invalid('Reload the prize settings before editing these vendors.');
  const canonical = (value) =>
    JSON.stringify({ ...value, vendors: value.vendors.map(({ id, name }) => ({ id, name })) });
  if (canonical(existing) === canonical(settings)) return false;
  await tx.run('DELETE FROM championship_prize_awards WHERE championship_id = ?', [id]);
  await tx.run(
    `INSERT INTO championship_prize_settings (championship_id, enabled, currency, first_cents, second_cents, third_cents, participation_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(championship_id) DO UPDATE SET enabled=excluded.enabled, currency=excluded.currency,
    first_cents=excluded.first_cents, second_cents=excluded.second_cents, third_cents=excluded.third_cents, participation_cents=excluded.participation_cents`,
    [id, Number(settings.enabled), settings.currency, ...TIER_KEYS.map((key) => settings.tiers[key])]
  );
  for (const old of existing.vendors) {
    if (!settings.vendors.some((v) => v.id === old.id))
      await tx.run('DELETE FROM championship_prize_vendors WHERE championship_id = ? AND id = ?', [
        id,
        old.id
      ]);
  }
  for (const [position, vendor] of settings.vendors.entries()) {
    if (vendor.id)
      await tx.run(
        'UPDATE championship_prize_vendors SET name = ?, position = ? WHERE championship_id = ? AND id = ?',
        [vendor.name, position, id, vendor.id]
      );
    else
      await tx.run(
        'INSERT INTO championship_prize_vendors (championship_id, id, name, position) VALUES (?, ?, ?, ?)',
        [id, randomUUID(), vendor.name, position]
      );
  }
  return true;
}

function validateArtwork(bytes, contentType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 1048576)
    invalid('Choose a PNG, JPEG, or WebP image no larger than 1 MB.');
  const detected = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    ? 'image/png'
    : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      ? 'image/jpeg'
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
        ? 'image/webp'
        : null;
  if (!detected || contentType !== detected) invalid('Choose a PNG, JPEG, or WebP image.');
  return detected;
}

function vendorArtwork(vendor) {
  if (vendor.artwork) return { bytes: vendor.artwork, type: vendor.artwork_type };
  const escape = (value) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]
    );
  return {
    type: 'image/svg+xml',
    bytes: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#22252c"/><stop offset="1" stop-color="#49404f"/></linearGradient></defs><rect width="640" height="400" rx="32" fill="url(#bg)"/><path d="M0 0h640v10H0z" fill="#f5c745"/><circle cx="570" cy="90" r="120" fill="#ffffff08"/><text x="48" y="72" fill="#f5c745" font-family="sans-serif" font-size="17" font-weight="700" letter-spacing="4">TOLSMA KART 03</text><text x="48" y="205" fill="white" font-family="sans-serif" font-size="30" font-weight="700">${escape(vendor.name)}</text><text x="48" y="328" fill="#bdbcc4" font-family="sans-serif" font-size="21" letter-spacing="5">GIFT CARD</text></svg>`
    )
  };
}

function prizeGroups(standings, settings) {
  if (!settings.enabled) return [];
  const amounts = [
    settings.tiers.first,
    settings.tiers.second,
    settings.tiers.third,
    ...Array(6).fill(settings.tiers.participation)
  ];
  const groups = [];
  for (let index = 0; index < standings.length; ) {
    const players = standings.filter((p) => p.total_units === standings[index].total_units);
    const prizes = amounts.slice(index, index + players.length);
    let needed = 0;
    for (let offset = 0; offset < prizes.length - 1; offset++) {
      if (prizes[offset] !== prizes.at(-1)) needed = offset + 1;
    }
    groups.push({
      rank: index + 1,
      players,
      amounts: prizes,
      places: Array.from({ length: needed }, (_, offset) => index + offset + 1)
    });
    index += players.length;
  }
  return groups;
}

function prizePlayoffGroups(standings, settings) {
  return prizeGroups(standings, settings)
    .filter((group) => group.places.length)
    .map(({ rank, players, places }) => ({ rank, players: players.map(({ id, name }) => ({ id, name })), places }));
}

async function writePrizeAwards(tx, id, standings, settings, playoffs = {}, winnerId) {
  if (!settings.enabled) return;
  const groups = prizeGroups(standings, settings);
  if (!playoffs || typeof playoffs !== 'object' || Array.isArray(playoffs))
    invalid('Record the playoff placements for tied prize places.');
  const required = groups.filter((group) => group.places.length);
  if (Object.keys(playoffs).some((rank) => !required.some((group) => String(group.rank) === rank)))
    invalid('Only tied prize places can be decided by a playoff.');
  const awards = [];
  for (const group of groups) {
    const order = playoffs[group.rank] || [];
    if (!Array.isArray(order)) invalid('Record the playoff placements for this tied group.');
    if (order.length !== group.places.length)
      throw Object.assign(new Error('Prize places are tied on points. Record the playoff placements before revealing prizes.'), { status: 409 });
    if (new Set(order).size !== order.length || order.some((playerId) => !group.players.some((p) => p.id === playerId)))
      invalid('Each playoff place must use a different player from that tied group.');
    if (group.rank === 1 && order.length && order[0] !== winnerId)
      invalid('The first-place prize must go to the championship playoff winner.');
    const resolved = order.length ? order : group.rank === 1 && group.players.length > 1 ? [winnerId] : [];
    const ordered = [
      ...resolved.map((playerId) => group.players.find((p) => p.id === playerId)),
      ...group.players.filter((p) => !resolved.includes(p.id))
    ];
    for (const [offset, player] of ordered.entries()) {
      awards.push({ playerId: player.id, place: group.rank + Math.min(offset, resolved.length), amount: group.amounts[offset] });
    }
  }
  const revealId = randomUUID();
  await tx.run('DELETE FROM championship_prize_awards WHERE championship_id = ?', [id]);
  for (const award of awards) {
    await tx.run(
      'INSERT INTO championship_prize_awards (championship_id, player_id, place, amount_cents, currency, reveal_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, award.playerId, award.place, award.amount, settings.currency, revealId]
    );
  }
}

module.exports = {
  readPrizeSettings,
  writePrizeSettings,
  validatePrizeSettings,
  validateArtwork,
  vendorArtwork,
  prizePlayoffGroups,
  writePrizeAwards
};
