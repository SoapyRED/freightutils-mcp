import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALL_TOOLS } from './tools.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'FreightUtils',
    version: '1.0.0',
  });

  // Register every tool
  for (const tool of ALL_TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape,
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

  return server;
}
