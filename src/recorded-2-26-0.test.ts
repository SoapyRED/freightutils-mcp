/**
 * 2.26.0: production answers recorded on 2026-10-30 (test-fixtures/recorded-2.26.0.json, keyed,
 * envelope 1.2) driven through the real server and the SDK's validating Client — an adr_lookup on
 * edition "2027" (UN 2956: LQ "0"), a keyed 2027 exemption check with transitional_1_6_1_61 beside
 * the verdict and its check_id (UN 1005, 25 kg), and an as_of answer carrying EDITION_TRANSITIONAL.
 * The keyed check_id is replaced in the fixture by a synthetic id of the same shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

type Recorded = { request: string; status: number; body: Record<string, unknown> };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.26.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;

/** Answer every request with the recorded body (and its recorded status); collect the URLs sent. */
async function call(rec: Recorded, name: string, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    urls.push(String(u));
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.26.0-test', version: '1' });
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

const codes = (sc: Record<string, unknown>) => ((sc.warnings ?? []) as Array<{ code: string }>).map((w) => w.code);

test('recorded edition "2027": adr_lookup UN 2956 — LQ "0", adr_edition 2027, not yet applicable today', async () => {
  const { res, sc, urls } = await call(FX.adr_lookup_2027_un2956, 'adr_lookup', { un_number: '2956', edition: '2027' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(new URL(urls[0]).searchParams.get('edition'), '2027', 'forwarded unchanged');
  assert.equal(sc.status, 'ok');
  const results = sc.result.results as Array<{ un_number: string; limited_quantity: string }>;
  assert.equal(results[0].un_number, '2956');
  assert.equal(results[0].limited_quantity, '0');
  assert.equal((sc.result.adr_edition as { edition: string }).edition, '2027');
  assert.equal((sc.edition as { name: string }).name, 'ADR 2027');
  assert.ok(codes(sc).includes('EDITION_NOT_YET_APPLICABLE'));
});

test('recorded edition "2027": adr_exemption_calculator UN 1005 25 kg — not exempt, transitional_1_6_1_61 beside the verdict, keyed check_id', async () => {
  const { res, sc, urls } = await call(FX.calc_2027_un1005_25kg, 'adr_exemption_calculator', { un_number: '1005', quantity: 25, edition: '2027' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(new URL(urls[0]).searchParams.get('edition'), '2027');
  assert.equal(sc.result.total_points, 1250);
  assert.equal(sc.result.exempt, false, 'the ADR 2027 verdict');
  const t = sc.result.transitional_1_6_1_61 as { measure: string; points_on_this_basis: number; exempt_on_this_basis: boolean; until: string };
  assert.equal(t.measure, '1.6.1.61');
  assert.equal(t.points_on_this_basis, 500);
  assert.equal(t.exempt_on_this_basis, true);
  assert.equal(t.until, '2030-12-31');
  const meta = sc._meta as { check_id: string; receipt_url: string; receipt?: unknown };
  assert.match(meta.check_id, /^chk_[A-Za-z0-9_-]{22}$/);
  assert.equal(meta.receipt_url, `https://www.freightutils.com/api/receipts/${meta.check_id}`);
  assert.equal(meta.receipt, undefined, 'a keyed answer is stored, so it carries no inline receipt');
});

test('recorded as_of: adr_lookup UN 1203 as_of 2027-01-15 — ADR 2027 by the timeline, EDITION_TRANSITIONAL', async () => {
  const { res, sc, urls } = await call(FX.adr_lookup_as_of_transitional, 'adr_lookup', { un_number: '1203', as_of: '2027-01-15' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get('as_of'), '2027-01-15');
  assert.equal(u.searchParams.has('edition'), false, 'nothing sent, nothing forwarded');
  assert.equal(sc.as_of, '2027-01-15');
  assert.equal((sc.result.adr_edition as { selected_by: string }).selected_by, 'as_of');
  assert.ok(codes(sc).includes('EDITION_TRANSITIONAL'));
});
