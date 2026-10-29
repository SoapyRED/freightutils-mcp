/**
 * The envelope output schema tolerates `_meta` and the v1.2 status fields.
 *
 * WHY. On 2026-10-28 (freightutils.com #281) anonymous REST answers gained a top-level
 * `_meta.identify`. This package's outputSchema is additionalProperties:false and did not
 * declare `_meta`, so in a validating MCP client (SDK Client.callTool) every anonymous tool
 * call through 2.23.0 failed with -32602 "Structured content does not match the tool's output
 * schema". The website moved the line to a response header on 2026-10-29 (Run R4, B-API-01),
 * but the schema must not depend on that: these tests drive the real server over the SDK's
 * in-memory transport with a REST body recorded from production (cbm_calculator, 1.1 +
 * legacy_source) and assert the client accepts it with `_meta` added, and as a 1.2 envelope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

// GET /api/cbm?l=120&w=80&h=100&pcs=2&envelope=1.1&legacy_source=1 — production, 2026-10-29.
const RECORDED_11 = {
  envelope_version: '1.1',
  ok: true,
  result: {
    cbm_per_piece: 0.96, total_cbm: 1.92, total_volume_m3: 1.92, cubic_feet: 67.8042, litres: 1920,
    cubic_inches: 117165.6, pieces: 2, meta: { inputs: { length_cm: 120, width_cm: 80, height_cm: 100, pieces: 2 } },
  },
  confidence: { level: 'high', basis: 'deterministic' },
  _source: { name: 'FreightUtils published methodology', checked: 'request-time', provenance_status: 'computed', source_url: 'https://www.freightutils.com/methodology' },
  citation: { text: 'Total CBM 1.92 m³ (2 piece(s), 0.96 m³ each) — computed per FreightUtils published methodology.' },
  normalized_input: { length_cm: 120, width_cm: 80, height_cm: 100, pieces: 2, defaults_applied: [] },
  legacy_source: { type: 'methodology', standard: 'FreightUtils published methodology', reference: 'Deterministic — see /methodology', source_url: 'https://www.freightutils.com/methodology', computed_by: 'freightutils.com' },
};
const IDENTIFY = 'Anonymous call (25/day per address). A free key raises the limit to 100/day and lets us tell you about changes: POST /api/keys/register. Add ?client=<your-app> if you want to be recognisable in our logs.';

async function callCbmWith(body: unknown) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'envelope-meta-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools(); // the client validates structuredContent against the listed outputSchema
    return await client.callTool({ name: 'cbm_calculator', arguments: { length_cm: 120, width_cm: 80, height_cm: 100, pieces: 2 } });
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}

test('the recorded 1.1 envelope validates (baseline)', async () => {
  const res = await callCbmWith(RECORDED_11);
  assert.notEqual(res.isError, true);
  assert.equal((res.structuredContent as { envelope_version: string }).envelope_version, '1.1');
});

test('a 1.1 envelope carrying a top-level _meta.identify validates (the 2026-10-28 anonymous shape)', async () => {
  const res = await callCbmWith({ ...RECORDED_11, _meta: { identify: IDENTIFY } });
  assert.notEqual(res.isError, true);
  assert.equal((res.structuredContent as { _meta?: { identify?: string } })._meta?.identify, IDENTIFY);
});

test('a 1.2 envelope (status, missing_inputs, edition, as_of, _meta) validates', async () => {
  const res = await callCbmWith({
    ...RECORDED_11, envelope_version: '1.2', status: 'ok', missing_inputs: [], edition: null, as_of: '2026-10-29', _meta: { identify: IDENTIFY },
  });
  assert.notEqual(res.isError, true);
  assert.equal((res.structuredContent as { status?: string }).status, 'ok');
});

// 2.24.0 requests envelope 1.2. Both bodies below are production answers, recorded 2026-10-29.
// GET /api/cbm?l=120&w=80&h=100&pcs=2&envelope=1.2&legacy_source=1 — anonymous, so `_meta` rides last.
const RECORDED_12_OK = {
  envelope_version: '1.2', ok: true, status: 'ok', missing_inputs: [], edition: null, as_of: '2026-10-29',
  result: RECORDED_11.result,
  confidence: RECORDED_11.confidence,
  _source: RECORDED_11._source,
  citation: RECORDED_11.citation,
  normalized_input: RECORDED_11.normalized_input,
  legacy_source: RECORDED_11.legacy_source,
  _meta: { identify: IDENTIFY },
};
// GET /api/hs?envelope=1.2&legacy_source=1 — keyed; HTTP 400, MISSING_INPUT → status "partial".
const RECORDED_12_PARTIAL = {
  envelope_version: '1.2', ok: false, status: 'partial', missing_inputs: ['q'],
  edition: { name: 'HS 2022', applies_from: '2022-01-01', may_apply_until: null }, as_of: '2026-07-24',
  result: {},
  confidence: { level: 'high', basis: 'provenance' },
  _source: { name: 'World Customs Organization (HS 2022)', checked: '2026-07-24', provenance_status: 'verified', dataset_edition: 'HS 2022', authority_current_edition: 'HS 2022', checked_at: '2026-10-28' },
  citation: { text: 'Provide ?q= (search), ?code= (lookup), or ?section= (browse).' },
  blocking_errors: [{ code: 'MISSING_INPUT', message: 'Provide ?q= (search), ?code= (lookup), or ?section= (browse).', recovery: { action: 'Provide one of q, code or section.', tool: 'hs_code_lookup', params: { q: 'coffee' } } }],
};

test('2.24.0 requests ?envelope=1.2 and the recorded 1.2 answer validates with the bridge stripped', async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => {
    urls.push(String(u));
    return new Response(JSON.stringify(RECORDED_12_OK), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'envelope-12-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools();
    const res = await client.callTool({ name: 'cbm_calculator', arguments: { length_cm: 120, width_cm: 80, height_cm: 100, pieces: 2 } });
    assert.notEqual(res.isError, true);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /[?&]envelope=1\.2(&|$)/);
    const sc = res.structuredContent as Record<string, unknown>;
    assert.equal(sc.envelope_version, '1.2');
    assert.equal(sc.status, 'ok');
    assert.deepEqual(sc.missing_inputs, []);
    assert.equal(sc.edition, null);
    assert.equal(sc.as_of, '2026-10-29');
    assert.equal((sc._meta as { identify?: string }).identify, IDENTIFY);
    assert.equal('legacy_source' in sc, false);
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
});

test('a recorded 1.2 MISSING_INPUT refusal (HTTP 400) rides structuredContent as status "partial" and validates', async () => {
  const flatBody = { error: 'Provide ?q= (search), ?code= (lookup), or ?section= (browse).' };
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => {
    const enveloped = /[?&]envelope=/.test(String(u));
    return new Response(JSON.stringify(enveloped ? RECORDED_12_PARTIAL : flatBody), { status: 400, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'envelope-12-partial-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools(); // callTool validates structuredContent on an error result too
    const res = await client.callTool({ name: 'hs_code_lookup', arguments: {} });
    assert.equal(res.isError, true);
    const sc = res.structuredContent as Record<string, unknown>;
    assert.equal(sc.status, 'partial');
    assert.deepEqual(sc.missing_inputs, ['q']);
    assert.equal((sc.edition as { name: string }).name, 'HS 2022');
    // The text channel keeps the flat error bytes it always had.
    const t = (res.content as Array<{ text?: string }>)[0].text ?? '';
    assert.equal(t, `Error: FreightUtils API error 400: ${JSON.stringify(flatBody)}`);
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
});

test('a refusal body that is not a valid envelope adds no structuredContent (the error text stays readable)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ...RECORDED_12_PARTIAL, status: 'maybe' }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'envelope-12-bad-refusal-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools();
    const res = await client.callTool({ name: 'hs_code_lookup', arguments: {} });
    assert.equal(res.isError, true);
    assert.equal(res.structuredContent, undefined);
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
});

test('an unknown status value is still refused (the schema stays strict)', async () => {
  // The server validates its own output before sending it, so the refusal arrives as isError
  // with the -32602 text rather than as a client-side throw.
  const res = await callCbmWith({ ...RECORDED_11, envelope_version: '1.2', status: 'maybe', as_of: '2026-10-29' });
  assert.equal(res.isError, true);
  const text = (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join(' ');
  assert.match(text, /-32602[\s\S]*at status/);
});
