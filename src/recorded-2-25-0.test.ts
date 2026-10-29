/**
 * 2.25.0: production answers recorded on 2026-10-29 (test-fixtures/recorded-2.25.0.json, keyed,
 * envelope 1.2) driven through the real server and the SDK's validating Client — one ok answer, one
 * partial refusal, one batch, one receipt-bearing check, and one adr_lookup compact answer with the
 * de-duplicated resolved_codes (UN 1263: six rows, each code once with the rows that carry it).
 * The keyed check_id is replaced in the fixture by a synthetic id of the same shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

type Recorded = { request: string; status: number; body: Record<string, unknown> };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.25.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;

/** Answer every request with the recorded body (and its recorded status); collect the URLs sent. */
async function call(rec: Recorded, name: string, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    urls.push(String(u));
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.25.0-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools(); // callTool validates structuredContent against the listed outputSchema
    const res = await client.callTool({ name, arguments: args });
    return { res, sc: res.structuredContent as Record<string, unknown> & { result: Record<string, unknown> }, urls };
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}

test('recorded ok: cbm_calculator', async () => {
  const { res, sc } = await call(FX.ok_cbm, 'cbm_calculator', { length_cm: 120, width_cm: 80, height_cm: 100, pieces: 2 });
  assert.notEqual(res.isError, true);
  assert.equal(sc.envelope_version, '1.2');
  assert.equal(sc.status, 'ok');
  assert.equal(sc.result.total_cbm, 1.92);
});

test('recorded partial: hs_code_lookup with no input rides structuredContent and validates', async () => {
  const { res, sc } = await call(FX.partial_hs, 'hs_code_lookup', {});
  assert.equal(res.isError, true);
  assert.equal(sc.status, 'partial');
  assert.deepEqual(sc.missing_inputs, ['q']);
});

test('recorded batch: unlocode_lookup codes[] — results[] in input order, each with its own status', async () => {
  const { res, sc, urls } = await call(FX.batch_unlocode, 'unlocode_lookup', { codes: ['NLRTM', 'GBFXT', 'XXZZZ'] });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(new URL(urls[0]).searchParams.get('codes'), 'NLRTM,GBFXT,XXZZZ');
  const results = sc.result.results as Array<{ index: number; input: string; status: string }>;
  assert.deepEqual(results.map((r) => r.input), ['NLRTM', 'GBFXT', 'XXZZZ']);
  assert.equal(results[0].status, 'ok');
  assert.notEqual(results[2].status, 'ok', 'XXZZZ is not a UN/LOCODE');
  assert.equal(sc.result.status, 'partial');
});

test('recorded receipt: adr_exemption_calculator carries _meta.check_id / receipt_url and the edition', async () => {
  const { res, sc } = await call(FX.receipt_adr_calc, 'adr_exemption_calculator', { un_number: '1203', quantity: 200, unit: 'L' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const meta = sc._meta as { check_id: string; receipt_url: string };
  assert.match(meta.check_id, /^chk_[A-Za-z0-9_-]{22}$/);
  assert.equal(meta.receipt_url, `https://www.freightutils.com/api/receipts/${meta.check_id}`);
  assert.equal((sc.edition as { name: string }).name, 'ADR 2025');
  assert.equal(sc.result.verdict_basis, 'all_items');
  assert.equal(sc.result.exempt, true);
});

test('recorded adr_lookup compact: resolved_codes once per answer, rows name the results[] that carry each code', async () => {
  const { res, sc, urls } = await call(FX.adr_compact_multi, 'adr_lookup', { un_number: '1263' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(new URL(urls[0]).searchParams.has('include_codes'), false, 'the API default (compact) applies');
  const results = sc.result.results as Array<Record<string, unknown>>;
  const codes = sc.result.resolved_codes as Array<{ code: string; family: string; rows: number[]; url?: string }>;
  assert.ok(results.length > 1);
  assert.ok(results.every((r) => !('resolved_codes' in r)), 'never on a row');
  const keys = codes.map((c) => `${c.family}:${c.code}`);
  assert.equal(new Set(keys).size, keys.length, 'each code once');
  assert.ok(codes.some((c) => c.rows.length === results.length), 'a code every row carries is listed once with all rows');
  assert.ok(codes.every((c) => c.rows.every((i) => i >= 0 && i < results.length)));
  assert.ok(codes.every((c) => c.url === undefined), 'compact leaves out url');
});
