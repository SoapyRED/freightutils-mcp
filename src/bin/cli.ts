#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../server.js';
import { ANONYMOUS_DAILY_LIMIT, startupNotice } from '../notices.js';
import { scopeFromArgs } from '../scopes.js';

function printHelp(): void {
  process.stdout.write(
    [
      'freightutils-mcp — FreightUtils MCP Server',
      '',
      'USAGE',
      '  npx freightutils-mcp              Start the stdio MCP server (default; the mode',
      '                                    MCP clients like Claude Desktop / Cursor use)',
      '  npx freightutils-mcp ping         Run the install diagnostic (3 checks; exits',
      '                                    non-zero on any failure with remediation hints)',
      '  npx freightutils-mcp --help       Show this help',
      '  npx freightutils-mcp --version    Print the package version',
      '  npx freightutils-mcp --scope dg   Serve only one scope: dg (dangerous goods), customs or ops;',
      '                                    all (default) serves every tool. Also FREIGHTUTILS_SCOPE.',
      '',
      'ENV',
      '  FREIGHTUTILS_API_KEY=<key>        Your API key, sent as Authorization: Bearer.',
      `                                    Unset = the anonymous tier (${ANONYMOUS_DAILY_LIMIT} requests/day`,
      '                                    per IP); the server says so once, on stderr',
      '  FREIGHTUTILS_API_URL=<base>       Override the website API base (default:',
      '                                    https://www.freightutils.com/api)',
      '  FREIGHTUTILS_TIMEOUT_MS=<ms>      Per-call timeout (default 30000)',
      '  NO_COLOR=1                        Disable ANSI colour in `ping` output',
      '',
      'DOCS  https://www.freightutils.com/api-docs#mcp-setup',
      '',
    ].join('\n'),
  );
}

async function main() {
  const arg = process.argv[2];

  if (arg === 'ping') {
    // Dynamic import: keeps the cold-start cost of the diagnostic out of the
    // default stdio-server path. MCP clients launch this binary on every
    // session and don't pay for the diagnostic-only imports.
    const { runPing } = await import('../ping.js');
    const code = await runPing();
    process.exit(code);
  }

  if (arg === '--help' || arg === '-h' || arg === 'help') {
    printHelp();
    process.exit(0);
  }

  if (arg === '--version' || arg === '-v') {
    // createRequire keeps package.json out of the rootDir without TS6059.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version: string };
    process.stdout.write(pkg.version + '\n');
    process.exit(0);
  }

  // Default — start the stdio MCP server. MCP clients communicate via stdin/stdout, so the
  // anonymous-tier notice goes to stderr, once, before the transport starts.
  const notice = startupNotice();
  if (notice) process.stderr.write(notice + '\n');
  const scope = scopeFromArgs(process.argv.slice(2), process.env);
  if (typeof scope !== 'string') {
    process.stderr.write(scope.error + '\n');
    process.exit(2);
  }
  const server = createServer({ scope });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('FreightUtils MCP server failed to start:', err);
  process.exit(1);
});
