/**
 * 2.33.0: the stable identifiers (freightutils.com run 0.1b) are typed. Every record of the fifteen record tools
 * declares fu_id / fu_version_id as optional strings and _meta declares ids { scheme, pattern }; every record
 * schema stays passthrough. Answers recorded on production through this package's own server (keyed, envelope 1.2;
 * test-fixtures/recorded-2.33.0.json, check ids synthetic) are driven through the real server and the SDK's
 * validating Client and parsed on the TYPED branch of each tool's result schema — one per namespace, a family with
 * no editions (airline, ULD, container, vehicle: fu_id only) and records inside other answers (a consignment
 * check's engine items, resolve candidates). Answers recorded before the identifiers existed still parse typed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS, ID_RECORD_TOOLS } from './tools.js';

type Recorded = { tool: string; args: Record<string, unknown>; request: string; status: number; body: Record<string, unknown> };
const load = (v: string) => JSON.parse(readFileSync(new URL(`../test-fixtures/recorded-${v}.json`, import.meta.url), 'utf8')) as Record<string, Recorded>;
const FX = load('2.33.0');
const PATTERN = 'fu:<namespace>:<segment>[:<segment>…][@<edition>]';
const FU_ID = /^fu:[a-z0-9-]+:[^@\s]+$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

async function callTool(name: string, args: Rec, body?: Rec, status = 200) {
  const real = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    sent.push(String(u));
    return new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.33.0-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const listed = await client.listTools();
    const res = await client.callTool({ name, arguments: args });
    return { res, listed, sent, sc: res.structuredContent as Rec & { result: Rec; _meta?: Rec } };
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}

function typed(name: string): z.ZodTypeAny {
  const t = ALL_TOOLS.find((x) => x.name === name);
  assert.ok(t?.resultSchema, name);
  const u = t.resultSchema as unknown as { options?: z.ZodTypeAny[]; def?: { options?: z.ZodTypeAny[] } };
  const opts = u.options ?? u.def?.options;
  assert.ok(opts && opts.length === 2, `${name}: result schema is typed-or-record`);
  return opts[0];
}
function parsesTyped(name: string, result: unknown) {
  const r = typed(name).safeParse(result);
  assert.ok(r.success, `${name}: typed branch refused: ${JSON.stringify(r.error?.issues ?? null).slice(0, 600)}`);
  return r.data as Rec;
}

/** Every object in the value that carries fu_id, with its path ([] for array items). */
function idRecords(v: unknown, p = 'result', out: Array<{ path: string; rec: Rec }> = []) {
  if (Array.isArray(v)) v.forEach((x) => idRecords(x, `${p}[]`, out));
  else if (isRec(v)) {
    if ('fu_id' in v) out.push({ path: p, rec: v });
    for (const [k, x] of Object.entries(v)) idRecords(x, `${p}.${k}`, out);
  }
  return out;
}
/** A deep copy without fu_id / fu_version_id anywhere (an answer as a deploy before the identifiers served it). */
const stripIds = (v: unknown): unknown => Array.isArray(v) ? v.map(stripIds) : isRec(v)
  ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'fu_id' && k !== 'fu_version_id').map(([k, x]) => [k, stripIds(x)]))
  : v;

