/**
 * 2.22.0 — the all-tools sweep of 8 Oct 2026, pinned on this package's own surface: what the
 * schemas accept and what the handlers send to the API.
 *
 * WHY. Each was reproduced on production through this package (2.21.2) first:
 *  - list calls (vehicle_lookup, uld_lookup, container_lookup, incoterms_lookup, airline_lookup
 *    by query/country) returned every record's audit prose — 25k–607k characters, which MCP
 *    clients refuse unread. Lists now ask the API for view=summary, paged;
 *  - "8471.30" (hs_code_lookup code), "GB LHR" (unlocode_lookup code) and "UN 1263"
 *    (adr_lq_eq_check) were refused by the schema although each is the written form;
 *  - unit_converter took a negative mass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from './tools.js';

const get = (name: string) => {
  const t = ALL_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

async function sentUrl(name: string, args: Record<string, unknown>): Promise<URL> {
  const realFetch = globalThis.fetch;
  let url: URL | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    url = new URL(String(input));
    return new Response(JSON.stringify({ count: 0, results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try { await get(name).handler(args); } finally { globalThis.fetch = realFetch; }
  if (!url) throw new Error('no request sent');
  return url;
}

test('list calls ask for summary rows; single records and full: true do not', async () => {
  for (const [name, args] of [['vehicle_lookup', {}], ['uld_lookup', { category: 'container' }], ['container_lookup', {}], ['incoterms_lookup', {}]] as const) {
    const u = await sentUrl(name, args);
    assert.equal(u.searchParams.get('view'), 'summary', `${name} list did not ask for view=summary`);
  }
  assert.equal((await sentUrl('vehicle_lookup', { slug: 'standard-curtainsider' })).searchParams.get('view'), null, 'a single vehicle must be the full record');
  assert.equal((await sentUrl('uld_lookup', { type: 'AKE' })).searchParams.get('view'), null, 'a single ULD must be the full record');
  const full = await sentUrl('vehicle_lookup', { full: true });
  assert.equal(full.searchParams.get('view'), null, 'full: true must ask for full rows');
  assert.equal(full.searchParams.get('limit'), '5', 'full rows page five at a time by default');
});

test('airline query and country lists page 25 summary rows; exact codes stay full', async () => {
  const c = await sentUrl('airline_lookup', { country: 'United States' });
  assert.equal(c.searchParams.get('view'), 'summary');
  assert.equal(c.searchParams.get('limit'), '25');
  const p = await sentUrl('airline_lookup', { prefix: '176' });
  assert.equal(p.searchParams.get('view'), null, 'an AWB prefix answer is the holder records in full');
});

test('adr_lookup forwards offset and limit', async () => {
  const u = await sentUrl('adr_lookup', { hazard_class: '8', offset: 100, limit: 50 });
  assert.equal(u.searchParams.get('offset'), '100');
  assert.equal(u.searchParams.get('limit'), '50');
});

test('written forms are accepted by the schemas', () => {
  assert.ok(get('hs_code_lookup').schema.safeParse({ code: '8471.30' }).success, '"8471.30" refused');
  assert.ok(get('hs_code_lookup').schema.safeParse({ code: '8471 30' }).success, '"8471 30" refused');
  assert.equal(get('hs_code_lookup').schema.safeParse({ code: '84a1' }).success, false, '"84a1" accepted');
  assert.ok(get('unlocode_lookup').schema.safeParse({ code: 'GB LHR' }).success, '"GB LHR" refused');
  assert.equal(get('unlocode_lookup').schema.safeParse({ code: 'GB LH' }).success, false, '"GB LH" accepted');
  assert.ok(get('adr_lq_eq_check').schema.safeParse({ mode: 'lq', items: [{ un_number: 'UN 1263', quantity: 1, unit: 'L' }] }).success, '"UN 1263" refused');
});

test('unit_converter refuses a negative value', () => {
  assert.equal(get('unit_converter').schema.safeParse({ value: -5, from: 'kg', to: 'lbs' }).success, false);
  assert.ok(get('unit_converter').schema.safeParse({ value: 0, from: 'kg', to: 'lbs' }).success);
});

test('descriptions state the contracts the sweep fixed', () => {
  assert.ok(!get('chargeable_weight_calculator').description.includes('rounded to 2 decimal places before totalling'), 'the per-piece rounding claim is back');
  assert.ok(get('chargeable_weight_calculator').description.includes('TOTAL for all pieces'));
  assert.ok(get('shipment_summary').description.includes('TOTAL for the dangerous-goods line'));
  assert.ok(get('pallet_fitting_calculator').description.includes('volume_utilisation_percent'));
  assert.ok(get('uk_duty_calculator').description.includes('never padded'));
  for (const name of ['cbm_calculator', 'ldm_calculator', 'pallet_fitting_calculator', 'uk_duty_calculator']) {
    assert.ok(get(name).description.includes('camelCase'), `${name} does not say the hosted endpoint serves camelCase`);
  }
});
