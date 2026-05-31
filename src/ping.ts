/**
 * `npx freightutils-mcp ping` — single-command diagnostic for a fresh install.
 *
 * Tells the user three things in plain English:
 *   1. Is the FreightUtils backend up?   (GET /api/mcp/health)
 *   2. Does this package's MCP server start and register all tools?
 *      (in-process MCP handshake — Client ↔ Server via InMemoryTransport)
 *   3. Does an end-to-end tool call work through the proxy?
 *      (cbm_calculator with known inputs → backend → assert 0.96 m³)
 *
 * Exit codes:
 *   0 — every check passed
 *   1 — one or more checks failed (specific remediation printed inline)
 *
 * Why InMemoryTransport (not spawn-on-self): the diagnostic should report
 * what THIS process can see. Spawning a second `node dist/bin/cli.js` would
 * test a different process tree (different env, different cwd) and complicate
 * failure attribution. The in-memory pair exercises the same MCP handshake
 * code path Claude Desktop / Cursor / Cline use.
 */

import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';
import { ALL_TOOLS } from './tools.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const BASE_URL = process.env.FREIGHTUTILS_API_URL ?? 'https://www.freightutils.com/api';
const HEALTH_URL = BASE_URL + '/mcp/health';
const WHOAMI_URL = BASE_URL + '/auth/whoami';

// ─── tiny output helpers ─────────────────────────────────────────

const COLOUR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (COLOUR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c('32', s);
const red = (s: string) => c('31', s);
const yellow = (s: string) => c('33', s);
const dim = (s: string) => c('2', s);
const bold = (s: string) => c('1', s);

const TICK = green('✓');
const WARN = yellow('⚠');
const CROSS = red('✗');

interface CheckResult {
  ok: boolean;
  /** One-line summary printed inline. */
  summary: string;
  /** Optional remediation text printed when ok=false. */
  remediation?: string;
  /** Optional latency in ms for the inline summary. */
  ms?: number;
}

function printCheck(idx: number, total: number, label: string, result: CheckResult): void {
  const mark = result.ok ? TICK : CROSS;
  const tail = result.ms !== undefined ? dim(` (${result.ms}ms)`) : '';
  console.log(`[${idx}/${total}] ${label}`);
  console.log(`      ${mark} ${result.summary}${tail}`);
  if (!result.ok && result.remediation) {
    console.log();
    for (const line of result.remediation.split('\n')) {
      console.log('      ' + dim(line));
    }
  }
  console.log();
}

// ─── check 1: backend health ─────────────────────────────────────

async function checkBackendHealth(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timer);
    const ms = Date.now() - start;

    if (!res.ok) {
      return {
        ok: false,
        ms,
        summary: `HTTP ${res.status} from ${HEALTH_URL}`,
        remediation:
          'The FreightUtils backend health endpoint returned non-2xx. Check\n' +
          'https://www.freightutils.com/status for outages. If the site is up\n' +
          'and this still fails, your network or DNS may be blocking the host.',
      };
    }

    const body = (await res.json()) as {
      status?: string;
      mcp_version?: string;
      tools_registered?: number;
    };

    if (body.status !== 'ok') {
      return {
        ok: false,
        ms,
        summary: `backend reports status=${body.status ?? 'unknown'}`,
        remediation: 'The backend is reachable but reports a degraded status. Check https://www.freightutils.com/status.',
      };
    }

    return {
      ok: true,
      ms,
      summary: `status=ok mcp_version=${body.mcp_version ?? '?'} tools_registered=${body.tools_registered ?? '?'}`,
    };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      ms,
      summary: `request failed — ${msg}`,
      remediation:
        'Could not reach the FreightUtils backend. Check your network and DNS\n' +
        'for https://www.freightutils.com. If you are behind a corporate proxy,\n' +
        'configure HTTPS_PROXY accordingly. Override the host for ping with\n' +
        'FREIGHTUTILS_API_URL=<base-url>.',
    };
  }
}

// ─── check 2: MCP handshake (in-process) ─────────────────────────

