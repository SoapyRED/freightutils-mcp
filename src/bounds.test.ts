/**
 * Schema bounds that mirror the REST API's own refusals (2.21.1).
 *
 * The MCP Marketplace scan said "input validation relies entirely on Zod schemas". It does not —
 * the API validates every request again on the server — but several schemas were looser than the
 * API, so an out-of-range value crossed the network only to be refused there. 2.21.1 adds the
 * API's own bounds to the schemas, and ONLY those: each one is a value the API already refuses
 * with a 400 (the REST evidence is cited per case), so nothing the API accepts is refused here.
 *
 * For every bound: the value just past it is a schema error that never reaches the network, and
 * the value at the bound still reaches the API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

async function connect() {
  const server = createServer();
  const client = new Client({ name: 'bounds-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

/** Calls the tool with fetch replaced; returns whether the call reached the network. */
async function reachesApi(tool: string, args: Record<string, unknown>): Promise<{ reached: boolean; text: string; isError: boolean }> {
  const real = globalThis.fetch;
  let reached = false;
  globalThis.fetch = (async () => {
    reached = true;
    return new Response(JSON.stringify({ error: 'stub' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const { client, close } = await connect();
  try {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = ((r.content as Array<{ text?: string }>) ?? []).map((c) => c.text ?? '').join('\n');
    return { reached, text, isError: r.isError === true };
  } finally {
    await close();
    globalThis.fetch = real;
  }
}

async function refused(tool: string, args: Record<string, unknown>, mentions: RegExp) {
  const r = await reachesApi(tool, args);
  assert.equal(r.reached, false, `${tool} ${JSON.stringify(args).slice(0, 80)} reached the API`);
  assert.equal(r.isError, true);
  assert.match(r.text, /Input validation error/);
  assert.match(r.text, mentions);
}
async function accepted(tool: string, args: Record<string, unknown>) {
  const r = await reachesApi(tool, args);
  assert.equal(r.reached, true, `${tool} refused a value the API accepts: ${r.text.slice(0, 200)}`);
}

const box = { length: 120, width: 80, height: 100, weight: 250, quantity: 1 };
const line = (extra: Record<string, unknown> = {}) => ({ quantity: 1, dims: { l: 120, w: 80, h: 100, unit: 'cm' }, weight: { value: 250, unit: 'kg' }, ...extra });

test('adr_exemption_calculator: quantity ≤ 1,000,000,000 (adr-quantity-input.ts: "at most 1000000000"); items non-empty (route: empty items → 400); variant_index a safe integer', async () => {
  await refused('adr_exemption_calculator', { un_number: '1203', quantity: 1_000_000_001 }, /at most 1,000,000,000/);
  await accepted('adr_exemption_calculator', { un_number: '1203', quantity: 1_000_000_000 });
  await refused('adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 1_000_000_001 }] }, /at most 1,000,000,000/);
  await refused('adr_exemption_calculator', { items: [] }, /at least one item/);
  await refused('adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 5, variant_index: 2 ** 53 }] }, /safe integer/);
  await accepted('adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 5, variant_index: 0 }] });
});

test('adr_lq_eq_check: quantity ≤ 1,000,000,000 and variant_index a safe integer (lq-check route → adr-quantity-input.ts)', async () => {
  await refused('adr_lq_eq_check', { mode: 'lq', items: [{ un_number: '1203', quantity: 1_000_000_001, unit: 'L' }] }, /at most 1,000,000,000/);
  await refused('adr_lq_eq_check', { mode: 'lq', items: [{ un_number: '1203', quantity: 0.5, unit: 'L', variant_index: 2 ** 53 }] }, /safe integer/);
  await accepted('adr_lq_eq_check', { mode: 'lq', items: [{ un_number: '1203', quantity: 1_000_000_000, unit: 'L' }] });
});

test('shipment_summary: 1–50 items, weight ≥ 0, quantity ≤ 1,000,000, adr_quantity ≤ 1,000,000,000 (shipment/summary route)', async () => {
  await refused('shipment_summary', { mode: 'road', items: [] }, /at least one item/);
  await refused('shipment_summary', { mode: 'road', items: Array.from({ length: 51 }, () => box) }, /at most 50 items/);
  await accepted('shipment_summary', { mode: 'road', items: Array.from({ length: 50 }, () => box) });
  await refused('shipment_summary', { mode: 'road', items: [{ ...box, weight: -1 }] }, /weight must be 0 or more/);
  await accepted('shipment_summary', { mode: 'road', items: [{ ...box, weight: 0 }] });
  await refused('shipment_summary', { mode: 'road', items: [{ ...box, quantity: 1_000_001 }] }, /at most 1,000,000/);
  await refused('shipment_summary', { mode: 'road', items: [{ ...box, un_number: '1203', adr_quantity: 1_000_000_001, adr_quantity_unit: 'L' }] }, /at most 1,000,000,000/);
});

test('consignment_calculator lines[] and options: the canonical schema\'s limits (lib/calculations/consignment-schema.ts)', async () => {
  await refused('consignment_calculator', { lines: [line({ description: 'x'.repeat(201) })] }, /at most 200 characters/);
  await accepted('consignment_calculator', { lines: [line({ description: 'x'.repeat(200) })] });
  await refused('consignment_calculator', { lines: [line({ quantity: 100_001 })] }, /at most 100,000/);
  await refused('consignment_calculator', { lines: [line({ hs_code: '12345' })] }, /HS code must be 6–10 digits/);
  await accepted('consignment_calculator', { lines: [line({ hs_code: '847130' })] });
  await refused('consignment_calculator', { lines: [line({ un_number: '12A4' })] }, /UN number must be 4 digits/);
  await accepted('consignment_calculator', { lines: [line({ un_number: 'UN1203' })] });
  await refused('consignment_calculator', { lines: [line()], options: { air_volumetric_divisor: 10_001 } }, /at most 10,000/);
  await refused('consignment_calculator', { lines: [line()], options: { container_number: 'X'.repeat(21) } }, /at most 20 characters/);
  await accepted('consignment_calculator', { lines: [line()], options: { container_number: 'MSKU1100810', awb_number: '176-12345675' } });
});

test('ics2_check, resolve_reference, airline_lookup: blank input refused as the API refuses it', async () => {
  await refused('ics2_check', { description: '' }, /must not be empty/);
  await accepted('ics2_check', { description: ' ' });          // the API answers a single space; not refused here
  await refused('resolve_reference', { q: '   ' }, /must not be blank/);
  await accepted('resolve_reference', { q: ' 176 ' });         // the API trims; raw length ≤ 32
  await refused('airline_lookup', { query: '  a ' }, /not counting spaces/);
  await accepted('airline_lookup', { query: 'em' });
});

test('tools/list advertises the bounds, so an agent can see them before it calls', async () => {
  const { client, close } = await connect();
  try {
    const tools = (await client.listTools()).tools;
    const schema = (name: string) => JSON.stringify(tools.find((t) => t.name === name)?.inputSchema);
    assert.match(schema('adr_exemption_calculator'), /"maximum":1000000000/);
    assert.match(schema('shipment_summary'), /"maxItems":50/);
    assert.match(schema('shipment_summary'), /"minItems":1/);
    assert.match(schema('consignment_calculator'), /"maxLength":200/);
  } finally {
    await close();
  }
});
