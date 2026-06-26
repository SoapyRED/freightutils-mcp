import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import { ALL_TOOLS } from './tools.js';

// Read the version directly from package.json at runtime so the wire-level
// serverInfo.version stays in sync with the npm-published release. Using
// createRequire (rather than `import ... with { type: 'json' }`) keeps the
// JSON file outside the tsconfig rootDir without tripping TS6059.
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'freightutils-mcp', version: pkg.version },
    // Declare prompts + resources capabilities up front so the low-level
    // setRequestHandler calls below are accepted (the SDK asserts a capability
    // is declared before its handler can be registered — see the historical
    // note that follows the tool loop).
    { capabilities: { prompts: {}, resources: {} } },
  );

  // Register every tool
  for (const tool of ALL_TOOLS) {
    if (tool.outputSchema) {
      // freightutils-tool-quality bar: register with outputSchema +
      // structuredContent + a human citation line. Coexists with the legacy
      // server.tool() path below (the other tools' output-schema lift is a
      // separate sprint).
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.schema.shape,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
        },
        async (args: Record<string, unknown>) => {
          try {
            const result = await tool.handler(args);
            const content: { type: 'text'; text: string }[] = [];
            // Lead with a human-readable `summary` when the tool provides one (e.g. emissions —
            // surfaces the empty-running / actual-mass / sea-air-variance caveats, not just the
            // number), then the full JSON.
            const summary = (result as { summary?: unknown } | null)?.summary;
            if (typeof summary === 'string' && summary) content.push({ type: 'text' as const, text: summary });
            content.push({ type: 'text' as const, text: JSON.stringify(result, null, 2) });
            const cite = tool.citation?.(result);
            if (cite) content.push({ type: 'text' as const, text: cite });
            return { structuredContent: result as Record<string, unknown>, content };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
          }
        },
      );
    } else {
      server.tool(
        tool.name,
        tool.description,
        tool.schema.shape,
        tool.annotations,
        async (args: Record<string, unknown>) => {
          try {
            const result = await tool.handler(args);
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
  }

  // This server exposes tools only — no prompts, no resources. But keyless MCP
  // introspectors expect these list methods to exist: Glama builds each server
  // in a sandbox and runs initialize + tools/list + resources/list +
  // prompts/list with NO credentials. Without handlers the SDK answers -32601
  // "Method not found", which failed the Glama build and froze the listing.
  // Capabilities are declared in the constructor above, so these empty-but-
  // valid listings are accepted and all four keyless calls now succeed.
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

  return server;
}
