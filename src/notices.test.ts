/**
 * The anonymous-tier start-up notice (2.21.1): one line on STDERR when FREIGHTUTILS_API_KEY is
 * unset, nothing when it is set, and never a byte on stdout — the MCP protocol channel.
 * The CLI is spawned for real (the compiled dist-test/bin/cli.js), so this pins what an MCP
 * client's process sees, not just the function.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ANONYMOUS_DAILY_LIMIT, ANONYMOUS_NOTICE, startupNotice } from './notices.js';

const CLI = fileURLToPath(new URL('./bin/cli.js', import.meta.url));

test('startupNotice: the notice when the key is unset or empty, null when it is set', () => {
  assert.equal(startupNotice({}), ANONYMOUS_NOTICE);
  assert.equal(startupNotice({ FREIGHTUTILS_API_KEY: '' }), ANONYMOUS_NOTICE);
  assert.equal(startupNotice({ FREIGHTUTILS_API_KEY: 'fu_pk_test' }), null);
});

test('the notice names the anonymous tier and its limit, and the README states the same limit', () => {
  assert.match(ANONYMOUS_NOTICE, /anonymous tier/);
  assert.ok(ANONYMOUS_NOTICE.includes(`${ANONYMOUS_DAILY_LIMIT} requests per day per IP address`));
  assert.ok(!ANONYMOUS_NOTICE.includes('\n'), 'one line');
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  assert.ok(readme.includes(`**Anonymous:** ${ANONYMOUS_DAILY_LIMIT} requests/day per IP`), 'README Rate Limits line drifted from the notice');
  assert.ok(readme.includes(ANONYMOUS_NOTICE), 'the README quotes the start-up notice word for word');
});

/** Start the CLI, wait for its stderr to settle, send initialize, return what each stream held. */
function run(env: NodeJS.ProcessEnv): Promise<{ stderr: string; firstStdoutLine: string; stdoutBeforeRequest: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let stdoutBeforeRequest = '';
    let sent = false;
    const done = (firstStdoutLine: string) => { child.kill(); resolve({ stderr, firstStdoutLine, stdoutBeforeRequest }); };
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer; stderr=${stderr}`)); }, 15000);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      const i = stdout.indexOf('\n');
      if (sent && i >= 0) { clearTimeout(timer); done(stdout.slice(0, i)); }
    });
    child.on('error', reject);
    setTimeout(() => {
      stdoutBeforeRequest = stdout;
      sent = true;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'notice-test', version: '1' } } }) + '\n');
    }, 700);
  });
}

function envWithout(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FREIGHTUTILS_API_KEY;
  return env;
}

test('CLI without a key: the notice on stderr, once; stdout holds only the protocol', async () => {
  const r = await run(envWithout());
  assert.equal(r.stderr, ANONYMOUS_NOTICE + '\n');
  assert.equal(r.stdoutBeforeRequest, '', 'the server wrote to stdout before any request');
  const msg = JSON.parse(r.firstStdoutLine) as { jsonrpc?: string; id?: number; result?: { serverInfo?: { name?: string } } };
  assert.equal(msg.jsonrpc, '2.0');
  assert.equal(msg.id, 1);
  assert.equal(msg.result?.serverInfo?.name, 'freightutils-mcp');
});

test('CLI with a key: no notice at all', async () => {
  const r = await run({ ...envWithout(), FREIGHTUTILS_API_KEY: 'fu_pk_notice_test' });
  assert.equal(r.stderr, '');
  assert.equal(r.stdoutBeforeRequest, '');
  assert.equal((JSON.parse(r.firstStdoutLine) as { id?: number }).id, 1);
});
