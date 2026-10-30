/**
 * The 2.26.0-pending mirror of freightutils.com Build 1 — ADR editions: the five tools that read ADR data
 * take edition and as_of, forward them to the API, and validate the ADR 2027 answer fields (adr_edition,
 * transitional_1_6_1_61, transitional_notes) through their outputSchema. API stubbed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';

async function connect() {
  const server = createServer({});
  const client = new Client({ name: 'mirror-b1-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

type Call = { url: string; body: Record<string, unknown> | null };
async function withApi<T>(body: unknown, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}

const MARKER = { edition: '2027', name: 'ADR 2027', as_of: '2027-01-15', selected_by: 'edition', applies_from: '2027-01-01', may_apply_until: null };
const env = (result: Record<string, unknown>) => ({
  envelope_version: '1.2', ok: true, status: 'ok', missing_inputs: [], edition: { name: 'ADR 2027', applies_from: '2027-01-01', may_apply_until: null }, as_of: '2027-01-15',
  result, confidence: { level: 'high', basis: 'deterministic' },
  _source: { name: 'ADR 2027', checked: '2026-10-30', provenance_status: 'verified' }, citation: { text: 'c' },
  warnings: [{ code: 'EDITION_TRANSITIONAL', message: 'ADR 2025 may still be applied until 30 June 2027 (1.6.1.1).' }],
});

const FIVE = ['adr_lookup', 'adr_exemption_calculator', 'adr_lq_eq_check', 'consignment_calculator', 'shipment_summary'];

test('the five ADR tools declare edition (2025 | 2027) and as_of, and their descriptions name them', async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  for (const name of FIVE) {
    const t = tools.find((x) => x.name === name)!;
    const props = (t.inputSchema as { properties: Record<string, { enum?: string[]; pattern?: string }> }).properties;
    assert.deepEqual(props.edition?.enum, ['2025', '2027'], `${name} edition`);
    assert.ok(props.as_of?.pattern, `${name} as_of`);
    assert.match(t.description ?? '', /edition \("2025" \| "2027"\) and as_of/, `${name} description`);
  }
  for (const t of tools.filter((x) => !FIVE.includes(x.name))) {
    assert.ok(!('edition' in ((t.inputSchema as { properties?: object }).properties ?? {})), `${t.name} takes no edition`);
  }
  assert.equal(ALL_TOOLS.length, tools.length);
  await close();
});

test('adr_lookup forwards edition and as_of as query parameters; transitional_notes validate', async () => {
  const { client, close } = await connect();
  const body = env({ count: 1, results: [{ un_number: '2372', proper_shipping_name: 'x', class: '3', classification_code: 'FTC', packing_group: 'II', tank_code: 'L4BH', variant_index: 0, variant_count: 1 }], adr_edition: MARKER, transitional_notes: [{ un_number: '2372', variant_index: 0, column: '12', measure: '1.6.3.64 / 1.6.4.70', adr_2025_value: 'LGBF', adr_2027_value: 'L4BH', text: 't', until: '2030-12-31' }] });
  await withApi(body, async (calls) => {
    const r = await client.callTool({ name: 'adr_lookup', arguments: { un_number: '2372', edition: '2027', as_of: '2027-01-15' } });
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 300));
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get('edition'), '2027');
    assert.equal(u.searchParams.get('as_of'), '2027-01-15');
    await client.callTool({ name: 'adr_lookup', arguments: { un_number: '1203' } });
    assert.equal(new URL(calls[1].url).searchParams.get('edition'), null, 'nothing sent, nothing forwarded');
  });
  await close();
});

test('the calculators forward edition and as_of; transitional_1_6_1_61 validates', async () => {
  const { client, close } = await connect();
  const t1611 = { measure: '1.6.1.61', basis: 'ADR 2025 note a', un_numbers: ['1005'], max_kg: 50, multiplier: 20, points_on_this_basis: 500, exempt_on_this_basis: true, until: '2030-12-31', note: 'n' };
  const body = env({ items: [], total_points: 1250, threshold: 1000, exempt: false, has_category_zero: false, has_quantity_exceedance: true, warnings: [], message: 'm', adr_edition: MARKER, transitional_1_6_1_61: t1611 });
  await withApi(body, async (calls) => {
    const r = await client.callTool({ name: 'adr_exemption_calculator', arguments: { un_number: '1005', quantity: 25, edition: '2027' } });
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 300));
    assert.equal(new URL(calls[0].url).searchParams.get('edition'), '2027');
    await client.callTool({ name: 'adr_exemption_calculator', arguments: { items: [{ un_number: '1005', quantity: 25 }], as_of: '2027-01-15' } });
    assert.equal(calls[1].body?.as_of, '2027-01-15');
    await client.callTool({ name: 'adr_lq_eq_check', arguments: { mode: 'lq', items: [{ un_number: '2956', quantity: 1, unit: 'kg' }], edition: '2027' } });
    assert.equal(calls[2].body?.edition, '2027');
    await client.callTool({ name: 'shipment_summary', arguments: { mode: 'road', items: [{ length: 60, width: 40, height: 40, weight: 30, quantity: 1, un_number: '0081' }], edition: '2027', as_of: '2027-01-15' } });
    assert.equal(calls[3].body?.edition, '2027');
    assert.equal(calls[3].body?.as_of, '2027-01-15');
    await client.callTool({ name: 'consignment_calculator', arguments: { mode: 'road', items: [{ length: 120, width: 80, height: 100, quantity: 1, gross_weight: 100 }], edition: '2027' } });
    assert.equal(calls[4].body?.edition, '2027');
  });
  await close();
});

test('edition outside 2025 | 2027 and a malformed as_of are refused before any call', async () => {
  const { client, close } = await connect();
  await withApi({}, async (calls) => {
    const a = await client.callTool({ name: 'adr_lookup', arguments: { un_number: '1203', edition: '2026' } });
    const b = await client.callTool({ name: 'adr_lookup', arguments: { un_number: '1203', as_of: '15/01/2027' } });
    assert.ok(a.isError && b.isError);
    assert.equal(calls.length, 0);
  });
  await close();
});