// The record path each case must carry, the first fu_id there, and whether the family has editions.
const EXPECT: Record<string, { path: string; fu_id: string; versioned: boolean }> = {
  adr_un_1203: { path: 'result.results[]', fu_id: 'fu:adr:un:1203:II:F1', versioned: true },
  adr_lq_1203: { path: 'result.items[]', fu_id: 'fu:adr:un:1203:II:F1', versioned: true },
  consignment_1203: { path: 'result.exemption_1_1_3_6.engine.items[]', fu_id: 'fu:adr:un:1203:II:F1', versioned: true },
  hs_010121: { path: 'result', fu_id: 'fu:hs:010121', versioned: true },
  locode_gblhr: { path: 'result', fu_id: 'fu:locode:GBLHR', versioned: true },
  airport_lhr: { path: 'result.results[]', fu_id: 'fu:airport:EGLL', versioned: true },
  nearest_lhr: { path: 'result.results[]', fu_id: 'fu:airport:EGLL', versioned: true },
  airline_ek: { path: 'result.results[]', fu_id: 'fu:airline:emirates', versioned: false },
  uld_ake: { path: 'result.result', fu_id: 'fu:uld:ake-ld3', versioned: false },
  container_20: { path: 'result', fu_id: 'fu:container:20ft-standard', versioned: false },
  vehicle_list: { path: 'result.results[]', fu_id: 'fu:vehicle:standard-curtainsider', versioned: false },
  incoterm_fob: { path: 'result', fu_id: 'fu:incoterm:FOB', versioned: true },
  resolve_fu_airline: { path: 'result.candidates[].record', fu_id: 'fu:airline:emirates', versioned: false },
  resolve_un1203: { path: 'result.candidates[].record', fu_id: 'fu:adr:un:1203:II:F1', versioned: true },
  resolve_nlrtm: { path: 'result.candidates[].record', fu_id: 'fu:locode:NLRTM', versioned: true },
  ics2_parts: { path: 'result.flagged[]', fu_id: 'fu:ics2-stop-word:Parts', versioned: true },
  emissions_road: { path: 'result.factor', fu_id: 'fu:emission-factor:defra_hgv_avg', versioned: true },
};

test('2.33.0: the recording covers every record tool and every case has an expectation', () => {
  const cases = Object.entries(FX).filter(([k]) => k !== '_recorded');
  assert.deepEqual(new Set(cases.map(([, c]) => c.tool)), ID_RECORD_TOOLS);
  assert.deepEqual(cases.map(([k]) => k).sort(), Object.keys(EXPECT).sort());
});

for (const [id, c] of Object.entries(FX)) {
  if (id === '_recorded') continue;
  const want = EXPECT[id];
  test(`2.33.0 recorded ${id} (${c.tool}): validated by the client, typed branch, ${want.versioned ? 'fu_id + fu_version_id' : 'fu_id only'} at ${want.path}`, async () => {
    const { res, sc, sent } = await callTool(c.tool, c.args, c.body, c.status);
    assert.equal(res.isError, undefined, JSON.stringify(res.content).slice(0, 400));
    assert.equal(sent.length, 1);
    // the request the package sends is the one recorded (path and query)
    const u = new URL(sent[0]);
    assert.equal(`${u.pathname}${u.search}`, c.request.split(' ')[1]);
    assert.deepEqual(sc._meta?.ids, { scheme: 1, pattern: PATTERN });
    const data = parsesTyped(c.tool, sc.result);
    const recs = idRecords(data);
    const at = recs.filter((r) => r.path === want.path);
    assert.ok(at.length > 0, `${id}: no record with fu_id at ${want.path} (found at ${[...new Set(recs.map((r) => r.path))].join(', ')})`);
    assert.equal(at[0].rec.fu_id, want.fu_id);
    for (const { path, rec } of recs) {
      assert.match(String(rec.fu_id), FU_ID, `${id} ${path}`);
      if (want.versioned && path === want.path) assert.equal(rec.fu_version_id, `${rec.fu_id}@${String(rec.fu_version_id).split('@')[1]}`);
      if (!want.versioned) assert.equal(rec.fu_version_id, undefined, `${id} ${path}: a family without editions has no fu_version_id`);
      if (rec.fu_version_id !== undefined) assert.ok(String(rec.fu_version_id).startsWith(`${rec.fu_id}@`), `${id} ${path}`);
    }
  });

  test(`2.33.0 recorded ${id}: the same answer without the identifiers still validates (a deploy before 0.1b)`, async () => {
    const body = stripIds(c.body) as Rec;
    if (isRec(body._meta)) delete (body._meta as Rec).ids;
    const { res, sc } = await callTool(c.tool, c.args, body, c.status);
    assert.equal(res.isError, undefined, JSON.stringify(res.content).slice(0, 400));
    parsesTyped(c.tool, sc.result);
    assert.equal(idRecords(sc.result).length, 0);
  });
}

