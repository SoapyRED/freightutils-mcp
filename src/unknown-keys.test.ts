/**
 * Unknown keys are REFUSED by name on the three ADR-answer tools — the 2.21.0 contract.
 *
 * WHY. Every tool declared `.strict()`, but server.ts registered `schema.shape`, so the SDK
 * rebuilt a plain z.object that STRIPS unknown keys: the `.strict()` was inert, and tools/list
 * even advertised `additionalProperties: false` while the call dropped the key. Reproduced on
 * production through 2.20.1 (2026-10-06):
 *  - adr_exemption_calculator, item `{ un_number: "1203", quantity: 300, quantity_basis: "gross" }`
 *    → "exempt", 900 points (the API's own echo name; `basis: "gross"` withholds);
 *  - adr_exemption_calculator, `un: "1051", qty: 1` beside items[] → dropped, the load "exempt";
 *  - adr_lq_eq_check, EQ, 0.03 L of UN 1203 with `inner_packagings: 20` → "qualifies" (one inner
 *    packaging per outer was checked; 20 × 30 ml = 600 ml is over E2's 500 ml, ADR 3.5.1.2);
 *  - shipment_summary, a line with `un: "1051"` → not a dangerous-goods line at all.
 * These tests drive the real server over the SDK's in-memory transport, so they pin what an
 * MCP client sees — and that a refused call never reaches the API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { unknownKeysMessage } from './strict-input.js';

const STRICT = ['adr_exemption_calculator', 'adr_lq_eq_check', 'shipment_summary'];

async function connect() {
  const server = createServer();
  const client = new Client({ name: 'unknown-keys-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

/** Fails the test if a refused call reaches the network. */
async function withNoFetch<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('a refused call reached the API'); }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const textOf = (r: unknown) => (((r as { content?: Array<{ text?: string }> }).content) ?? []).map((c) => c.text ?? '').join('\n');

/** The SDK reports a schema refusal as "MCP error -32602: Input validation error: Invalid
 *  arguments for tool <name>: <the zod issues as JSON>". The issue messages, decoded. */
function issueMessages(text: string): string[] {
  const at = text.indexOf('[');
  assert.ok(text.includes('Input validation error') && at > 0, `not a schema refusal: ${text.slice(0, 300)}`);
  const issues = JSON.parse(text.slice(at)) as Array<{ code: string; message: string }>;
  assert.ok(issues.some((i) => i.code === 'unrecognized_keys'), `no unrecognized_keys issue: ${text.slice(0, 300)}`);
  return issues.map((i) => i.message);
}

test('the refusal text is the website\'s, word for word (lib/calculations/request-keys.ts; lint:adr-variants (10a) pins the same sentence)', () => {
  const m = unknownKeysMessage(
    ['quantity_basis'],
    ['un_number', 'quantity', 'quantity_basis'],
    ['un_number', 'quantity', 'packing_group', 'variant_index', 'unit', 'basis'],
    { hints: { quantityunit: 'unit', quantitybasis: 'basis', un: 'un_number', qty: 'quantity' }, acceptedLabel: 'Accepted on each item' },
    'on items[0]',
  );
  assert.equal(m, 'Unknown field "quantity_basis" on items[0] — refused, not ignored: a field this tool does not read could carry a declaration that changes the answer, so no answer is given. Did you mean "basis"? Accepted on each item: un_number, quantity, packing_group, variant_index, unit, basis.');
});

test('tools/list: the three tools publish additionalProperties false on every object they read', async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    for (const name of STRICT) {
      const t = tools.find((x) => x.name === name);
      assert.ok(t, `${name} is not listed`);
      const s = t.inputSchema as { additionalProperties?: unknown; properties: Record<string, { items?: { additionalProperties?: unknown }; additionalProperties?: unknown }> };
      assert.equal(s.additionalProperties, false, `${name}: top level`);
      assert.equal(s.properties.items?.items?.additionalProperties, false, `${name}: items[]`);
    }
    const ss = tools.find((x) => x.name === 'shipment_summary')!.inputSchema as { properties: Record<string, { additionalProperties?: unknown }> };
    assert.equal(ss.properties.origin.additionalProperties, false, 'shipment_summary: origin');
    assert.equal(ss.properties.destination.additionalProperties, false, 'shipment_summary: destination');
  } finally { await close(); }
});

test('the three tools describe the rule', async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    for (const name of STRICT) {
      const d = tools.find((x) => x.name === name)!.description ?? '';
      assert.ok(d.includes('a field the tool does not read is refused with a tool error naming it and listing the accepted ones, never ignored'), `${name}: description does not state the rule`);
    }
  } finally { await close(); }
});

