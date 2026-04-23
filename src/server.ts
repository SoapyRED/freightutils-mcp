import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALL_TOOLS } from './tools.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'freightutils-mcp',
    version: '1.0.8',
  });

  // Register every tool
  for (const tool of ALL_TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape,
      tool.annotations,
      async (args) => {
        try {
          const result = await tool.handler(args as Record<string, unknown>);
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  // NOTE: list_prompts / list_resources stubs were tried here via
  // server.server.setRequestHandler(...) but the SDK asserts the
  // corresponding capability must be declared first (throws
  // "Server does not support prompts"). Reverted for 1.0.8 — the
  // proper path is to declare capabilities: { prompts: {}, resources: {} }
  // in the McpServer constructor, but that interaction with mcp-handler
  // also needs validation before re-enabling. Accepting -5 pt on the
  // Smithery prompts/resources stub score until verified.

  return server;
}
