import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import { ALL_TOOLS, type ToolDef } from './tools.js';
import { envelopeShape } from './envelope.js';

// Read the version directly from package.json at runtime so the wire-level
// serverInfo.version stays in sync with the npm-published release. Using
// createRequire (rather than `import ... with { type: 'json' }`) keeps the
// JSON file outside the tsconfig rootDir without tripping TS6059.
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const text = (t: string) => ({ type: 'text' as const, text: t });
const errResult = (err: unknown) => ({
  content: [text(`Error: ${err instanceof Error ? err.message : String(err)}`)],
  isError: true as const,
});

/**
 * Fetch the envelope channel for a tool. The REST API builds the envelope
 * (`?envelope=1`) — this package never constructs one for REST-backed tools.
 * One retry absorbs transient blips; both attempts failing bubbles up.
 */
async function fetchEnvelope(tool: ToolDef, args: Record<string, unknown>, flat: unknown): Promise<Record<string, unknown>> {
  if (tool.localEnvelope) return tool.localEnvelope(flat);
  try {
    return await tool.handler(args, { envelope: true }) as Record<string, unknown>;
  } catch {
    return await tool.handler(args, { envelope: true }) as Record<string, unknown>;
  }
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'freightutils-mcp', version: pkg.version },
    // Declare prompts + resources capabilities up front so the low-level
    // setRequestHandler calls below are accepted (the SDK asserts a capability
    // is declared before its handler can be registered — see the historical
    // note that follows the tool loop).
    { capabilities: { prompts: {}, resources: {} } },
  );

  // Register every tool with the envelope output schema. Dual-channel result:
  //  - structuredContent = the FreightUtils v1 response envelope (validates
  //    against outputSchema; built by the REST API via ?envelope=1)
  //  - content[0].text  = the flat legacy body, BYTE-IDENTICAL to pre-2.11
  //    releases (the flat call is made first and alone determines the text
  //    channel, including error behaviour)
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
        outputSchema: envelopeShape(tool.resultSchema),
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        // 1. Flat call — the legacy channel. Errors (validation, not-found,
        //    rate-limit) keep their exact pre-2.11 shape and cost one request.
        let flat: unknown;
        try {
          flat = await tool.handler(args, { envelope: false });
        } catch (err: unknown) {
          return errResult(err);
        }

        // 2. Envelope call — the structuredContent channel.
        let env: Record<string, unknown>;
        try {
          env = await fetchEnvelope(tool, args, flat);
        } catch (err: unknown) {
          // Flat succeeded but the envelope leg failed twice (e.g. the rate
          // limit boundary fell between the two calls). outputSchema requires
          // structuredContent on success results, so surface the failure.
          return errResult(err);
        }

        // 3. Text channel — byte-identical to the previous release per tool.
        const content: { type: 'text'; text: string }[] = [];
        if (tool.richText) {
          // Pre-2.11 registerTool layout: optional summary lead, the flat
          // JSON, then the tool's own citation line.
          const summary = (flat as { summary?: unknown } | null)?.summary;
          if (typeof summary === 'string' && summary) content.push(text(summary));
          content.push(text(JSON.stringify(flat, null, 2)));
          const cite = tool.citation?.(flat);
          if (cite) content.push(text(cite));
        } else {
          // Pre-2.11 server.tool() layout: the flat JSON alone; the envelope's
          // citation line is appended as a NEW second item (content[0] is the
          // compatibility gate), mirroring the hosted /api/mcp surface.
          content.push(text(JSON.stringify(flat, null, 2)));
          const cite = (env as { citation?: { text?: unknown } }).citation?.text;
          if (typeof cite === 'string' && cite) content.push(text(cite));
        }

        return { structuredContent: env, content };
      },
    );
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
