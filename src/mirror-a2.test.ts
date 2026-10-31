/**
 * 2.27.0 (pending): the npm mirror of freightutils.com Run A2. Production answers recorded on 2026-10-31
 * (test-fixtures/recorded-2.27.0.json, keyed, envelope 1.2) driven through the real server and the SDK's
 * validating Client, so every additive field must pass the outputSchema:
 *  - airline_lookup: prefix_shared + prefix_holders, operational_status + basis, restrictions[];
 *  - nearest_airport: include_all forwarded, distance_basis and filter on the answer, the refreshed
 *    airport fields (scheduled_service, iso_region, gps_code, keywords);
 *  - validate: failure.reason on a hit, details.airline_failure on an unknown prefix;
 *  - resolve_reference: validation and failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

type Recorded = { request: string; status: number; body: Record<string, unknown> };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.27.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;

async function call(rec: Recorded, name: string, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    urls.push(String(u));
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'mirror-a2-test', version: '1' });
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

type Row = Record<string, unknown>;

test('airline_lookup prefix 081: prefix_shared true, four prefix_holders, verified first', async () => {
  const { res, sc } = await call(FX.airline_prefix_081, 'airline_lookup', { prefix: '081' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const rows = sc.result.results as Row[];
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.prefix_shared, true);
  assert.deepEqual(rows[0].prefix_holders, ['qantas', 'eastern-australia-airlines', 'qantaslink', 'sunstate-airlines']);
});

test('airline_lookup ICAO IRA: the EU Air Safety List entry (Annex B) and the UK entry, typed', async () => {
  const { res, sc } = await call(FX.airline_icao_ira, 'airline_lookup', { icao: 'IRA' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const r = (sc.result.results as Row[])[0];
  const list = r.restrictions as Row[];
  assert.equal(list[0].list, 'eu_air_safety_list');
  assert.equal(list[0].annex, 'B');
  assert.equal(list[0].regulation, 'Commission Implementing Regulation (EU) 2026/1317');
  assert.equal(list[0].match_basis, 'icao_designator');
  assert.equal(list[1].list, 'uk_air_safety_list');
});

test('airline_lookup ICAO ADR: ceased, on the carrier\'s own page', async () => {
  const { res, sc } = await call(FX.airline_icao_adr, 'airline_lookup', { icao: 'ADR' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const r = (sc.result.results as Row[])[0];
  assert.equal(r.operational_status, 'ceased');
  assert.equal(r.operational_status_basis, 'carrier_published');
  assert.equal(r.status, 'historical', 'the verification ladder is a different thing and does not move');
});

test('nearest_airport default: LHR first, distance_basis great_circle, filter scheduled_iata; include_all not sent', async () => {
  const { res, sc, urls } = await call(FX.nearest_default_heathrow, 'nearest_airport', { latitude: 51.47, longitude: -0.46, max_results: 3 });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(new URL(urls[0]).searchParams.has('include_all'), false, 'nothing sent, nothing forwarded');
  assert.equal(sc.result.distance_basis, 'great_circle');
  assert.equal(sc.result.filter, 'scheduled_iata');
  const rows = sc.result.results as Row[];
  assert.equal(rows[0].iata_code, 'LHR');
  assert.equal(rows[0].scheduled_service, true);
  assert.equal(typeof rows[0].iso_region, 'string');
});

test('nearest_airport include_all: forwarded as include_all=true; the strip is listed', async () => {
  const { res, sc, urls } = await call(FX.nearest_include_all_uluru, 'nearest_airport', { latitude: -25, longitude: 131, max_results: 2, include_all: true });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(new URL(urls[0]).searchParams.get('include_all'), 'true');
  assert.equal(sc.result.filter, 'all');
  assert.equal((sc.result.results as Row[])[1].ident, 'YCSP');
});

test('validate: a wrong AWB check digit carries failure.reason INVALID_CHECK_DIGIT', async () => {
  const { res, sc } = await call(FX.validate_awb_bad_check_digit, 'validate', { value: '176-12345676', type: 'awb' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const hit = (sc.result.found as Row[])[0];
  assert.equal(hit.valid, false);
  assert.equal((hit.failure as Row).reason, 'INVALID_CHECK_DIGIT');
  assert.equal((hit.failure as Row).example, '020-58717481');
});

test('validate: a prefix no record holds — valid stays true, details.airline_failure UNKNOWN_PREFIX', async () => {
  const { res, sc } = await call(FX.validate_awb_unknown_prefix, 'validate', { value: '998-12345675', type: 'awb' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const hit = (sc.result.found as Row[])[0];
  assert.equal(hit.valid, true);
  assert.equal(hit.failure, undefined);
  assert.equal(((hit.details as Row).airline_failure as Row).reason, 'UNKNOWN_PREFIX');
});

test('resolve_reference: an invalid AWB still names its carrier, with validation.failure', async () => {
  const { res, sc } = await call(FX.resolve_awb_bad_check_digit, 'resolve_reference', { q: '176-12345676' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  const v = sc.result.validation as Row;
  assert.equal(v.type, 'awb');
  assert.equal(v.valid, false);
  assert.equal((v.failure as Row).reason, 'INVALID_CHECK_DIGIT');
  assert.match(String((sc.result.candidates as Row[])[0].summary), /Emirates/);
});

test('resolve_reference: no grammar matched — failure.reason NO_MATCH', async () => {
  const { res, sc } = await call(FX.resolve_no_match, 'resolve_reference', { q: 'QQQQQQQQQQQQ' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(sc.result.count, 0);
  assert.equal((sc.result.failure as Row).reason, 'NO_MATCH');
});
