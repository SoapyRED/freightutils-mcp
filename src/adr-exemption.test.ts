/**
 * adr_exemption_calculator — the 2.20.0 contract (Part F of the FreightUtils DG reader
 * rebuild, 2026-10-03), pinned on this package's own surface: the description, the input
 * schema and what the handler sends to the API.
 *
 * WHY. Each of these was reproduced on production through this package (2.19.0) first:
 *  - the description stated the bare rule — "a load totalling 1,000 points or less
 *    qualifies" — when ADR 1.1.3.6.2 holds goods of one transport category to the
 *    1.1.3.6.3 column (3) maximum as a TOTAL (200 L + 133.2 L of category-2 liquids is
 *    999.6 points and still not exempt);
 *  - the handler sent `{ items }` alone, so a packing_group / unit sent beside items[] was
 *    dropped HERE — UN 1263 + PG III came back with all six UN 1263 rows, and 300 of
 *    UN 1203 with unit "kg" was scored as litres and read exempt at 900 points;
 *  - "ID 8000" was rejected by the input schema before the API could route it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from './tools.js';

const tool = ALL_TOOLS.find((t) => t.name === 'adr_exemption_calculator');
if (!tool) throw new Error('adr_exemption_calculator is not registered');

test('description states the 1.1.3.6.2 rule with the column (3) maximum, never the bare 1,000-point rule', () => {
  const d = tool.description;
  assert.equal(d.includes('a load totalling 1,000 points or less qualifies'), false, 'the bare rule is back');
  for (const must of ['1.1.3.6.2', 'carried in packages', 'column (3)', '2: 333', 'TOTAL', 'DIFFERENT categories', 'does not exceed 1,000', 'not in bulk or in tanks']) {
    assert.ok(d.includes(must), `description no longer says "${must}"`);
  }
});

test('description documents the routing states, the AIR_ONLY_ID basis and the beside-items refusal', () => {
  const d = tool.description;
  for (const must of ['COUNTED', 'AIR_ONLY_ID', 'NOT_SUBJECT_TO_ADR', 'BLOCKED', '3.4.9', '3.4.10', '1.1.3.6.5', 'limited quantities to the ICAO Technical Instructions', 'sent beside items[] is refused', 'never both', 'blocking_errors is in the text content']) {
    assert.ok(d.includes(must), `description no longer says "${must}"`);
  }
  // 1.1.4.2.1 relieves only packing, mixed packing, marking, labelling and placarding; it is not
  // the basis of the 0 (review finding).
  assert.equal(d.includes('1.1.4.2.1'), false, 'the AIR_ONLY_ID basis must not be 1.1.4.2.1');
  assert.equal(d.includes('items takes precedence'), false, 'un_number/quantity beside items[] are refused now, not overridden');
});

// 2.22.0 (all-tools sweep, probe row S36): "UN 1203" — the form a transport document prints —
// moved from the refused list to the accepted one; the API always read it as UN 1203. Every
// other refusal stays, plus the spacings that are not a UN number.
test('input schema: ID-prefixed numbers accepted, "UN 1203" accepted, malformed numbers refused', () => {
  const ok = (v: Record<string, unknown>) => tool.schema.safeParse(v).success;
  for (const un of ['1203', 'UN1203', 'un1203', 'UN 1203', 'un 1203', 'ID8000', 'ID 8000', 'id8000', 'ID-8000', 'ID:8000']) {
    assert.ok(ok({ un_number: un, quantity: 10 }), `single form refused ${un}`);
    assert.ok(ok({ items: [{ un_number: un, quantity: 10 }] }), `items form refused ${un}`);
  }
  for (const un of ['ID800', 'ID--8000', 'ID 1203A', '12030', 'Y841', 'UN 12 03', 'U N1203', 'UN 120']) {
    assert.equal(ok({ un_number: un, quantity: 10 }), false, `single form accepted ${un}`);
  }
});

test('handler forwards packing_group / variant_index / unit / basis beside items[] so the API can refuse them', async () => {
  const realFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    await tool.handler({ items: [{ un_number: '1263', quantity: 100 }], packing_group: 'III', unit: 'L' });
    assert.deepEqual(bodies[0], { items: [{ un_number: '1263', quantity: 100 }], packing_group: 'III', unit: 'L' });
    await tool.handler({ items: [{ un_number: '1203', quantity: 200 }] });
    assert.deepEqual(bodies[1], { items: [{ un_number: '1203', quantity: 200 }] }, 'an unsent field must not be invented');
    await tool.handler({ items: [{ un_number: '1950', quantity: 500 }], variant_index: 4, basis: 'gross' });
    assert.deepEqual(bodies[2], { items: [{ un_number: '1950', quantity: 500 }], variant_index: 4, basis: 'gross' });
    await tool.handler({ items: [{ un_number: '1203', quantity: 100 }], un_number: '1051', quantity: 1 });
    assert.deepEqual(bodies[3], { items: [{ un_number: '1203', quantity: 100 }], un_number: '1051', quantity: 1 }, 'a substance beside items[] must reach the API, which refuses it');
    // variant_index 0 is a real row index, and basis 'net' a real declaration: falsy-looking values
    // must be forwarded too (a `|| undefined` would drop them — second review round).
    await tool.handler({ items: [{ un_number: '1950', quantity: 500 }], variant_index: 0, basis: 'net' });
    assert.deepEqual(bodies[4], { items: [{ un_number: '1950', quantity: 500 }], variant_index: 0, basis: 'net' });
  } finally {
    globalThis.fetch = realFetch;
  }
});
