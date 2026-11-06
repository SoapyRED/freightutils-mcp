/**
 * 2.34.0: the upstream state (freightutils.com run 0.2b) is typed. _meta declares upstream { state, stale,
 * state_read_at, datasets: { <id>: { state, kind, last_success, window_days, stale, reason? } } } — optional, every
 * object passthrough. Answers recorded on production through the REST envelope this package requests (keyed,
 * envelope 1.2; test-fixtures/recorded-2.34.0.json) are driven through the real server and the SDK's validating
 * Client: none is refused, _meta.upstream parses on the typed schema, stale is true only with window_missed. A
 * synthetic window_missed answer and an unknown one (the state could not be read) validate too. The 2.33.0 recordings
 * (before the state existed) are driven by recorded-2-33-0.test.ts, unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { UPSTREAM_META } from './envelope.js';

type Rec = Record<string, unknown>;
type Recorded = { tool: string; args: Rec; request: string; status: number; body: Rec };
const load = (v: string) => JSON.parse(readFileSync(new URL(`../test-fixtures/recorded-${v}.json`, import.meta.url), 'utf8')) as Record<string, Recorded>;
const FX = load('2.34.0');

async function callTool(name: string, args: Rec, body: Rec, status = 200) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const server = createServer();
  const client = new Client({ name: 'recorded-2.34.0-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const res = await client.callTool({ name, arguments: args });
    return res as { isError?: boolean; structuredContent?: Rec & { _meta?: Rec } };
  } finally {
    globalThis.fetch = real;
    await client.close();
    await server.close();
  }
}

test('every recorded production answer carries _meta.upstream and validates', async () => {
  assert.ok(Object.keys(FX).length >= 6, 'at least six recorded answers');
  for (const [k, r] of Object.entries(FX)) {
    const res = await callTool(r.tool, r.args, r.body);
    assert.ok(!res.isError, `${k}: refused`);
    const up = res.structuredContent?._meta?.upstream as Rec | undefined;
    assert.ok(up, `${k}: no _meta.upstream`);
    const p = UPSTREAM_META.safeParse(up);
    assert.ok(p.success, `${k}: _meta.upstream does not parse typed: ${JSON.stringify(p.error?.issues ?? null).slice(0, 400)}`);
    for (const [id, d] of Object.entries(up.datasets as Record<string, Rec>)) assert.equal(d.stale, d.state === 'window_missed', `${k} ${id}: stale only with window_missed`);
  }
});

test('a window_missed answer and an unknown answer validate (synthetic, from a recorded one)', async () => {
  const [k, r] = Object.entries(FX)[0];
  const env = r.body as Rec & { _meta: Rec & { upstream: Rec & { datasets: Record<string, Rec> } } };
  const id = Object.keys(env._meta.upstream.datasets)[0];
  const missed = structuredClone(env);
  missed._meta.upstream = { ...missed._meta.upstream, state: 'window_missed', stale: true, datasets: { [id]: { ...missed._meta.upstream.datasets[id], state: 'window_missed', stale: true } } };
  const unknown = structuredClone(env);
  unknown._meta.upstream = { state: 'unknown', stale: false, state_read_at: null, datasets: { [id]: { state: 'unknown', kind: 'watched', last_success: null, window_days: 7, stale: false, reason: 'store_unreachable' } } };
  for (const [label, body] of [['window_missed', missed], ['unknown', unknown]] as const) {
    const res = await callTool(r.tool, r.args, body);
    assert.ok(!res.isError, `${k} ${label}: refused`);
    assert.ok(UPSTREAM_META.safeParse(res.structuredContent?._meta?.upstream).success, `${k} ${label}: typed parse`);
  }
});
