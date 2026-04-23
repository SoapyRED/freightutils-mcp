import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ALL_TOOLS } from './tools.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'freightutils-mcp',
    version: '1.0.7',
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

  // Stub empty prompts and resources lists so clients don't receive
  // -32601 Method Not Found for list_prompts / list_resources probes.
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  return server;
}
