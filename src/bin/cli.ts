#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../server.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running on stdio — MCP clients communicate via stdin/stdout
}

main().catch((err) => {
  console.error('FreightUtils MCP server failed to start:', err);
  process.exit(1);
});