for (const [label, name, args, mustSay] of [
  ['an item key (the API\'s echo name quantity_basis)', 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 300, quantity_basis: 'gross' }] }, ['"quantity_basis" on items[0]', 'Did you mean "basis"?']],
  ['an item key in another case (Unit)', 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 300, Unit: 'kg' }] }, ['"Unit" on items[0]', 'Did you mean "unit"?']],
  ['a top-level key beside items[] (Unit)', 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 300 }], Unit: 'kg' }, ['"Unit" in the arguments', 'Did you mean "unit"?']],
  ['the GET spellings un + qty beside items[]', 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 200 }], un: '1051', qty: 1 }, ['"un" and "qty" in the arguments', '"un_number" for "un"']],
  ['UN_NUMBER + QUANTITY beside items[]', 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 200 }], UN_NUMBER: '1051', QUANTITY: 1 }, ['"UN_NUMBER" and "QUANTITY" in the arguments']],
  ['the single-substance form + quantity_basis', 'adr_exemption_calculator', { un_number: '1203', quantity: 300, quantity_basis: 'gross' }, ['"quantity_basis" in the arguments', 'Did you mean "basis"?']],
  ['EQ inner_packagings on the item', 'adr_lq_eq_check', { mode: 'eq', items: [{ un_number: '1203', quantity: 0.03, unit: 'L', inner_packagings: 20 }] }, ['"inner_packagings" on items[0]', 'Did you mean "inner_packaging_qty"?']],
  ['EQ inner_packaging_qty beside items[]', 'adr_lq_eq_check', { mode: 'eq', inner_packaging_qty: 20, items: [{ un_number: '1203', quantity: 0.03, unit: 'L' }] }, ['"inner_packaging_qty" in the arguments', 'items[n].inner_packaging_qty']],
  ['a shipment line with un', 'shipment_summary', { mode: 'road', items: [{ length: 120, width: 80, height: 100, weight: 250, quantity: 1, un: '1051', adr_quantity: 1, adr_quantity_unit: 'L' }] }, ['"un" on items[0]', 'Did you mean "un_number"?']],
  ['a shipment line with unNumber', 'shipment_summary', { mode: 'road', items: [{ length: 120, width: 80, height: 100, weight: 250, quantity: 1, un_number: '1203', unNumber: '1051', adr_quantity: 200, adr_quantity_unit: 'L' }] }, ['"unNumber" on items[0]']],
  ['a shipment origin key', 'shipment_summary', { mode: 'road', origin: { country_code: 'DE' }, items: [{ length: 120, width: 80, height: 100, weight: 250, quantity: 1 }] }, ['"country_code" in origin']],
] as const) {
  test(`${name}: ${label} → a tool error naming it, never an answer, never a network call`, async () => {
    const { client, close } = await connect();
    try {
      const r = await withNoFetch(() => client.callTool({ name, arguments: args as Record<string, unknown> }));
      assert.equal(r.isError, true, `${name} answered: ${textOf(r).slice(0, 300)}`);
      const t = issueMessages(textOf(r)).join('\n');
      assert.ok(t.includes('refused, not ignored'), t.slice(0, 400));
      for (const s of mustSay) assert.ok(t.includes(s), `missing ${s} in ${t.slice(0, 600)}`);
      assert.equal(t.includes('exemption applies'), false);
    } finally { await close(); }
  });
}

test('documented keys still reach the API unchanged (the strict schema refuses nothing it reads)', async () => {
  const { client, close } = await connect();
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ envelope_version: '1.1', ok: true, result: {}, confidence: { level: 'high', basis: 'deterministic' }, _source: { name: 'x', checked: '2026-10-06', provenance_status: 'computed' }, citation: { text: 'x' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    for (const [name, args] of [
      ['adr_exemption_calculator', { items: [{ un_number: '1263', quantity: 100, packing_group: 'III', variant_index: 3, unit: 'L', basis: 'net' }] }],
      ['adr_exemption_calculator', { un_number: '1203', quantity: 200, unit: 'L' }],
      ['adr_lq_eq_check', { mode: 'eq', items: [{ un_number: '1203', quantity: 0.03, unit: 'L', inner_packaging_qty: 20, packing_group: 'II', variant_index: 0 }] }],
      ['shipment_summary', { mode: 'road', items: [{ description: 'x', length: 120, width: 80, height: 100, weight: 250, quantity: 2, stackable: false, pallet_type: 'euro', hs_code: '847989', un_number: '1203', adr_quantity: 200, adr_quantity_unit: 'L', customs_value: 100 }], origin: { country: 'DE', locode: 'DEHAM' }, destination: { country: 'GB' }, incoterm: 'DAP', freight_cost: 10, insurance_cost: 1 }],
    ] as const) {
      const r = await client.callTool({ name, arguments: args as unknown as Record<string, unknown> });
      assert.notEqual(r.isError, true, `${name} refused a documented call: ${textOf(r).slice(0, 300)}`);
    }
    assert.equal(urls.length, 4, `expected one API request per call, got ${urls.length}`);
  } finally { globalThis.fetch = real; await close(); }
});
