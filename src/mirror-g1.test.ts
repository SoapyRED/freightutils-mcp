/**
 * The 2.25.0-pending mirror of freightutils.com G1 — the ADR code registry: adr_lookup forwards include_codes
 * and its outputSchema types resolved_codes; the two descriptions name the registry. API stubbed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';

async function connect() {
  const server = createServer({});
  const client = new Client({ name: 'mirror-g1-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

async function withApi<T>(body: unknown, fn: (calls: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}

const ROW = {
  un_number: '1203', proper_shipping_name: 'MOTOR SPIRIT', class: '3', classification_code: 'F1', packing_group: 'II',
  tank_special_provisions: 'TU9', variant_index: 0, variant_count: 1,
  resolved_codes: [
    { column: '13', code: 'TU9', family: 'tsp', summary: 's', section: '4.3.5, TU9', verification_status: 'paraphrase_unreviewed', url: 'https://www.freightutils.com/adr/codes/tsp/TU9' },
    { column: '15', code: '(D/E)', family: 'tunnel_code', summary: 't', section: '8.6.4', verification_status: 'verified', url: 'https://www.freightutils.com/adr/tunnel-codes' },
  ],
};
const ENV = {
  envelope_version: '1.2', ok: true, status: 'ok', missing_inputs: [], edition: { name: 'ADR 2025', applies_from: '2025-01-01', may_apply_until: '2027-06-30' }, as_of: '2026-10-29',
  result: { count: 1, results: [ROW], meta: {} }, confidence: { level: 'high', basis: 'provenance' },
  _source: { name: 'ADR 2025', checked: '2026-10-29', provenance_status: 'verified' }, citation: { text: 'c' },
};

test('adr_lookup forwards include_codes and validates resolved_codes through its outputSchema', async () => {
  const { client, close } = await connect();
  await withApi(ENV, async (calls) => {
    const r = await client.callTool({ name: 'adr_lookup', arguments: { un_number: '1203', include_codes: 'full' } });
    assert.equal(new URL(calls[0]).searchParams.get('include_codes'), 'full');
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 300));
    const sc = r.structuredContent as { result: { results: Array<{ resolved_codes: unknown[] }> } };
    assert.equal(sc.result.results[0].resolved_codes.length, 2);
    await client.callTool({ name: 'adr_lookup', arguments: { un_numbers: ['1203'], include_codes: 'compact' } });
    const u = new URL(calls[1]);
    assert.equal(u.searchParams.get('un_numbers'), '1203');
    assert.equal(u.searchParams.get('include_codes'), 'compact');
    await client.callTool({ name: 'adr_lookup', arguments: { un_number: '1203' } });
    assert.equal(new URL(calls[2]).searchParams.has('include_codes'), false, 'not sent unless given: the API default applies');
  });
  const bad = await client.callTool({ name: 'adr_lookup', arguments: { un_number: '1203', include_codes: 'everything' } });
  assert.ok(bad.isError, 'an unknown include_codes value is refused');
  await close();
});

test('descriptions: adr_lookup names all 20 columns and resolved_codes; resolve_reference names the ADR code families', () => {
  const adr = ALL_TOOLS.find((t) => t.name === 'adr_lookup')!.description;
  assert.match(adr.split('\n')[0], /all 20 columns/);
  assert.match(adr.split('\n')[0], /resolved_codes/);
  assert.match(adr, /paraphrase_unreviewed/);
  const res = ALL_TOOLS.find((t) => t.name === 'resolve_reference')!.description;
  assert.match(res, /ADR Table A codes/);
  assert.match(res, /pattern_only/);
});
