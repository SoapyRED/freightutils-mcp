/**
 * 2.28.0: production answers recorded on 2026-11-04 (test-fixtures/recorded-2.28.0.json, keyed, envelope 1.2)
 * for the website's calculator changes of 4 Nov (#328) and the registry's owner_reviewed codes (#329), driven
 * through the real server and the SDK's validating Client. Each result is also parsed through the TYPED branch
 * of the tool's result schema — resultShape() falls back to a plain record, so only the typed branch proves a
 * field is typed (EXCLUDED_NIL, basis, owner_reviewed …). Keyed check_ids are replaced by synthetic ids.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toJSONSchema, type z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';

type Recorded = { request: string; status: number; body: Record<string, unknown> };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.28.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;
const FX_OLD = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.26.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;

/** Answer every request with the recorded body; collect each request's URL, method and body. */
async function call(rec: Recorded, name: string, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const sent: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    sent.push({ url: String(u), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.28.0-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools(); // callTool validates structuredContent against the listed outputSchema
    const res = await client.callTool({ name, arguments: args });
    return { res, sc: res.structuredContent as Record<string, unknown> & { result: Record<string, unknown> }, sent };
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}

/** The typed branch of a tool's result schema (resultShape = typed.or(record)). */
function typed(toolName: string): z.ZodTypeAny {
  const t = ALL_TOOLS.find((x) => x.name === toolName);
  assert.ok(t?.resultSchema, toolName);
  const u = t.resultSchema as unknown as { options?: z.ZodTypeAny[]; def?: { options?: z.ZodTypeAny[] } };
  const opts = u.options ?? u.def?.options;
  assert.ok(opts && opts.length === 2, 'resultShape is a two-branch union');
  return opts[0];
}
function parsesTyped(toolName: string, result: unknown) {
  const r = typed(toolName).safeParse(result);
  assert.ok(r.success, `typed branch refused: ${JSON.stringify(r.error?.issues ?? null).slice(0, 600)}`);
}

type Item = { un_number: string; state: string; entry_required?: boolean; icao_limited_quantity?: boolean; nil_quantity?: boolean; upper_bound_gross?: boolean; air_only_id?: boolean };

test('cc-029: ADR 2027 UN 1005 25 kg on a stated as_of 2027-02-01 — the 1.6.1.61 basis headlined, strict ADR 2027 beside it', async () => {
  const rec = FX.calc_cc029_2027_un1005_25kg_asof_20270201;
  const { res, sc, sent } = await call(rec, 'adr_exemption_calculator', { items: [{ un_number: '1005', quantity: 25, unit: 'kg', basis: 'net' }], edition: '2027', as_of: '2027-02-01' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual((sent[0].body as { as_of: string }).as_of, '2027-02-01');
  const r = sc.result;
  assert.equal(r.exempt, true);
  assert.equal(r.basis, '1.6.1.61');
  assert.equal(r.basis_until, '2030-12-31');
  assert.deepEqual(r.strict_adr_2027, { basis: 'adr_2027', total_points: 1250, exempt: false, has_category_zero: false, has_quantity_exceedance: true });
  assert.equal((r.transitional_1_6_1_1 as { measure: string; exempt_on_this_basis: boolean }).measure, '1.6.1.1');
  assert.equal((r.transitional_1_6_1_61 as { measure: string }).measure, '1.6.1.61');
  parsesTyped('adr_exemption_calculator', r);
});

test('cc-036: ID 8000 without the ICAO limited-quantity statement is BLOCKED (entry_required), no verdict', async () => {
  const rec = FX.calc_cc036_id8000_without_statement;
  const { res, sc, sent } = await call(rec, 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 100, unit: 'L', basis: 'net' }, { un_number: 'ID8000', quantity: 50, unit: 'kg' }], edition: '2025', as_of: '2026-12-10' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal('icao_limited_quantity' in (sent[0].body as { items: object[] }).items[1], false, 'not sent, not invented');
  const items = sc.result.items as Item[];
  assert.equal(items[1].state, 'BLOCKED');
  assert.equal(items[1].entry_required, true);
  assert.equal(sc.result.exempt, null);
  parsesTyped('adr_exemption_calculator', sc.result);
});

test('cc-036: with icao_limited_quantity: true the stdio client forwards it and the ID line is AIR_ONLY_ID', async () => {
  const rec = FX.calc_cc036_id8000_with_statement;
  const { res, sc, sent } = await call(rec, 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 100, unit: 'L', basis: 'net' }, { un_number: 'ID8000', quantity: 50, unit: 'kg', icao_limited_quantity: true }], edition: '2025', as_of: '2026-12-10' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal((sent[0].body as { items: Array<{ icao_limited_quantity?: boolean }> }).items[1].icao_limited_quantity, true, 'forwarded to the API');
  const items = sc.result.items as Item[];
  assert.equal(items[1].state, 'AIR_ONLY_ID');
  assert.equal(items[1].icao_limited_quantity, true);
  assert.equal(sc.result.exempt, true);
  parsesTyped('adr_exemption_calculator', sc.result);
});

test('icao_limited_quantity on the single-substance form goes as a one-item POST (GET cannot carry it)', async () => {
  const rec = FX.calc_cc036_id8000_with_statement;
  const { sent } = await call(rec, 'adr_exemption_calculator', { un_number: 'ID8000', quantity: 50, unit: 'kg', icao_limited_quantity: true });
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual(sent[0].body, { items: [{ un_number: 'ID8000', quantity: 50, unit: 'kg', icao_limited_quantity: true }] });
});

test('icao_limited_quantity on a UN-numbered line: the API\'s 400 reaches the caller as a tool error', async () => {
  const rec = FX.calc_icao_lq_on_un_line_400;
  assert.equal(rec.status, 400);
  const { res } = await call(rec, 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 100, unit: 'L', icao_limited_quantity: true }] });
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /not an ID-prefixed line/);
});

