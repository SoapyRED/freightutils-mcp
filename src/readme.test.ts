/**
 * README truth — the pin that stops this file rotting again.
 *
 * WHY A TEST AND NOT A HABIT. This README is what Glama and Smithery RENDER: it is a
 * published surface, not internal documentation, and it had drifted in two ways at once.
 *
 *  1. It cited ADR 2025 as "UNECE (licensed from Labeline.com)". The FreightUtils
 *     provenance doc re-attributed that dataset to the free authority on 2026-06-22 —
 *     UNECE ECE/TRANS/352 given legal effect by EU Directive 2008/68/EC — and records that
 *     Labeline, a commercial reseller of the official UN text, is "no longer cited in any
 *     public provenance" and retained only as an internal QA baseline. The same doc says
 *     the retired "public IATA/ICAO sources" airline wording "has been removed from every
 *     public surface … README" — and it was still here. A provenance correction that does
 *     not reach the surfaces that render it has not been made.
 *
 *  2. It carried its own copy of the changelog, whose newest entry was 2.4.0 while the
 *     package was on 2.19.0 — fifteen releases stale. That is why three directories showed
 *     2.4.0 as the latest release for three months.
 *
 * So the assertions below are about the two failure modes, not about prose: a banned name,
 * a version heading that means somebody started a second changelog, and a tool count that
 * disagrees with the tools actually registered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_TOOLS } from './tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = () => readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('README does not name Labeline — the ADR provenance is the free authority', () => {
  assert.equal(
    /labeline/i.test(readme()),
    false,
    'Labeline is a commercial reseller retained only as an internal QA baseline; it must not appear in any public provenance. Copy the wording from the FreightUtils docs/DATA_PROVENANCE.md row 9.',
  );
});

test('README carries the UNECE / EU ADR provenance, with its qualifiers intact', () => {
  const r = readme();
  for (const required of [
    'ECE/TRANS/352',
    '2008/68/EC',
    'not legal advice',
  ]) {
    assert.ok(
      r.includes(required),
      `the ADR provenance sentence must keep "${required}" — it is copied from DATA_PROVENANCE, and dropping a qualifier turns a factual compilation into a regulatory claim`,
    );
  }
});

test('README does not restate the retired "public IATA/ICAO sources" airline wording', () => {
  const r = readme();
  assert.equal(
    /public IATA\/ICAO/i.test(r),
    false,
    'that wording was removed from every public surface: the airline dataset has no per-record provenance, so the README states the IATA / ICAO registries as the authority and asserts no licence',
  );
});

test('README holds no inline changelog', () => {
  // A "### 2.4.0 — …" heading is the shape of a second changelog starting. The prose
  // reference to a release ("Since 2.11.0, every tool also declares …") is fine and is
  // deliberately not matched: this looks for a HEADING.
  const headings = readme().match(/^### \d+\.\d+\.\d+\b/gm) ?? [];
  assert.deepEqual(
    headings,
    [],
    `README must point at CHANGELOG.md and GitHub Releases, not carry its own copy. Found: ${headings.join(', ')}`,
  );
});

test('the README tool count equals the tools actually registered', () => {
  const r = readme();
  const heading = /^## Tools \((\d+)\)$/m.exec(r);
  assert.ok(heading, 'README must carry a "## Tools (N)" heading, or no number at all');

  const claimed = Number(heading[1]);
  assert.equal(
    claimed,
    ALL_TOOLS.length,
    `README claims ${claimed} tools; ALL_TOOLS registers ${ALL_TOOLS.length}. The registered list is the source of truth — change the README, not this test.`,
  );

  // And every registered tool is actually documented, so the count cannot be right by
  // luck while a tool is missing from the tables.
  const missing = ALL_TOOLS.map((t) => t.name).filter((name) => !r.includes(`\`${name}\``));
  assert.deepEqual(missing, [], `registered but undocumented in the README: ${missing.join(', ')}`);
});

test('neither server.json nor package.json carries a tool count to drift', () => {
  // Both descriptions have been count-free since 2.1.1 fixed an undercount. Keeping them
  // that way means one place to update instead of three.
  for (const file of ['server.json', 'package.json'] as const) {
    const { description } = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as {
      description?: string;
    };
    assert.ok(description, `${file} has no description`);
    const counted = /\b\d+\s+(freight\s+)?tools?\b/i.exec(description);
    assert.equal(
      counted,
      null,
      `${file} description states a tool count ("${counted?.[0]}"). Remove it: the registered list is the only count, and a second copy is a thing to forget.`,
    );
  }
});