async function checkMcpHandshake(): Promise<{
  result: CheckResult;
  client: Client | null;
}> {
  try {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'freightutils-ping', version: pkg.version });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const count = tools.tools?.length ?? 0;
    const expected = ALL_TOOLS.length;

    if (count !== expected) {
      return {
        result: {
          ok: false,
          summary: `tools/list returned ${count} tools — expected ${expected}`,
          remediation:
            `The MCP server started but registered ${count} of ${expected} tools.\n` +
            'This usually means a code-level mismatch between cli.ts/server.ts\n' +
            'and tools.ts in this install. Try reinstalling: rm -rf node_modules\n' +
            '&& npm install. If the problem persists, file an issue at\n' +
            'https://github.com/SoapyRED/freightutils-mcp/issues with the output\n' +
            'of `npx freightutils-mcp ping`.',
        },
        client,
      };
    }

    return {
      result: {
        ok: true,
        summary: `server freightutils-mcp@${pkg.version} initialized; tools/list returned ${count} tools`,
      },
      client,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: {
        ok: false,
        summary: `handshake failed — ${msg}`,
        remediation:
          'The MCP server could not handshake in-process. This usually means\n' +
          'a broken install. Try: rm -rf node_modules && npm install. If the\n' +
          'problem persists, the @modelcontextprotocol/sdk version may have\n' +
          'changed shape — file an issue at\n' +
          'https://github.com/SoapyRED/freightutils-mcp/issues.',
      },
      client: null,
    };
  }
}

// ─── check 3: end-to-end tool call ───────────────────────────────

async function checkToolCall(client: Client): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await client.callTool(
      {
        name: 'cbm_calculator',
        arguments: { length_cm: 120, width_cm: 80, height_cm: 100 },
      },
    );
    const ms = Date.now() - start;

    if (resp.isError) {
      const first = Array.isArray(resp.content) ? resp.content[0] : undefined;
      const text =
        typeof first === 'object' && first && 'text' in first && typeof first.text === 'string'
          ? first.text
          : '(no error body)';

      let remediation: string;
      if (text.includes('429') || text.toLowerCase().includes('rate')) {
        remediation =
          'Anonymous IP cap (25 requests/day) exceeded against the FreightUtils\n' +
          'website. Get a free API key at https://www.freightutils.com/api-docs\n' +
          'for 100/day or upgrade to Pro for 50,000/month.\n' +
          '\n' +
          'Then set FREIGHTUTILS_API_KEY in the environment that runs this\n' +
          'MCP server (your MCP client config or shell). v2.3.0+ forwards\n' +
          'the key on every outbound call so the same key honored by the\n' +
          'remote /api/mcp transport now flows through the stdio path too.';
      } else if (text.includes('ENOTFOUND') || text.toLowerCase().includes('network')) {
        remediation =
          'A network error prevented the tool from reaching the backend.\n' +
          'Same diagnosis as check 1 — see remediation there.';
      } else {
        remediation =
          'The tool returned isError=true. Tool error body:\n' +
          `  ${text.slice(0, 240)}\n` +
          'If this is unexpected, file an issue at\n' +
          'https://github.com/SoapyRED/freightutils-mcp/issues with this output.';
      }

      return {
        ok: false,
        ms,
        summary: `cbm_calculator returned isError — ${text.slice(0, 100)}`,
        remediation,
      };
    }

    const first = Array.isArray(resp.content) ? resp.content[0] : undefined;
    const text =
      typeof first === 'object' && first && 'text' in first && typeof first.text === 'string'
        ? first.text
        : '';

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        ms,
        summary: 'cbm_calculator returned non-JSON text',
        remediation:
          'The tool succeeded but the response body was not JSON. Likely a\n' +
          'transient backend deploy. Re-run ping in 60s; if still failing,\n' +
          'file an issue at https://github.com/SoapyRED/freightutils-mcp/issues.',
      };
    }

    // Accept either snake_case (REST canonical) or camelCase (current MCP
    // tool shape — drift tracked separately, see PR description).
    const total =
      (typeof parsed.total_cbm === 'number' && parsed.total_cbm) ||
      (typeof parsed.totalCbm === 'number' && parsed.totalCbm) ||
      null;

    if (total === null) {
      return {
        ok: false,
        ms,
        summary: `cbm_calculator response missing total_cbm/totalCbm field (keys: ${Object.keys(parsed).slice(0, 6).join(', ')})`,
        remediation:
          'The tool succeeded but the response shape is not what ping expects.\n' +
          'The backend or this package may have changed. Try `npm install -g\n' +
          'freightutils-mcp@latest` to pick up the latest published version.',
      };
    }

    if (Math.abs(total - 0.96) > 0.01) {
      return {
        ok: false,
        ms,
        summary: `cbm_calculator returned total=${total} — expected 0.96 ±0.01`,
        remediation:
          'The tool returned an unexpected numeric value. This is the kind of\n' +
          'thing the daily customer-experience smoke catches; file an issue at\n' +
          'https://github.com/SoapyRED/freightutils-mcp/issues with this output\n' +
          'if you see it.',
      };
    }

    return {
      ok: true,
      ms,
      summary: `cbm_calculator → total=${total} m³ (expected 0.96)`,
    };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      ms,
      summary: `tool call threw — ${msg}`,
      remediation:
        'The MCP client could not invoke the tool. If check 1 passed but this\n' +
        'fails, the issue is likely in this package — file an issue at\n' +
        'https://github.com/SoapyRED/freightutils-mcp/issues with the output of\n' +
        '`npx freightutils-mcp ping`.',
    };
  }
}

