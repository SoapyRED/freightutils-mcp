/**
 * The 2.25.0-pending mirror of freightutils.com build 0B — the consignment object, check receipts,
 * the exemption verdict basis, batch inputs and scopes — pinned against the real server over the
 * SDK's in-memory transport, with the API stubbed (each test records the request it would send).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';
import { SCOPE_TOOLS, scopeFromArgs, type Scope } from './scopes.js';

async function connect(scope?: Scope) {
  const server = createServer(scope ? { scope } : {});
  const client = new Client({ name: 'mirror-0b-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

/** Stub the API: record each request, answer with `body`. */
async function withApi<T>(body: unknown, fn: (calls: Array<{ url: string; method: string; body: unknown }>) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}

const ENV = (result: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  envelope_version: '1.2', ok: true, status: 'ok', missing_inputs: [], edition: null, as_of: '2026-10-29',
  result, confidence: { level: 'high', basis: 'deterministic' },
  _source: { name: 'FreightUtils published methodology', checked: 'request-time', provenance_status: 'computed' },
  citation: { text: 'c' }, ...extra,
});

test('scopes: every scope tool is a registered tool, and a scoped server lists exactly its tools', async () => {
  const names = new Set(ALL_TOOLS.map((t) => t.name));
  for (const [scope, tools] of Object.entries(SCOPE_TOOLS)) {
    for (const t of tools) assert.ok(names.has(t), `${scope}: ${t} is a tool`);
    const { client, close } = await connect(scope as Scope);
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(listed, [...tools].sort());
    assert.equal(client.getServerVersion()?.name, `freightutils-mcp-${scope}`);
    await close();
  }
  const { client, close } = await connect();
  assert.equal((await client.listTools()).tools.length, ALL_TOOLS.length);
  assert.equal(client.getServerVersion()?.name, 'freightutils-mcp');
  await close();
});

test('scopes: --scope and FREIGHTUTILS_SCOPE are read; an unknown scope is an error', () => {
  assert.equal(scopeFromArgs(['--scope', 'dg'], {}), 'dg');
  assert.equal(scopeFromArgs(['--scope=customs'], {}), 'customs');
  assert.equal(scopeFromArgs([], { FREIGHTUTILS_SCOPE: 'ops' }), 'ops');
  assert.equal(scopeFromArgs([], {}), 'all');
  assert.ok(typeof scopeFromArgs(['--scope', 'nope'], {}) === 'object');
});

test('consignment object: sent alone to the exemption calculator as { consignment }', async () => {
  const consignment = { lines: [{ un_number: '1203', quantity: { value: 200, unit: 'L', basis: 'net' } }] };
  await withApi(ENV({ total_points: 600, exempt: true, resolved_subtotal_points: 600, threshold_exceeded_by_resolved_items: false, verdict_basis: 'all_items', unresolved_item_indexes: [] }, { _meta: { check_id: 'chk_AAAAAAAAAAAAAAAAAAAAAA', receipt_url: 'https://www.freightutils.com/api/receipts/chk_AAAAAAAAAAAAAAAAAAAAAA' } }), async (calls) => {
    const { client, close } = await connect();
    const r = await client.callTool({ name: 'adr_exemption_calculator', arguments: { consignment } });
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 300));
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].url, /\/adr-calculator/);
    assert.deepEqual(calls[0].body, { consignment });
    const sc = r.structuredContent as Record<string, Record<string, unknown>>;
    assert.equal(sc._meta.check_id, 'chk_AAAAAAAAAAAAAAAAAAAAAA', 'the receipt rides _meta and validates');
    assert.equal(sc.result.verdict_basis, 'all_items');
    await close();
  });
});

test('consignment object: shipment_summary takes it without mode / items', async () => {
  await withApi(ENV({ mode: 'road', totals: {} }), async (calls) => {
    const { client, close } = await connect();
    const r = await client.callTool({ name: 'shipment_summary', arguments: { consignment: { lines: [{ packages: { count: 1, gross_kg: 10 } }] } } });
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 300));
    assert.deepEqual(Object.keys(calls[0].body as object), ['consignment']);
    await close();
  });
});

test('validate: type "consignment" posts the object', async () => {
  await withApi(ENV({ type: 'consignment', valid: true }), async (calls) => {
    const { client, close } = await connect();
    await client.callTool({ name: 'validate', arguments: { type: 'consignment', consignment: { lines: [{}] } } });
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { type: 'consignment', consignment: { lines: [{}] } });
    await close();
  });
});

test('batch: codes[] goes comma-separated on GET; duty lines[] in the POST body', async () => {
  const batch = ENV({ batch: true, tool: 'unlocode_lookup', count: 2, status: 'ok', not_found: [], unresolved: [], results: [] });
  await withApi(batch, async (calls) => {
    const { client, close } = await connect();
    const r = await client.callTool({ name: 'unlocode_lookup', arguments: { codes: ['NLRTM', 'GBFXT'] } });
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 300));
    assert.equal(new URL(calls[0].url).searchParams.get('codes'), 'NLRTM,GBFXT');
    await client.callTool({ name: 'adr_lookup', arguments: { un_numbers: ['1203', '1845'] } });
    assert.equal(new URL(calls[1].url).searchParams.get('un_numbers'), '1203,1845');
    await client.callTool({ name: 'uk_duty_calculator', arguments: { lines: [{ commodity_code: '6109100010', origin_country: 'CN', customs_value: 1000 }] } });
    assert.deepEqual(Object.keys(calls[2].body as object), ['lines']);
    await close();
  });
});
