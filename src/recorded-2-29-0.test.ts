/**
 * 2.29.0: adr_consignment_check — answers of the website's POST /api/adr/consignment-check recorded on
 * its build-2a preview (test-fixtures/recorded-2.29.0.json, keyed, envelope 1.2; check_ids synthetic), driven
 * through the real server and the SDK's validating Client, and parsed through the TYPED branch of the tool's
 * result schema (resultShape falls back to a plain record, so only the typed branch proves a field is typed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toJSONSchema, type z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';
import { SCOPE_TOOLS } from './scopes.js';

type Recorded = { request: string; status: number; body: Record<string, unknown> };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.29.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;
const NAME = 'adr_consignment_check';
const bodyOf = (rec: Recorded) => JSON.parse(rec.request.slice(rec.request.indexOf(' {') + 1)) as Record<string, unknown>;

async function call(rec: Recorded, args: Record<string, unknown>, name: string = NAME) {
  const real = globalThis.fetch;
  const sent: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    sent.push({ url: String(u), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.29.0-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools();
    const res = await client.callTool({ name, arguments: args });
    return { res, sc: res.structuredContent as Record<string, unknown> & { result: Record<string, unknown> }, sent };
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}

function typed(name: string = NAME): z.ZodTypeAny {
  const t = ALL_TOOLS.find((x) => x.name === name);
  assert.ok(t?.resultSchema);
  const u = t.resultSchema as unknown as { options?: z.ZodTypeAny[]; def?: { options?: z.ZodTypeAny[] } };
  const opts = u.options ?? u.def?.options;
  assert.ok(opts && opts.length === 2);
  return opts[0];
}
function parsesTyped(result: unknown, name: string = NAME) {
  const r = typed(name).safeParse(result);
  assert.ok(r.success, `typed branch refused: ${JSON.stringify(r.error?.issues ?? null).slice(0, 600)}`);
}
type Check = { name: string; verdict: string; citations: Array<{ section: string; pdf_page?: unknown }> };

test('2.29.0: adr_consignment_check is registered, strict, in scope dg and the default', async () => {
  const t = ALL_TOOLS.find((x) => x.name === NAME);
  assert.ok(t, 'registered');
  assert.equal(t.strictKeys, true);
  assert.ok(SCOPE_TOOLS.dg.includes(NAME));
  // Since 2.32.0 (build 2d) no check is not_in_this_version: the description names the packaging mark instead.
  assert.match(t.description, /the UN packaging mark of each line \(6\.1\.3\.1\)/);
  // Since 2.30.0 (build 2b) mixed loading is checked; recorded-2-30-0.test.ts asserts its Limitations.
  // 2.34.3 (run TW1): the answer's field names are the output schema's, not description prose.
  assert.match(JSON.stringify(toJSONSchema(t.resultSchema)), /packaging_code_validity/); // since 2.32.0 the packaging mark is checked (build 2d)
});

test('recorded: the exempt petrol load — pass, 900 points, the document entries, the POST and its body', async () => {
  const rec = FX.check_exempt_un1203_300l;
  const args = bodyOf(rec);
  const { res, sc, sent } = await call(rec, args);
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(sent[0].method, 'POST');
  assert.match(sent[0].url, /\/adr\/consignment-check\?envelope=1\.2/);
  assert.deepEqual((sent[0].body as { lines: unknown }).lines, args.lines);
  const r = sc.result;
  assert.equal(r.status, 'pass');
  assert.equal((r.exemption_1_1_3_6 as { engine: { total_points: number } }).engine.total_points, 900);
  assert.ok(((r.transport_document as { lines: Array<{ strings: string[] }> }).lines[0].strings).includes('UN 1203 PETROL, 3, II, (D/E)'));
  assert.match(String((sc._meta as { check_id?: string } | undefined)?.check_id), /^chk_[A-Za-z0-9_-]{22}$/);
  const checks = r.checks_performed as Check[];
  for (const c of checks.filter((x) => x.verdict !== 'not_in_this_version')) assert.ok(c.citations.length > 0, `${c.name} cites`);
  assert.deepEqual(checks.filter((x) => x.verdict === 'not_in_this_version').map((x) => x.name), ['mixed_loading_7_5_2', 'placards_and_plates_5_3', 'equipment_8_1', 'driver_training_8_2', 'packaging_code_validity']);
  parsesTyped(r);
});

test('recorded: a mixed load over 1 000 points fails, the UN 1098 entry is ADR\'s own example', async () => {
  const rec = FX.check_mixed_over_1000_fail;
  const { sc } = await call(rec, bodyOf(rec));
  assert.equal(sc.result.status, 'fail');
  assert.equal((sc.result.transport_document as { lines: Array<{ strings: string[] }> }).lines[1].strings[0], 'UN 1098 ALLYL ALCOHOL, 6.1 (3), I, (C/D)');
  parsesTyped(sc.result);
});

test('recorded: ADR 2027 UN 1005 25 kg on 2027-02-01 — conditional on 1.6.1.61, edition ADR 2027', async () => {
  const rec = FX.check_2027_un1005_conditional_1_6_1_61;
  const args = bodyOf(rec);
  const { sc, sent } = await call(rec, args);
  assert.equal((sent[0].body as { edition: string }).edition, '2027');
  assert.equal(sc.result.status, 'conditional');
  assert.equal((sc.result.exemption_1_1_3_6 as { engine: { basis: string } }).engine.basis, '1.6.1.61');
  assert.equal((sc.edition as { name: string }).name, 'ADR 2027');
  parsesTyped(sc.result);
});

test('recorded: the whole-load code (C/D) forbids the D tunnel; with the 1.1.3.6 relief the E tunnel is conditional', async () => {
  const no = FX.check_tunnel_whole_load_c_d_fail;
  const { sc } = await call(no, bodyOf(no));
  const t = sc.result.tunnel_restriction as { verdict: string; whole_load: { codes: string[] }; route: { without_1_1_3_6_relief: { forbidden_on_route: string[] } } };
  assert.equal(t.verdict, 'fail');
  assert.deepEqual(t.whole_load.codes, ['(C/D)']);
  assert.deepEqual(t.route.without_1_1_3_6_relief.forbidden_on_route, ['D']);
  parsesTyped(sc.result);
  const yes = FX.check_tunnel_relief_conditional;
  const r2 = await call(yes, bodyOf(yes));
  assert.equal(r2.sc.result.status, 'conditional');
  assert.equal(((r2.sc.result.tunnel_restriction as { route: { with_1_1_3_6_relief: { applies: boolean } } }).route.with_1_1_3_6_relief.applies), true);
  parsesTyped(r2.sc.result);
});

test('recorded: an ID line without the ICAO statement — insufficient_data, envelope partial, missing input by path', async () => {
  const rec = FX.check_id8000_without_statement_insufficient;
  const { sc } = await call(rec, bodyOf(rec));
  assert.equal(sc.result.status, 'insufficient_data');
  assert.equal(sc.status, 'partial');
  assert.deepEqual(sc.missing_inputs, ['lines[0].icao_limited_quantity']);
  parsesTyped(sc.result);
});

test('recorded: an inner packaging over the LQ limit fails the LQ check', async () => {
  const rec = FX.check_lq_inner_over_limit_fail;
  const { sc } = await call(rec, bodyOf(rec));
  assert.equal(sc.result.status, 'fail');
  assert.equal((sc.result.limited_quantities as { verdict: string }).verdict, 'fail');
  parsesTyped(sc.result);
});

test('recorded: an all-zero load is a 400 refusal, surfaced as a tool error with the envelope', async () => {
  const rec = FX.check_all_zero_400;
  assert.equal(rec.status, 400);
  const { res } = await call(rec, bodyOf(rec));
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /quantity 0/);
});

test('input: an unknown key and an ID line with a bad pattern are refused before any call', async () => {
  const rec = FX.check_exempt_un1203_300l;
  const a = await call(rec, { ...bodyOf(rec), items: [] });
  assert.equal(a.res.isError, true);
  assert.equal(a.sent.length, 0);
  const b = await call(rec, { lines: [{ un_number: 'X1203', quantity: { value: 1, unit: 'L' } }] });
  assert.equal(b.res.isError, true);
  assert.equal(b.sent.length, 0);
});

// 2.29.0: the T2b-3 calculator fields (website #332), typed — cc-032, an entry deleted in ADR 2027.
test('recorded: cc-032 — UN 2941 on ADR 2027, as_of 2027-03-15: exempt 300 on 1.6.1.1, entry_deleted, edition_basis "2025", typed', async () => {
  const rec = FX.calc_cc032_un2941_2027_entry_deleted_asof_20270315;
  const args = bodyOf(rec);
  const { res, sc, sent } = await call(rec, args, 'adr_exemption_calculator');
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal((sent[0].body as { edition: string }).edition, '2027');
  assert.equal((sent[0].body as { as_of: string }).as_of, '2027-03-15');
  const r = sc.result as { exempt: boolean; total_points: number; basis: string; basis_until: string; strict_adr_2027: Record<string, unknown>; items: Array<{ edition_basis: string; state: string }> };
  assert.equal(r.exempt, true);
  assert.equal(r.total_points, 300);
  assert.equal(r.basis, '1.6.1.1');
  assert.equal(r.basis_until, '2027-06-30');
  assert.equal(r.strict_adr_2027.entry_deleted, true);
  assert.deepEqual(r.strict_adr_2027.deleted_un_numbers, ['2941']);
  assert.equal(r.strict_adr_2027.exempt, null);
  assert.equal(r.strict_adr_2027.total_points, null);
  assert.match(String(r.strict_adr_2027.message), /UN 2941/);
  assert.deepEqual(r.items.map((i) => i.edition_basis), ['2025']);
  assert.equal(r.items[0].state, 'COUNTED');
  parsesTyped(r, 'adr_exemption_calculator');
});

test('typed branch: entry_deleted must be a boolean and edition_basis one of the two editions', () => {
  const r = FX.calc_cc032_un2941_2027_entry_deleted_asof_20270315.body.result as Record<string, unknown>;
  const t = typed('adr_exemption_calculator');
  const badFlag = JSON.parse(JSON.stringify(r)); badFlag.strict_adr_2027.entry_deleted = 'yes';
  assert.equal(t.safeParse(badFlag).success, false);
  const badEd = JSON.parse(JSON.stringify(r)); badEd.items[0].edition_basis = '2023';
  assert.equal(t.safeParse(badEd).success, false);
});

test('description: adr_exemption_calculator names entry_deleted, deleted_un_numbers and edition_basis (no long-form 2027 date for them)', () => {
  // 2.34.3 (run TW1): these are answer fields — the typed output schema documents them, not the description.
  const out = JSON.stringify(toJSONSchema(ALL_TOOLS.find((x) => x.name === 'adr_exemption_calculator')!.resultSchema));
  for (const w of ['entry_deleted', 'deleted_un_numbers', 'edition_basis']) assert.ok(out.includes(w), w);
});