test('cc-040: UN 3077 520 kg gross — exempt on the gross figure as an upper bound (figure_basis, upper_bound_gross)', async () => {
  const rec = FX.calc_cc040_un3077_520kg_gross;
  const { res, sc } = await call(rec, 'adr_exemption_calculator', { items: [{ un_number: '3077', quantity: 520, unit: 'kg', basis: 'gross' }], edition: '2025', as_of: '2026-12-15' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal(sc.result.exempt, true);
  assert.equal(sc.result.figure_basis, 'upper_bound_gross');
  assert.equal((sc.result.items as Item[])[0].upper_bound_gross, true);
  parsesTyped('adr_exemption_calculator', sc.result);
});

test('cc-042: UN 1223 at quantity 0 — accepted by the client, EXCLUDED_NIL, verdict on the rest', async () => {
  const rec = FX.calc_cc042_un1223_nil_line;
  const { res, sc, sent } = await call(rec, 'adr_exemption_calculator', { items: [{ un_number: '1203', quantity: 200, unit: 'L', basis: 'net' }, { un_number: '1223', quantity: 0, unit: 'L', basis: 'net' }], edition: '2025', as_of: '2026-12-16' });
  assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
  assert.equal((sent[0].body as { items: Array<{ quantity: number }> }).items[1].quantity, 0);
  const items = sc.result.items as Item[];
  assert.equal(items[1].state, 'EXCLUDED_NIL');
  assert.equal(items[1].nil_quantity, true);
  assert.equal(sc.result.exempt, true);
  parsesTyped('adr_exemption_calculator', sc.result);
});

test('the EXCLUDED_NIL state is typed: an unknown state fails the typed branch', () => {
  const r = FX.calc_cc042_un1223_nil_line.body.result as { items: Item[] };
  const bad = { ...r, items: r.items.map((it) => ({ ...it, state: 'SOMETHING_ELSE' })) };
  assert.equal(typed('adr_exemption_calculator').safeParse(bad).success, false);
});

for (const [key, code] of [['adr_lookup_un1003_p203_owner_reviewed', 'P203'], ['adr_lookup_un1098_p602_owner_reviewed', 'P602']] as const) {
  test(`registry: ${code} is served owner_reviewed through adr_lookup's resolved_codes and parses typed`, async () => {
    const rec = FX[key];
    const un = key.includes('1003') ? '1003' : '1098';
    const { res, sc } = await call(rec, 'adr_lookup', { un_number: un, include_codes: 'compact' });
    assert.notEqual(res.isError, true, JSON.stringify(res).slice(0, 300));
    const codes = sc.result.resolved_codes as Array<{ code: string; verification_status: string }>;
    assert.equal(codes.find((c) => c.code === code)?.verification_status, 'owner_reviewed');
    parsesTyped('adr_lookup', sc.result);
  });
}

test('an unknown verification_status fails the typed branch of adr_lookup', () => {
  const r = FX.adr_lookup_un1003_p203_owner_reviewed.body.result as { resolved_codes: Array<Record<string, unknown>> };
  const bad = { ...r, resolved_codes: r.resolved_codes.map((c) => ({ ...c, verification_status: 'approved' })) };
  assert.equal(typed('adr_lookup').safeParse(bad).success, false);
});

test('additive: the 2.26.0 recorded exemption answer still parses typed', () => {
  parsesTyped('adr_exemption_calculator', FX_OLD.calc_2027_un1005_25kg.body.result);
});

test('the description names the 2.28.0 fields in the API\'s words', () => {
  // 2.34.3 (run TW1): the answer's field names are the typed output schema's, not description prose; the
  // description keeps the input the call needs (icao_limited_quantity) and never says "in force".
  const t = ALL_TOOLS.find((x) => x.name === 'adr_exemption_calculator')!;
  const out = JSON.stringify(toJSONSchema(t.resultSchema));
  for (const w of ['EXCLUDED_NIL', 'entry_required', 'upper_bound_gross', 'figure_basis', 'strict_adr_2027', 'basis_until', 'transitional_1_6_1_1']) assert.ok(out.includes(w), w);
  assert.ok(t.description.includes('icao_limited_quantity'));
  assert.doesNotMatch(t.description, /in force/i);
  const a = JSON.stringify(toJSONSchema(ALL_TOOLS.find((x) => x.name === 'adr_lookup')!.resultSchema));
  for (const w of ['paraphrase_unreviewed', 'machine_reviewed', 'contested', 'owner_reviewed', 'dg_reviewed', 'needs_fix', 'verified']) assert.ok(a.includes(w), w);
});