// ─── auth tier reporting ─────────────────────────────────────────
//
// New in v2.3.0: report the observed tier this install is running as. When
// FREIGHTUTILS_API_KEY is set we verify it against /api/auth/whoami and
// surface "Authenticated as <tier>". When unset we surface the anonymous
// cap so the user knows they're on the free path.
//
// This is an additional reported line, not a 4th check — failure to verify
// an API key does not flip the overall ping exit code, because the three
// existing checks already prove the install is functionally working. The
// auth line is informational with its own success indicator.

interface AuthLine {
  text: string;
  symbol: string;
}

async function reportAuthStatus(): Promise<AuthLine> {
  const key = process.env.FREIGHTUTILS_API_KEY;
  if (!key) {
    return {
      symbol: WARN,
      text: 'Anonymous (25/day cap) — set FREIGHTUTILS_API_KEY in your environment to lift the cap. See https://www.freightutils.com/pricing.',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(WHOAMI_URL, {
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + key },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        symbol: WARN,
        text: `API key set but verification failed (HTTP ${res.status} from ${WHOAMI_URL}). Check the key at https://www.freightutils.com/pricing.`,
      };
    }

    const body = (await res.json()) as { authenticated?: boolean; tier?: string };
    if (!body.authenticated || !body.tier) {
      return {
        symbol: WARN,
        text: 'API key set but server reports unauthenticated. Verify the key at https://www.freightutils.com/pricing.',
      };
    }

    const tierLabel = body.tier.charAt(0).toUpperCase() + body.tier.slice(1);
    return {
      symbol: TICK,
      text: `Authenticated as ${tierLabel}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      symbol: WARN,
      text: `API key set but verification call failed — ${msg}. Tools will still attempt the call with the key.`,
    };
  }
}

// ─── runPing ─────────────────────────────────────────────────────

export async function runPing(): Promise<number> {
  console.log(bold('FreightUtils MCP Diagnostic'));
  console.log(dim('───────────────────────────'));
  console.log(dim(`package: freightutils-mcp@${pkg.version}`));
  console.log(dim(`health:  ${HEALTH_URL}`));
  const auth = await reportAuthStatus();
  console.log(`auth:    ${auth.symbol} ${auth.text}`);
  console.log();

  let failures = 0;

  const r1 = await checkBackendHealth();
  printCheck(1, 3, `Backend health (${HEALTH_URL})`, r1);
  if (!r1.ok) failures += 1;

  const { result: r2, client } = await checkMcpHandshake();
  printCheck(2, 3, 'MCP handshake (in-process via InMemoryTransport)', r2);
  if (!r2.ok) failures += 1;

  let r3: CheckResult;
  if (client) {
    r3 = await checkToolCall(client);
    try { await client.close(); } catch { /* ignore */ }
  } else {
    r3 = {
      ok: false,
      summary: 'skipped — MCP handshake failed (see check 2)',
    };
  }
  if (!r3.ok) failures += 1;
  printCheck(3, 3, 'End-to-end tool call (cbm_calculator l=120 w=80 h=100)', r3);

  if (failures === 0) {
    console.log(green(bold('All checks passed.')) + ' Your FreightUtils MCP install is working.');
    console.log(dim('Docs: https://www.freightutils.com/api-docs#mcp-setup'));
    return 0;
  }

  console.log(red(bold(`${failures} of 3 checks failed.`)) + ' See remediation under each ✗ above.');
  console.log(dim('Docs: https://www.freightutils.com/api-docs#mcp-setup'));
  console.log(dim('File an issue: https://github.com/SoapyRED/freightutils-mcp/issues'));
  return 1;
}
