/**
 * 2.31.0 (unreleased): adr_consignment_check's vehicle side — placards_and_plates_5_3, equipment_8_1 and
 * driver_training_8_2 — answers of the website's POST /api/adr/consignment-check recorded on its build-2c
 * preview (test-fixtures/recorded-2.31.0.json, keyed, envelope 1.2; check_ids synthetic), driven through the
 * real server and the SDK's validating Client, and parsed through the TYPED branch of the tool's result
 * schema; plus the new optional inputs (vehicle.* vehicle-side fields, crew), strict.
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
const FX = JSON.parse(readFileSync(new URL('../test-fixtures/recorded-2.31.0.json', import.meta.url), 'utf8')) as Record<string, Recorded>;
const NAME = 'adr_consignment_check';
const bodyOf = (rec: Recorded) => JSON.parse(rec.request.slice(rec.request.indexOf(' {') + 1)) as Record<string, unknown>;
type Req = { id: string; applies: boolean | string; quantity?: string; specification?: string };
type Block = { verdict: string; requirements: Req[]; conditions: string[]; notes: string[] } & Record<string, unknown>;

async function call(rec: Recorded, args: Record<string, unknown>) {
  const real = globalThis.fetch;
  const sent: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    sent.push({ url: String(u), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.31.0-test', version: '1' });
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
const blk = (sc: { result: Record<string, unknown> }, k: string) => sc.result[k] as Block;
const entry = (sc: { result: Record<string, unknown> }, k: string) => (sc.result.checks_performed as Array<{ name: string; verdict: string }>).find((c) => c.name === k);

test('2.31.0: the description names the vehicle side, its inputs and the 2c limitations', () => {
  const t = ALL_TOOLS.find((x) => x.name === NAME)!;
  assert.match(t.description, /the vehicle side — orange-coloured plates and placards \(5\.3\), the documents, fire extinguishers and equipment on the transport unit \(8\.1\), and driver training \(8\.2\)/);
  assert.match(t.description, /placards_and_plates_5_3 \{verdict, basis, requirements\[\]/);
  assert.match(t.description, /equipment_8_1 \{verdict/);
  assert.match(t.description, /driver_training_8_2 \{verdict/);
  assert.match(t.description, /crew \{adr_training_certificate, specialisations\[\]/);
  assert.match(t.description, /Limitations: version 2c does not yet check packaging codes \(build 2d\)/);
  assert.doesNotMatch(t.description, /does not yet check plates and placards/);
});

test('2.31.0: the vehicle-side inputs and crew are accepted, sent through, and refused when mistyped', async () => {
  const rec = FX.vehicle_everything_declared_pass;
  const args = bodyOf(rec);
  const { res, sent } = await call(rec, args);
  assert.ok(!res.isError);
  const s = sent[0].body as { vehicle: Record<string, unknown>; crew: Record<string, unknown> };
  assert.deepEqual(s.vehicle.fire_extinguishers_kg, [6, 2]);
  assert.equal(s.vehicle.orange_plates_displayed, true);
  assert.deepEqual(s.crew, { adr_training_certificate: true, photo_identification: true });
  for (const bad of [
    { ...args, vehicle: { ...(args.vehicle as object), equipment_8_1_5: ['fire_blanket'] } },
    { ...args, crew: { adr_training_certificate: 'yes' } },
    { ...args, crew: { name: 'x' } },
    { ...args, crew: { specialisations: ['class_3'] } },
  ]) {
    const r = await call(rec, bad);
    assert.ok(r.res.isError, `refused: ${JSON.stringify(bad).slice(-80)}`);
    assert.equal(r.sent.length, 0);
  }
});

test('recorded: no vehicle-side inputs — the three checks conditional with their requirements; typed', async () => {
  const rec = FX.vehicle_no_inputs_conditional;
  const { res, sc } = await call(rec, bodyOf(rec));
  assert.ok(!res.isError);
  parsesTyped(sc.result);
  for (const k of ['placards_and_plates_5_3', 'equipment_8_1', 'driver_training_8_2']) {
    assert.equal(blk(sc, k).verdict, 'conditional', k);
    assert.equal(entry(sc, k)?.verdict, 'conditional', k);
  }
  assert.equal(blk(sc, 'placards_and_plates_5_3').requirements[0].id, 'orange_plates_5_3_2_1_1');
  assert.equal(blk(sc, 'placards_and_plates_5_3').requirements[0].applies, true);
  assert.equal(blk(sc, 'driver_training_8_2').requirements[0].id, 'driver_certificate_8_2_1');
  const missing = (sc.result.missing_inputs as Array<{ name: string; what: string }>).map((m) => m.name);
  for (const n of ['vehicle.orange_plates_displayed', 'vehicle.fire_extinguishers_kg', 'crew.adr_training_certificate']) assert.ok(missing.includes(n), n);
});

test('recorded: everything declared on a 7.5 t unit — the three pass; the band is the printed row', async () => {
  const rec = FX.vehicle_everything_declared_pass;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  for (const k of ['placards_and_plates_5_3', 'equipment_8_1', 'driver_training_8_2']) assert.equal(blk(sc, k).verdict, 'pass', k);
  const ext = blk(sc, 'equipment_8_1').fire_extinguishers as { band: { transport_unit_maximum_permissible_mass: string; minimum_total_kg: number; additional_minimum_kg: number }; verdict: string };
  assert.equal(ext.band.transport_unit_maximum_permissible_mass, '> 3.5 tonnes ≤ 7.5 tonnes');
  assert.equal(ext.band.minimum_total_kg, 8);
  assert.equal(ext.band.additional_minimum_kg, 6);
  assert.equal(ext.verdict, 'pass');
});

test('recorded: two 2 kg extinguishers on a 7.5 t unit — equipment_8_1 fail, the columns quoted', async () => {
  const rec = FX.vehicle_extinguishers_short_fail;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  const ext = blk(sc, 'equipment_8_1').fire_extinguishers as { verdict: string; why: string };
  assert.equal(blk(sc, 'equipment_8_1').verdict, 'fail');
  assert.equal(ext.verdict, 'fail');
  assert.match(ext.why, /column \(3\) requires at least 8 kg/);
});

test('recorded: a 1.1.3.6 load — 1.1.3.6.2 answers (no 5.3, one 2 kg extinguisher, 8.2.3 in place of 8.2.1)', async () => {
  const rec = FX.vehicle_relief_1_1_3_6;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  assert.equal(blk(sc, 'placards_and_plates_5_3').verdict, 'pass');
  assert.equal(blk(sc, 'placards_and_plates_5_3').requirements[0].applies, false);
  assert.equal(blk(sc, 'equipment_8_1').requirements[0].id, 'fire_extinguisher_8_1_4_2');
  assert.equal(blk(sc, 'driver_training_8_2').requirements[0].applies, false);
  assert.equal(blk(sc, 'driver_training_8_2').requirements[1].id, 'driver_training_8_2_3');
  assert.equal((blk(sc, 'driver_training_8_2').certificate as { under_relief: boolean }).under_relief, true);
});

test('recorded: Class 1 (1.4G) — placard 1.4G, the class_1 specialisation missing fails', async () => {
  const rec = FX.vehicle_class1_specialisation_fail;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  const pl = blk(sc, 'placards_and_plates_5_3').placards as { required: boolean; lines: Array<{ placards: string[] }> };
  assert.equal(pl.required, true);
  assert.equal(pl.lines[0].placards[0], '1.4G');
  const cert = blk(sc, 'driver_training_8_2').certificate as { specialisations: Array<{ specialisation: string; outcome: string }> };
  assert.equal(cert.specialisations[0].specialisation, 'class_1');
  assert.equal(cert.specialisations[0].outcome, 'fail');
  assert.equal(blk(sc, 'driver_training_8_2').verdict, 'fail');
});

test('recorded: label 6.1 — the emergency escape mask required, the shovel not', async () => {
  const rec = FX.vehicle_label_6_1_escape_mask;
  const { sc } = await call(rec, bodyOf(rec));
  parsesTyped(sc.result);
  const items = blk(sc, 'equipment_8_1').label_specific_equipment as Array<{ item: string; applies: boolean | string }>;
  assert.equal(items.find((x) => x.item === 'emergency_escape_mask')?.applies, true);
  assert.equal(items.find((x) => x.item === 'shovel')?.applies, false);
});

test('typed branch: a requirement whose applies is not boolean / "under_relief_only" / "conditional" is refused', () => {
  const r = FX.vehicle_no_inputs_conditional.body.result as Record<string, unknown>;
  const p = r.placards_and_plates_5_3 as Block;
  const bad = { ...r, placards_and_plates_5_3: { ...p, requirements: [{ ...p.requirements[0], applies: 'maybe' }] } };
  assert.equal(typed().safeParse(bad).success, false);
});
