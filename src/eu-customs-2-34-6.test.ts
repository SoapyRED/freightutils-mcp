/**
 * 2.34.6: eu_tariff_lookup, eu_duty_calculator and code_list_lookup join the package with the hosted server's
 * definitions (freightutils.com runs CU2 and CL1), and get_subscribe_link leaves the list (freightutils.com #430).
 *
 * Definition: the name, title, annotations and input keys are the hosted ones; the list order puts the three after
 * adr_consignment_check. Argument mapping: each call is the REST request the hosted tool's answer is built from
 * (GET /api/eu-tariff, POST /api/eu-duty with envelope alone in its query string, GET /api/codes/<list>). Answers:
 * production answers recorded by run REL3 (test-fixtures/recorded-2.34.6.json, keyless, 23 Nov 2026) are driven
 * through the real server and the SDK's validating Client — structuredContent is the REST envelope itself, a refusal
 * rides structuredContent and the error text names the missing field.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';

type Rec = Record<string, unknown>;
type Recorded = { tool: string; args: Rec; request: string; status: number; body: Rec };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.34.6.json', import.meta.url), 'utf8')) as Record<string, Recorded>;
const NEW = ['eu_tariff_lookup', 'eu_duty_calculator', 'code_list_lookup'];

type Sent = { url: string; method: string; body?: unknown };

async function withClient<T>(body: Rec, status: number, run: (c: Client, sent: Sent[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'eu-customs-2.34.6-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    return await run(client, sent);
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}
type Res = { isError?: boolean; structuredContent?: Rec; content?: { type: string; text: string }[] };
const call = (name: string, args: Rec, body: Rec = {}, status = 200) =>
  withClient(body, status, async (c, sent) => ({ res: await c.callTool({ name, arguments: args }) as Res, sent }));

test('2.34.6: the three tools are listed after adr_consignment_check, with the hosted titles and annotations', async () => {
  const names = ALL_TOOLS.map((t) => t.name);
  assert.equal(names.length, 28);
  assert.deepEqual(names.slice(-4), ['adr_consignment_check', ...NEW]);
  const listed = await withClient({}, 200, (c) => c.listTools());
  const titles: Record<string, string> = { eu_tariff_lookup: 'EU Tariff Lookup (TARIC)', eu_duty_calculator: 'EU Duty Calculator (TARIC)', code_list_lookup: 'Code List Lookup' };
  for (const name of NEW) {
    const t = listed.tools.find((x) => x.name === name);
    assert.ok(t, `${name} is not listed`);
    assert.equal(t.title, titles[name]);
    assert.deepEqual(t.annotations, { title: titles[name], readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal((t.inputSchema as Rec).additionalProperties, false, `${name}: unknown fields refused`);
    assert.deepEqual((t.inputSchema as Rec).required, undefined, `${name}: every input optional, as hosted`);
  }
  assert.deepEqual(Object.keys(listed.tools.find((x) => x.name === 'eu_duty_calculator')!.inputSchema.properties ?? {}), ['code', 'as_of', 'origin', 'customs_value', 'currency', 'quantities']);
  assert.deepEqual(Object.keys(listed.tools.find((x) => x.name === 'code_list_lookup')!.inputSchema.properties ?? {}), ['list', 'code', 'q', 'full', 'offset', 'limit', 'include_deprecated']);
  // Tools from before 2.34.6 keep their definitions: no top-level title appears on them.
  for (const t of listed.tools) if (!NEW.includes(t.name)) assert.equal(t.title, undefined, `${t.name} gained a title`);
});

test('2.34.6: get_subscribe_link is not listed, and a call to it is the unknown-tool error', async () => {
  assert.equal(ALL_TOOLS.some((t) => t.name === 'get_subscribe_link'), false);
  const { res, sent } = await call('get_subscribe_link', {});
  assert.equal(res.isError, true);
  assert.match(res.content?.[0]?.text ?? '', /Tool get_subscribe_link not found/);
  assert.equal(sent.length, 0, 'nothing is sent');
});

test('eu_tariff_lookup: GET /api/eu-tariff with the fields as sent; the recorded answer is structuredContent', async () => {
  const r = FX.eu_tariff_lookup_6305331000;
  const { res, sent } = await call('eu_tariff_lookup', { ...r.args, origin: 'US', direction: 'import' }, r.body);
  const u = new URL(sent[0].url);
  assert.equal(sent[0].method, 'GET');
  assert.equal(u.pathname, '/api/eu-tariff');
  assert.deepEqual(Object.fromEntries(u.searchParams), { code: '6305331000', as_of: '2026-11-01', origin: 'US', direction: 'import', envelope: '1.2', legacy_source: '1' });
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, r.body);
  const result = r.body.result as Rec & { measures: { measure_type: { code: string }; duty: { source: string }; legal_base: string }[] };
  const tcd = result.measures.find((m) => m.measure_type.code === '103');
  assert.equal(tcd?.duty.source, '12.000 %');
  assert.equal(tcd?.legal_base, 'Regulation 2448/95');
});

test('eu_duty_calculator: POST /api/eu-duty, envelope alone in the query string, the inputs as the JSON body', async () => {
  const r = FX.eu_duty_calculator_6305331000_us;
  const { res, sent } = await call('eu_duty_calculator', { ...r.args, quantities: { DTN: 12.5 } }, r.body);
  assert.equal(sent[0].method, 'POST');
  assert.equal(new URL(sent[0].url).pathname, '/api/eu-duty');
  assert.equal(new URL(sent[0].url).search, '?envelope=1.2', 'the route refuses any other query parameter');
  assert.deepEqual(sent[0].body, { code: '6305331000', as_of: '2026-11-01', origin: 'US', customs_value: 1000, quantities: { DTN: 12.5 } });
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, r.body);
  const tcd = (r.body.result as Rec).third_country_duty as Rec;
  assert.equal(tcd.state, 'computed');
  assert.equal(tcd.amount_eur, 120);
  // customs_value as text is passed on as sent — REST reads it, as the hosted tool's schema allows.
  const asText = await call('eu_duty_calculator', { ...r.args, customs_value: '1000' }, r.body);
  assert.equal((asText.sent[0].body as Rec).customs_value, '1000');
});

test('code_list_lookup: GET /api/codes/<list>; without list, the index of lists (each other field refused there by name)', async () => {
  const r = FX.code_list_lookup_imports_4000;
  const { res, sent } = await call('code_list_lookup', r.args, r.body);
  const u = new URL(sent[0].url);
  assert.equal(u.pathname, '/api/codes/cds-procedure-codes-imports');
  assert.deepEqual(Object.fromEntries(u.searchParams), { code: '4000', envelope: '1.2', legacy_source: '1' });
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, r.body);
  assert.equal(((r.body.result as Rec).record as Rec).name, 'Release to free circulation');

  const paged = await call('code_list_lookup', { list: 'cds-procedure-codes-imports', q: 'release', full: true, offset: 5, limit: 10, include_deprecated: false }, r.body);
  assert.deepEqual(Object.fromEntries(new URL(paged.sent[0].url).searchParams), { q: 'release', full: 'true', offset: '5', limit: '10', include_deprecated: 'false', envelope: '1.2', legacy_source: '1' });

  const index = await call('code_list_lookup', {}, r.body);
  assert.equal(new URL(index.sent[0].url).pathname, '/api/codes');
  const stray = await call('code_list_lookup', { code: '4000' }, r.body);
  assert.equal(new URL(stray.sent[0].url).pathname, '/api/codes');
  assert.equal(new URL(stray.sent[0].url).searchParams.get('code'), '4000', 'sent on, so the index refuses it by name');
});

test('a refusal (recorded: eu_tariff_lookup without as_of) is a tool error with its envelope as structuredContent', async () => {
  const r = FX.eu_tariff_lookup_missing_as_of;
  assert.equal(r.status, 400);
  const { res } = await call('eu_tariff_lookup', r.args, r.body, r.status);
  assert.equal(res.isError, true);
  assert.deepEqual(res.structuredContent, r.body);
  assert.deepEqual((res.structuredContent as Rec).missing_inputs, ['as_of']);
  assert.match(res.content?.[0]?.text ?? '', /as_of/);
});

test('an unknown field is refused by name before any call, on each of the three', async () => {
  for (const name of NEW) {
    const { res, sent } = await call(name, { colour: 'red' });
    assert.equal(res.isError, true, name);
    assert.match(res.content?.[0]?.text ?? '', /Unknown field "colour"/, name);
    assert.equal(sent.length, 0, `${name}: nothing sent`);
  }
});
