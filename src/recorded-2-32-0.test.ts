/**
 * 2.32.0: adr_consignment_check reads the UN packaging mark (packages.un_mark, ADR 6.1.3.1) and leaves a stated-and-met
 * LQ / EQ line out of the 1.1.3.6 total (1.1.3.6.5) — answers of the website's POST /api/adr/consignment-check recorded
 * on production (build 2d; test-fixtures/recorded-2.32.0.json, keyed, envelope 1.2; check_ids synthetic), driven through
 * the real server and the SDK's validating Client, and parsed through the TYPED branch of the tool's result schema.
 * The six 2.31.0 vehicle-side requests were re-sent and every answer moved (the packaging check is real now), so they are
 * re-recorded here; the 2.31.0 file stays as it was recorded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';

type Recorded = { request: string; status: number; body: Record<string, unknown> };
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.32.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;
const NAME = 'adr_consignment_check';
const bodyOf = (rec: Recorded) => JSON.parse(rec.request.slice(rec.request.indexOf(' {') + 1)) as Record<string, unknown>;
type PkgLine = { line_index: number; verdict: string; mark: string | null; field?: string; parsed?: Record<string, unknown>; reason: string };
type PkgBlock = { verdict: string; basis: string; lines: PkgLine[]; notes: string[] };

async function call(rec: Recorded, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const sent: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    sent.push({ url: String(u), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.32.0-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await client.listTools();
    const res = await client.callTool({ name: NAME, arguments: args });
    return { res, sc: res.structuredContent as Record<string, unknown> & { result: Record<string, unknown> }, sent };
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}
function typed(): z.ZodTypeAny {
  const t = ALL_TOOLS.find((x) => x.name === NAME);
  assert.ok(t?.resultSchema);
  const u = t.resultSchema as unknown as { options?: z.ZodTypeAny[]; def?: { options?: z.ZodTypeAny[] } };
  const opts = u.options ?? u.def?.options;
  assert.ok(opts && opts.length === 2);
  return opts[0];
}
function parsesTyped(result: unknown) {
  const r = typed().safeParse(result);
  assert.ok(r.success, `typed branch refused: ${JSON.stringify(r.error?.issues ?? null).slice(0, 600)}`);
}
const pkg = (sc: { result: Record<string, unknown> }) => sc.result.packaging_code_validity as PkgBlock;
const entry = (sc: { result: Record<string, unknown> }, k: string) => (sc.result.checks_performed as Array<{ name: string; verdict: string }>).find((c) => c.name === k);
const missingNames = (sc: { result: Record<string, unknown> }) => (sc.result.missing_inputs as Array<{ name: string }>).map((m) => m.name);

test('2.32.0: the description names the packaging check, its readings and what it does not do', () => {
  const t = ALL_TOOLS.find((x) => x.name === NAME)!;
  assert.match(t.description, /packaging_code_validity \{verdict, basis, lines\[\] \{line_index, un_number, verdict, mark, field/);
  assert.match(t.description, /\(a\) the symbol, \(b\) the code of the 6\.1\.2\.7 table/);
  assert.match(t.description, /X: I, II, III; Y: II, III; Z: III/);
  // the readings, as the engine answers them
  assert.match(t.description, /a Class 7 package or a Class 2 gas in pressure receptacles \(column \(8\) P200 \/ P203\) → not_applicable/);
  assert.match(t.description, /any other Class 2 line → not_assessed/);
  assert.match(t.description, /a row without a packing group → conditional/);
  assert.doesNotMatch(t.description, /Class 2 \/ Class 7 → not_assessed/);
  // the four build 2d answer changes
  assert.match(t.description, /1\.1\.3\.6\.5; exemption_1_1_3_6\.engine\.excluded_lines names it/);
  assert.match(t.description, /special provision 274 or 318 is conditional on the document until its technical name is added/);
  assert.match(t.description, /a CARRIAGE PROHIBITED line and an ID line get no entry \(entry null, the reason given\)/);
  // Limitations: what the mark check does not do; no "not checked" line about packaging codes
  assert.match(t.description, /Limitations: the packaging check reads the mark, not the packaging kind/);
  assert.match(t.description, /IBC \/ large-packaging marks are named, not read/);
  assert.match(t.description, /on a row without a packing group \(articles, most of Class 1\) the letter is not held against anything/);
  assert.doesNotMatch(t.description, /does not yet check packaging codes/);
  assert.doesNotMatch(t.description, /not_in_this_version until it ships/);
  // the input, in the rule's words
  const line = (t.schema.shape.lines as unknown as { element: z.ZodObject }).element;
  const pk = (line.shape.packages as unknown as { unwrap(): z.ZodObject }).unwrap();
  const um = pk.shape.un_mark as unknown as { description?: string };
  assert.match(um.description ?? '', /\(a\) the symbol, \(b\) the 6\.1\.2\.7 code, \(c\) the packing-group letter X \/ Y \/ Z .*\(d\) S or the test pressure .*\(e\) the year, \(f\) the State, \(g\) the maker/);
});

test('2.32.0: packages.un_mark is accepted and sent through; refused when empty, too long or not a string', async () => {
  const rec = FX.mark_y_on_pg_ii_pass;
  const args = bodyOf(rec);
  const { res, sent } = await call(rec, args);
  assert.ok(!res.isError);
  const s = sent[0].body as { lines: Array<{ packages: { un_mark: string } }> };
  assert.equal(s.lines[0].packages.un_mark, 'UN 3H1/Y1.4/150/24/GB/ZZ1');
  const line0 = (args.lines as Array<Record<string, unknown>>)[0];
  for (const bad of ['', 'U'.repeat(81), 42]) {
    const r = await call(rec, { ...args, lines: [{ ...line0, packages: { ...(line0.packages as object), un_mark: bad } }] });
    assert.ok(r.res.isError, `refused: ${JSON.stringify(bad).slice(0, 20)}`);
    assert.equal(r.sent.length, 0);
  }
  const r = await call(rec, { ...args, lines: [{ ...line0, packages: { ...(line0.packages as object), un_marks: 'x' } }] });
  assert.ok(r.res.isError, 'an unknown key in packages is refused');
});

test('recorded: a well-formed Y mark on a packing group II line — pass, parsed field by field; typed', async () => {
  const { sc } = await call(FX.mark_y_on_pg_ii_pass, bodyOf(FX.mark_y_on_pg_ii_pass));
  parsesTyped(sc.result);
  const p = pkg(sc);
  assert.equal(p.verdict, 'pass');
  assert.equal(p.lines[0].verdict, 'pass');
  assert.equal(p.lines[0].field, undefined);
  assert.deepEqual({ ...p.lines[0].parsed }, { symbol: 'UN', code: '3H1', code_suffix: null, letter: 'Y', covers: ['II', 'III'], relative_density: 1.4, max_gross_mass_kg: null, solids_or_inner: false, test_pressure_kpa: 150, year: '24', state: 'GB', manufacturer: 'ZZ1' });
  assert.equal(entry(sc, 'packaging_code_validity')?.verdict, 'pass');
  assert.ok(!missingNames(sc).includes('lines[0].packages.un_mark'));
});

test('recorded: a Z mark on a packing group II line — fail on (c); an unknown code — fail on (b)', async () => {
  const z1 = await call(FX.mark_z_on_pg_ii_fail, bodyOf(FX.mark_z_on_pg_ii_fail));
  parsesTyped(z1.sc.result);
  assert.equal(pkg(z1.sc).verdict, 'fail');
  assert.equal(pkg(z1.sc).lines[0].field, 'c');
  assert.match(pkg(z1.sc).lines[0].reason, /the letter Z does not cover packing group II/);
  assert.equal(z1.sc.result.status, 'fail');
  const b = await call(FX.mark_unknown_code_fail, bodyOf(FX.mark_unknown_code_fail));
  parsesTyped(b.sc.result);
  assert.equal(pkg(b.sc).lines[0].verdict, 'fail');
  assert.equal(pkg(b.sc).lines[0].field, 'b');
  assert.match(pkg(b.sc).lines[0].reason, /"3Q9" is not a code of the 6\.1\.2\.7 table/);
});

test('recorded: no mark — conditional, the mark named as an optional missing input', async () => {
  const { sc } = await call(FX.mark_absent_conditional, bodyOf(FX.mark_absent_conditional));
  parsesTyped(sc.result);
  assert.equal(pkg(sc).verdict, 'conditional');
  assert.equal(pkg(sc).lines[0].mark, null);
  assert.ok(missingNames(sc).includes('lines[0].packages.un_mark'));
  assert.equal(entry(sc, 'packaging_code_validity')?.verdict, 'conditional');
});

test('recorded: an LQ line stated and met is left out of the 1.1.3.6 total (1.1.3.6.5) and is not_applicable on the mark', async () => {
  const { sc } = await call(FX.lq_stated_and_met_excluded, bodyOf(FX.lq_stated_and_met_excluded));
  parsesTyped(sc.result);
  const ex = sc.result.exemption_1_1_3_6 as { engine: { excluded_lines: Array<{ line_index: number; regime: string; reason: string }> } };
  assert.equal(ex.engine.excluded_lines.length, 1);
  assert.equal(ex.engine.excluded_lines[0].line_index, 1);
  assert.equal(ex.engine.excluded_lines[0].regime, 'lq');
  assert.match(ex.engine.excluded_lines[0].reason, /1\.1\.3\.6\.5/);
  assert.deepEqual(pkg(sc).lines.map((l) => l.verdict), ['pass', 'not_applicable']);
});

test('recorded: the document — UN 2455 gets no entry and still fails; SP 274 is conditional; an ID line is insufficient', async () => {
  const cp = await call(FX.carriage_prohibited_no_entry, bodyOf(FX.carriage_prohibited_no_entry));
  parsesTyped(cp.sc.result);
  const td = cp.sc.result.transport_document as { verdict: string; lines: Array<{ entry?: null; strings?: string[]; reason?: string }> };
  assert.equal(td.verdict, 'insufficient_data');
  assert.equal(td.lines[0].entry, null);
  assert.equal(td.lines[0].strings, undefined);
  assert.match(td.lines[0].reason ?? '', /CARRIAGE PROHIBITED/);
  assert.equal(cp.sc.result.status, 'fail');
  const sp = await call(FX.sp_274_technical_name_conditional, bodyOf(FX.sp_274_technical_name_conditional));
  parsesTyped(sp.sc.result);
  const td2 = sp.sc.result.transport_document as { verdict: string; conditions: string[] };
  assert.equal(td2.verdict, 'conditional');
  assert.ok(td2.conditions.some((c) => /SP 274/.test(c)));
  const id = await call(FX.id_line_without_icao_statement, bodyOf(FX.id_line_without_icao_statement));
  parsesTyped(id.sc.result);
  assert.equal((id.sc.result.transport_document as { verdict: string }).verdict, 'insufficient_data');
  assert.equal(pkg(id.sc).lines[0].verdict, 'insufficient_data');
});

test('recorded: the 2.31.0 vehicle-side loads, re-sent — the packaging check answers and the everything-declared load reads conditional until its marks are sent', async () => {
  for (const k of ['vehicle_no_inputs_conditional', 'vehicle_everything_declared_pass', 'vehicle_extinguishers_short_fail', 'vehicle_relief_1_1_3_6', 'vehicle_class1_specialisation_fail', 'vehicle_label_6_1_escape_mask']) {
    const rec = FX[k];
    assert.ok(rec, k);
    const { res, sc } = await call(rec, bodyOf(rec));
    assert.ok(!res.isError, k);
    parsesTyped(sc.result);
    assert.notEqual(entry(sc, 'packaging_code_validity')?.verdict, 'not_in_this_version', k);
    assert.ok(!(sc.result.checks_performed as Array<{ verdict: string }>).some((c) => c.verdict === 'not_in_this_version'), k);
  }
  const { sc } = await call(FX.vehicle_everything_declared_pass, bodyOf(FX.vehicle_everything_declared_pass));
  assert.equal(sc.result.status, 'conditional');
  assert.equal(pkg(sc).verdict, 'conditional');
  for (const k of ['placards_and_plates_5_3', 'equipment_8_1', 'driver_training_8_2']) assert.equal((sc.result[k] as { verdict: string }).verdict, 'pass', k);
});