test('2.33.0: answers recorded before the identifiers (2.25.0, 2.27.0, 2.30.0) parse on the typed branch', () => {
  const TOOL_OF: Record<string, string> = {
    '/api/hs': 'hs_code_lookup', '/api/unlocode': 'unlocode_lookup', '/api/adr': 'adr_lookup', '/api/airlines': 'airline_lookup',
    '/api/nearest-airport': 'nearest_airport', '/api/resolve': 'resolve_reference', '/api/adr/consignment-check': 'adr_consignment_check',
  };
  let n = 0;
  for (const v of ['2.25.0', '2.27.0', '2.30.0']) {
    for (const [k, rec] of Object.entries(load(v))) {
      if (k === '_recorded' || !isRec(rec.body) || !isRec(rec.body.result)) continue;
      const tool = TOOL_OF[rec.request.split(' ')[1].split('?')[0]];
      if (!tool) continue;
      assert.equal(JSON.stringify(rec.body).includes('"fu_id"'), false, `${v} ${k} predates the identifiers`);
      parsesTyped(tool, rec.body.result);
      n++;
    }
  }
  assert.ok(n >= 10, `old record answers parsed: ${n}`);
});

test('2.33.0: tools/list declares fu_id / fu_version_id on the record tools and _meta.ids on every tool, never strictly', async () => {
  const { listed } = await callTool('get_subscribe_link', {}, {});
  for (const t of listed.tools) {
    const s = JSON.stringify(t.outputSchema);
    assert.match(s, /"ids":\{"type":"object","properties":\{"scheme":/, `${t.name}: _meta.ids`);
    if (ID_RECORD_TOOLS.has(t.name)) {
      assert.match(s, /"fu_id":\{/, `${t.name}: fu_id declared`);
      assert.match(s, /"fu_version_id":\{/, `${t.name}: fu_version_id declared`);
      // optional everywhere: no "required" list names either field
      for (const m of s.matchAll(/"required":\[([^\]]*)\]/g)) assert.doesNotMatch(m[1], /fu_(version_)?id/, `${t.name}: required`);
    } else {
      assert.doesNotMatch(s, /"fu_id"/, `${t.name}: not a record tool`);
    }
  }
});

test('2.33.0: the identifier clause is on exactly the fifteen record tools, in one wording', () => {
  const CLAUSE = 'Identifiers: Each record carries fu_id, a stable FreightUtils identifier (and fu_version_id where the dataset has editions); resolve_reference resolves one to exactly its record.';
  assert.equal(ID_RECORD_TOOLS.size, 15);
  for (const t of ALL_TOOLS) {
    const n = t.description.split(CLAUSE).length - 1;
    assert.equal(n, ID_RECORD_TOOLS.has(t.name) ? 1 : 0, t.name);
    if (ID_RECORD_TOOLS.has(t.name)) assert.ok(t.description.endsWith(CLAUSE), t.name);
  }
});

test('2.33.0: resolve_reference takes an fu: identifier up to 200 characters, keeps 32 for the rest', async () => {
  const t = ALL_TOOLS.find((x) => x.name === 'resolve_reference')!;
  assert.match(t.description, /an fu: identifier, the fu_id or fu_version_id of any record in an answer \(up to 200 chars\), which resolves to exactly its one record or to none/);
  const ok = (q: string) => (t.schema as z.ZodTypeAny).safeParse({ q }).success;
  const fu200 = `fu:adr:un:1203:${'x'.repeat(200 - 'fu:adr:un:1203:'.length)}`;
  assert.equal(fu200.length, 200);
  assert.equal(ok(fu200), true);
  assert.equal(ok(`${fu200}y`), false);
  assert.equal(ok('fu:adr:un:1203:II:F1@2025'), true);
  assert.equal(ok('x'.repeat(32)), true);
  assert.equal(ok('x'.repeat(33)), false);
  assert.equal(ok('   '), false);
  // through the server: the long fu: id is sent to REST unchanged; a 33-character plain token is refused, nothing sent
  const rec = FX.resolve_fu_airline;
  const sentLong = await callTool('resolve_reference', { q: 'fu:adr:un:1203:II:F1@2025' }, rec.body);
  assert.equal(sentLong.sent.length, 1);
  assert.equal(new URL(sentLong.sent[0]).searchParams.get('q'), 'fu:adr:un:1203:II:F1@2025');
  const refused = await callTool('resolve_reference', { q: 'x'.repeat(33) }, rec.body);
  assert.equal(refused.res.isError, true);
  assert.equal(refused.sent.length, 0);
});
