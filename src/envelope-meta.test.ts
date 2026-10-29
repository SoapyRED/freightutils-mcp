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

test('an unknown status value is still refused (the schema stays strict)', async () => {
  // The server validates its own output before sending it, so the refusal arrives as isError
  // with the -32602 text rather than as a client-side throw.
  const res = await callCbmWith({ ...RECORDED_11, envelope_version: '1.2', status: 'maybe', as_of: '2026-10-29' });
  assert.equal(res.isError, true);
  const text = (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join(' ');
  assert.match(text, /-32602[\s\S]*at status/);
});
