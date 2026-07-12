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
 * Reconstruct the flat legacy body from a bridged envelope. `result` holds
 * every flat field except the legacy `_source` block; the bridge carries that
 * block verbatim as `legacy_source`, plus `legacy_source_pos` when `_source`
 * is not the flat body's last key (ics2_check). Rule: insert at the recorded
 * position, else append. No-ops when the bridge is absent (validate has no
 * top-level `_source`) or when `result` kept its own inline `_source`
 * (emissions) — in both cases `result` IS the flat body already.
 */
function reconstructFlat(env: Record<string, unknown>): unknown {
  const result = env.result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return result;
  const legacy = env.legacy_source;
  if (legacy === undefined || '_source' in (result as Record<string, unknown>)) return result;
  const entries = Object.entries(result as Record<string, unknown>);
  const pos = typeof env.legacy_source_pos === 'number'
    ? Math.min(Math.max(env.legacy_source_pos, 0), entries.length)
    : entries.length;
  entries.splice(pos, 0, ['_source', legacy]);
  return Object.fromEntries(entries);
}

/** The bridge fields are transport plumbing — strip them so structuredContent
 *  stays the clean public v1 envelope, byte-equal to the default `?envelope=1`
 *  response (they are appended last, so removal recovers the default bytes). */
function stripBridge(env: Record<string, unknown>): Record<string, unknown> {
  const { legacy_source, legacy_source_pos, ...rest } = env;
  void legacy_source;
  void legacy_source_pos;
  return rest;
}

/** True for the HTTP error throw shape apiGet/apiPost produce (a definite
 *  upstream answer, e.g. 404/400/429) as opposed to a transient network
 *  failure, which is worth one retry before falling back to the flat call. */
const isHttpError = (err: unknown) =>
  err instanceof Error && err.message.startsWith('FreightUtils API error ');

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'freightutils-mcp', version: pkg.version },
    // Declare prompts + resources capabilities up front so the low-level
    // setRequestHandler calls below are accepted (the SDK asserts a capability
    // is declared before its handler can be registered — see the historical
    // note that follows the tool loop).
    { capabilities: { prompts: {}, resources: {} } },
  );

  // Register every tool with the envelope output schema. Dual-channel result
  // from ONE request (envelope-first, since 2.11.2):
  //  - the envelope is fetched with the legacy_source bridge
  //    (`?envelope=1&legacy_source=1`); structuredContent = that envelope
  //    with the bridge fields stripped (the clean public v1 envelope, byte-
  //    equal to the default `?envelope=1` response)
  //  - content[0].text  = the flat legacy body RECONSTRUCTED from
  //    result + legacy_source, BYTE-IDENTICAL to pre-2.11 releases
  //  - errors fall back to the flat call so error text keeps its exact
  //    pre-2.11 bytes (2 requests — the rare path; successes cost 1)
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
        let env: Record<string, unknown>;
        let flat: unknown;

        if (tool.localEnvelope) {
          // Local tools (no REST endpoint): one local call; the envelope is
          // built in-package, replicating the hosted /api/mcp one verbatim.
          try {
            flat = await tool.handler(args, { envelope: false });
          } catch (err: unknown) {
            return errResult(err);
          }
          env = tool.localEnvelope(flat);
        } else {
          // 1. Envelope-first — the ONLY request on the success path.
          try {
            env = await tool.handler(args, { envelope: true, legacySource: true }) as Record<string, unknown>;
          } catch (envErr: unknown) {
            // Transient (non-HTTP) failures get one retry before conceding.
            if (!isHttpError(envErr)) {
              try {
                env = await tool.handler(args, { envelope: true, legacySource: true }) as Record<string, unknown>;
              } catch {
                return errResult(envErr);
              }
            } else {
              // 2. Upstream said no (404/400/429…). Fall back to the flat
              //    call so the error text keeps its exact pre-2.11 bytes
              //    (the two channels' error bodies differ upstream).
              try {
                await tool.handler(args, { envelope: false });
              } catch (flatErr: unknown) {
                return errResult(flatErr);
              }
              // Flat succeeded while the envelope leg failed (e.g. the rate
              // limit boundary fell between the calls). outputSchema requires
              // structuredContent on success results, so surface the failure
              // (same behaviour as the 2.11.0/2.11.1 dual-request loop).
              return errResult(envErr);
            }
          }
          // Defensive: a 2xx envelope with ok:false does not occur upstream
          // (blocking_errors ride non-2xx statuses, which throw above), but
          // if it ever did, the flat call is the only honest text channel.
          if (env.ok === false) {
            try {
              flat = await tool.handler(args, { envelope: false });
            } catch (flatErr: unknown) {
              return errResult(flatErr);
            }
          }
        }

        // 3. Text channel — the flat legacy body, byte-identical to the
        //    previous release per tool, reconstructed from the envelope
        //    (or taken from the flat/local call on the paths above).
        //    `?? env`: a few upstream query modes predating the envelope
        //    rollout (adr ?search=/?class=, airports ?icao=) answer 2xx with
        //    the FLAT body even under ?envelope=1 — no `result` to unwrap;
        //    the response itself IS the flat channel. structuredContent then
        //    fails the SDK's output-schema validation exactly as it did on
        //    the 2.11.0/2.11.1 dual-request loop — no behaviour change.
        if (flat === undefined) flat = reconstructFlat(env) ?? env;
        const structured = tool.localEnvelope ? env : stripBridge(env);
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
          const cite = (structured as { citation?: { text?: unknown } }).citation?.text;
          if (typeof cite === 'string' && cite) content.push(text(cite));
        }

        return { structuredContent: structured, content };
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
