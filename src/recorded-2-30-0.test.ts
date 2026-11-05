/**
 * 2.30.0: adr_consignment_check's mixed_loading_7_5_2 — answers of the website's
 * POST /api/adr/consignment-check recorded on its build-2b preview (test-fixtures/recorded-2.30.0.json, keyed,
 * envelope 1.2; check_ids synthetic), driven through the real server and the SDK's validating Client, and parsed
 * through the TYPED branch of the tool's result schema; plus the new optional input vehicle.foodstuffs_carried.
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
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.30.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;
const NAME = 'adr_consignment_check';
const bodyOf = (rec: Recorded) => JSON.parse(rec.request.slice(rec.request.indexOf(' {') + 1)) as Record<string, unknown>;
type Pair = { a: number; b: number; permitted: boolean | 'conditional'; cell: string | null; note: string | null; source_ref: { section: string; pdf_page: number } };
type Mix = { verdict: string; pairs: Pair[]; class_1: { assessed: boolean; pairs: Pair[] }; foodstuffs: { engaged: boolean; input: boolean | null; verdict: string; answer?: string }; conditions: string[] };

async function call(rec: Recorded, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const sent: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    sent.push({ url: String(u), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.30.0-test', version: '1' });
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
const mixOf = (sc: { result: Record<string, unknown> }) => sc.result.mixed_loading_7_5_2 as Mix;

test('2.30.0: the description says mixed loading is checked and names the later builds and the foodstuffs input', () => {
  const t = ALL_TOOLS.find((x) => x.name === NAME)!;
  assert.match(t.description, /mixed loading \(7\.5\.2, with the foodstuffs precautions of 7\.5\.4\)/);
  assert.match(t.description, /mixed_loading_7_5_2 \{verdict, basis, lines\[\]/);
  // Since 2.31.0 (build 2c) plates, equipment and training are checked; recorded-2-31-0.test.ts asserts the 2c Limitations.
  assert.match(t.description, /the packaging check reads the mark, not the packaging kind/); // since 2.32.0 (build 2d)
  assert.match(t.description, /vehicle\.foodstuffs_carried/);
  assert.doesNotMatch(t.description, /does not yet check mixed loading/);
});

test('2.30.0: vehicle.foodstuffs_carried is accepted (boolean), sent through, and a string is refused', async () => {
  const rec = FX.mix_foodstuffs_true_conditional;
  const args = bodyOf(rec);
  const { res, sent } = await call(rec, args);
  assert.ok(!res.isError);
  assert.deepEqual((sent[0].body as { vehicle: unknown }).vehicle, { foodstuffs_carried: true });
  const bad = await call(rec, { ...args, vehicle: { foodstuffs_carried: 'yes' } });
  assert.ok(bad.res.isError, 'a string foodstuffs_carried is refused by the strict input schema');
  assert.equal(bad.sent.length, 0);
});

test('recorded: petrol with 1.4G fireworks — fail, cell 3 × 1.4, note a not met; typed', async () => {
  const rec = FX.mix_petrol_fireworks_14g_fail;
  const { res, sc } = await call(rec, bodyOf(rec));
  assert.ok(!res.isError);
  parsesTyped(sc.result);
  const m = mixOf(sc);
  assert.equal(m.verdict, 'fail');
  assert.equal(m.pairs[0].cell, '3 × 1.4');
  assert.equal(m.pairs[0].permitted, false);
  assert.match(m.pairs[0].note ?? '', /note a — not met/);
  assert.equal(m.pairs[0].source_ref.pdf_page, 602);
  const entry = (sc.result.checks_performed as Array<{ name: string; verdict: string }>).find((c) => c.name === 'mixed_loading_7_5_2');
  assert.equal(entry?.verdict, 'fail');
});

test('recorded: two Class 1 lines F and C — fail by 7.5.2.2; typed', async () => {
  const rec = FX.mix_class1_f_c_fail;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  const m = mixOf(sc);
  assert.equal(m.class_1.assessed, true);
  assert.equal(m.class_1.pairs[0].cell, 'F × C');
  assert.equal(m.class_1.pairs[0].permitted, false);
  assert.equal(m.class_1.pairs[0].source_ref.section, '7.5.2.2');
});

test('recorded: blasting explosive with ammonium nitrate — conditional on note d ("conditional" typed)', async () => {
  const rec = FX.mix_explosive_ammonium_nitrate_note_d_conditional;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  const m = mixOf(sc);
  assert.equal(m.verdict, 'conditional');
  assert.equal(m.pairs[0].permitted, 'conditional');
  assert.ok(m.conditions.length >= 1);
});

test('recorded: foodstuffs — absent conditional, false pass, true conditional with the separation', async () => {
  for (const [k, input, verdict] of [['mix_foodstuffs_absent_conditional', null, 'conditional'], ['mix_foodstuffs_false_pass', false, 'pass'], ['mix_foodstuffs_true_conditional', true, 'conditional']] as const) {
    const rec = FX[k];
    const { sc } = await call(rec, bodyOf(rec));
    parsesTyped(sc.result);
    const m = mixOf(sc);
    assert.equal(m.foodstuffs.engaged, true, k);
    assert.equal(m.foodstuffs.input, input, k);
    assert.equal(m.foodstuffs.verdict, verdict, k);
  }
  const { sc } = await call(FX.mix_foodstuffs_true_conditional, bodyOf(FX.mix_foodstuffs_true_conditional));
  assert.match(mixOf(sc).foodstuffs.answer ?? '', /0\.8 m/);
});

test('typed branch: a pair whose permitted is neither boolean nor "conditional" is refused', () => {
  const r = FX.mix_petrol_fireworks_14g_fail.body.result as Record<string, unknown>;
  const m = r.mixed_loading_7_5_2 as Mix;
  const bad = { ...r, mixed_loading_7_5_2: { ...m, pairs: [{ ...m.pairs[0], permitted: 'maybe' }] } };
  assert.equal(typed().safeParse(bad).success, false);
});
