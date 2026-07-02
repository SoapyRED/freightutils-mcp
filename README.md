# FreightUtils MCP Server

[![npm version](https://img.shields.io/npm/v/freightutils-mcp)](https://www.npmjs.com/package/freightutils-mcp)
[![npm downloads (total)](https://img.shields.io/npm/dt/freightutils-mcp)](https://www.npmjs.com/package/freightutils-mcp)
[![npm downloads (month)](https://img.shields.io/npm/dm/freightutils-mcp)](https://www.npmjs.com/package/freightutils-mcp)
[![License: MIT](https://img.shields.io/npm/l/freightutils-mcp)](https://opensource.org/licenses/MIT)
[![FreightUtils MCP server](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp)

**The neutral freight reference layer for AI agents.**

FreightUtils is the neutral freight reference layer for AI agents — authoritative dangerous-goods, customs, location and freight-calculation data an agent can call and cite, from primary sources (ADR 2025 / UNECE, HS 2022 / WCO, IATA-regulated airline prefixes). Neutral by design: no freight to sell and no carrier to push, so an agent can trust it as ground truth regardless of who carries the load.

This [Model Context Protocol](https://modelcontextprotocol.io/) server gives AI agents access to 24 freight calculation and reference tools, covering road, air, and sea freight. Built by a UK ADR-certified freight transport planner.

Every response cites its source — a `_source` block with the authority, edition, licence and last-verified date — and the tools are deterministic, not generated answers. Reference only: never filing, booking, or legal advice, and results state when human review is required (`validate` is structural check-digit validation only; a clean `ics2_check` is not ENS acceptance; emissions figures are estimates, not audited reports).

**Website:** https://www.freightutils.com
**API Docs:** https://www.freightutils.com/api-docs

---

## Tools (24)

### Calculators
| Tool | Description |
|------|-------------|
| `ldm_calculator` | Loading metres for European and US road trailers |
| `cbm_calculator` | Cubic metres for sea freight |
| `chargeable_weight_calculator` | Air freight chargeable weight (volumetric vs actual) |
| `pallet_fitting_calculator` | Box-on-pallet optimisation with rotation |
| `container_lookup` | ISO container specs (10 types) and loading calculation |
| `unit_converter` | Weight, volume, length, and freight-specific conversions |
| `consignment_calculator` | Multi-item CBM, LDM, volumetric & mode-specific chargeable weight (sea/air/road) + advisory flags |
| `emissions_calculator` | Freight CO2e via the ISO 14083 / GLEC distance-based method — open DEFRA/EPA/ADEME factors (WTW + TTW); use actual gross mass (not chargeable/volumetric); result carries empty_running + representativeness (sea/air = low) + a summary |

### Dangerous Goods (ADR)
| Tool | Description |
|------|-------------|
| `adr_lookup` | 2,939 UNECE ADR 2025 entries |
| `adr_exemption_calculator` | ADR 1.1.3.6 small load exemption check |
| `adr_lq_eq_check` | Limited and Excepted Quantity eligibility |

### Customs & Tariff
| Tool | Description |
|------|-------------|
| `hs_code_lookup` | 6,940 Harmonized System tariff codes (HS 2022) |
| `uk_duty_calculator` | UK import duty and VAT (live GOV.UK Trade Tariff data) |
| `incoterms_lookup` | Incoterms 2020 — all 11 rules with risk/cost transfer points |
| `ics2_check` | Flag EU ICS2 unacceptable goods-description terms (stop-words) before filing an ENS — reference only |

### Reference Data
| Tool | Description |
|------|-------------|
| `airline_lookup` | 6,352 airlines with IATA/ICAO codes and AWB prefixes |
| `unlocode_lookup` | 116,129+ UN/LOCODE transport locations |
| `airport_lookup` | 85,555 airports by IATA/ICAO code, name or city (OurAirports) |
| `nearest_airport` | Nearest airports to a latitude/longitude, by great-circle distance |
| `uld_lookup` | 16 air cargo ULD types (LD3, PMC, etc.) |
| `vehicle_lookup` | 17 road freight vehicles and trailers |

### Validation
| Tool | Description |
|------|-------------|
| `validate` | Parse any text (a booking line, an email) to find & validate every container (ISO 6346), AWB (modulus-7) and IMO number in it — or validate a single identifier by type |

### Composite
| Tool | Description |
|------|-------------|
| `shipment_summary` | Chains CBM + weight + LDM + ADR + duty in one call |

### Subscription
| Tool | Description |
|------|-------------|
| `get_subscribe_link` | URL to upgrade to FreightUtils Pro (50,000/month at £19/mo) |

---

## Installation

### Claude Desktop / Claude Code (stdio)

Add to your MCP config (`claude_desktop_config.json` or `.claude/settings.json`):

```json
{
  "mcpServers": {
    "freightutils": {
      "command": "npx",
      "args": ["freightutils-mcp"]
    }
  }
}
```

### Remote HTTP / SSE

If your MCP client supports remote servers, use the canonical URL:

```
https://www.freightutils.com/api/mcp
```

> The older URL `https://www.freightutils.com/api/mcp/mcp` still works for backwards compatibility with existing clients.

No API key required to get started — anonymous calls work out of the box (see Rate Limits below).

### Authenticating with a Pro key

Anonymous usage caps at 25 requests/day per IP. If you have a free or Pro API key, set `FREIGHTUTILS_API_KEY` in the environment that runs the MCP server. The package reads it from `process.env` and attaches `Authorization: Bearer <key>` to every outbound `/api/*` call — same key the remote `https://www.freightutils.com/api/mcp` transport already honors.

stdio config example with the env var wired through:

```json
{
  "mcpServers": {
    "freightutils": {
      "command": "npx",
      "args": ["freightutils-mcp"],
      "env": {
        "FREIGHTUTILS_API_KEY": "fu_pk_xxx"
      }
    }
  }
}
```

Get a key at [freightutils.com/api-docs](https://www.freightutils.com/api-docs) (free, 100/day) or [freightutils.com/pricing](https://www.freightutils.com/pricing) (Pro, 50,000/month). Backwards compatible — unset env var preserves the existing anonymous behaviour.

---

## Verify your setup

After adding FreightUtils to your MCP client config, **fully quit and relaunch the client** (Claude Desktop, Cursor, Cline). MCP servers are only loaded at client startup; editing the config in a running session does nothing until restart.

Then run the install diagnostic from a terminal:

```sh
npx freightutils-mcp ping
```

You should see three ticks and `All checks passed`:

```
FreightUtils MCP Diagnostic
───────────────────────────
package: freightutils-mcp@2.10.0
health:  https://www.freightutils.com/api/mcp/health

[1/3] Backend health (https://www.freightutils.com/api/mcp/health)
      ✓ status=ok mcp_version=2.10.0 tools_registered=24 (143ms)

[2/3] MCP handshake (in-process via InMemoryTransport)
      ✓ server freightutils-mcp@2.10.0 initialized; tools/list returned 24 tools

[3/3] End-to-end tool call (cbm_calculator l=120 w=80 h=100)
      ✓ cbm_calculator → total=0.96 m³ (expected 0.96) (218ms)

All checks passed. Your FreightUtils MCP install is working.
```

If any check shows ✗, see [Troubleshooting](#troubleshooting) below. Exit code is 0 on all-pass and 1 on any failure, so the command works in CI / health-check scripts too.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tools not appearing in the MCP client after editing the config | Client wasn't fully restarted | Quit and relaunch (Cmd+Q on macOS / right-click → Quit on Windows tray). Closing the window is not enough. |
| `npx freightutils-mcp ping` check 1 fails with a network error | DNS, proxy, or the website is unreachable from your network | Check the status page at https://www.freightutils.com/status. If you're behind a corporate proxy, set `HTTPS_PROXY`. Override the host for `ping` with `FREIGHTUTILS_API_URL=<base-url>`. |
| `npx freightutils-mcp ping` check 2 fails | Broken local install (npx cache or stale Node version) | Re-install: `rm -rf ~/.npm/_npx && npm install -g freightutils-mcp` and rerun. Requires Node 18 or newer. |
| Tool calls return HTTP 429 / `"rate_limited"` | Anonymous IP cap of 25 requests/day exceeded | If you have a FreightUtils Pro API key, set `FREIGHTUTILS_API_KEY` in your environment before invoking the MCP. The package passes it through automatically on every outbound call. See https://www.freightutils.com/pricing if you need a key. |
| `"Server failed to start"` / spawn error in client logs | `npx` not on PATH, or Node older than 18 | Install Node 18+. On macOS, an absolute path in the config (`"command": "/opt/homebrew/bin/npx"`) avoids PATH issues for GUI-launched clients. |
| Specific tool returns `isError: true` | Bad input shape, or an unknown lookup key (UN number / HS code / AWB prefix not in the dataset) | The tool's error body names the offending field. Verify against the schema at https://www.freightutils.com/api-docs or call the corresponding [playground](https://www.freightutils.com/playground) endpoint to confirm the input shape. |

The full diagnostic flow lives at the [/api-docs#mcp-setup](https://www.freightutils.com/api-docs#mcp-setup) section on the website. The live backend status is callable from inside any MCP client at [GET /api/mcp/health](https://www.freightutils.com/api/mcp/health) — useful when you don't have shell access during a conversation.

---

## Rate Limits

All tools call the free FreightUtils API:

- **Anonymous:** 25 requests/day per IP
- **Free API key:** 100 requests/day (register at https://www.freightutils.com)
- **Pro:** 50,000 requests/month at £19/month

---

## Example Prompts

Once connected, your AI agent can:

- "Calculate CBM for a box 120cm × 80cm × 100cm, 24 pieces"
- "Look up UN 1203 in the ADR database"
- "Check if 200L of petrol qualifies for ADR 1.1.3.6 exemption"
- "Find the HS code for lithium batteries"
- "What does FOB mean in shipping?"
- "How many boxes of 40×30×25cm fit on a euro pallet?"
- "Calculate loading metres for 26 euro pallets on an artic trailer"
- "What's the UK import duty on laptops from China?"

---

## Data Sources

- **ADR 2025** — UNECE (licensed from Labeline.com)
- **HS 2022** — UN Comtrade (PDDL)
- **Airlines** — public IATA/ICAO data, cross-referenced
- **UN/LOCODE** — UNECE
- **UK Duty** — live GOV.UK Trade Tariff API
- **Containers/ULD/Vehicles** — ISO, IATA, and industry-standard specifications

---

## Changelog

Full release notes also on [GitHub Releases](https://github.com/SoapyRED/freightutils-mcp/releases).

### 2.4.0 — 2026-06-16
- **`consignment_calculator` → canonical consignment v1.** New transport `mode` (sea | air | road) and a canonical `lines[]` shape (each line: `quantity`, `dims {l,w,h,unit}` mm/cm/m/in, `weight {value,unit}` kg/g/t/lb, optional `description`/`hs_code`/`un_number`/`stackable`), plus an `options` object (`air_volumetric_divisor` default 6000, `container_number`, `awb_number`). The legacy flat `items[]` array (cm/kg) still works unchanged. Output gains per-line + grand totals, a `schema_version`, and advisory-only flags (implausible density, mode/option mismatch, dangerous-goods presence by UN number vs the ADR 2025 reference, ISO 6346 / IATA AWB check-digit) plus a best-effort disclaimer. Canonical schema: <https://www.freightutils.com/schema/consignment.v1.json>. **No tool-count change (19).**

### 2.1.1 — 2026-05-09
- **Fix:** `serverInfo.version` was stuck at `1.0.8` even after 1.1.0 / 2.0.0 / 2.1.0 published. The wire-level identity has been silently lying about the package version since the 1.0.7 fix. Now reads from `package.json` at runtime via `createRequire`, so the wire version always matches the npm-published release.
- **Fix:** `server.json` description undercounted tools (`"18 freight tools …"` → `"19 freight tools …, get_subscribe_link"`).
- **Tightened Zod input constraints** across `airline_lookup`, `adr_lookup`, `adr_exemption_calculator`, `adr_lq_eq_check`, `unlocode_lookup`, and `uk_duty_calculator` (regex / length / min-max on UN numbers, IATA / ICAO / AWB prefixes, ISO country codes, UN/LOCODE format). Field-level constraints take effect at the wire; `.strict()` on top-level schemas becomes wire-effective once the `server.registerTool()` migration ships in 2.2.0.

### 2.1.0 — 2026-05-01
- **New tool: `get_subscribe_link`.** Returns the FreightUtils `/pricing` URL plus tier / monthly limit / monthly price metadata. Tool description tells agents NOT to attempt checkout themselves — they hand the URL to the user. **Tool count: 18 → 19.**
- Pairs with the website-side fix wiring `/api/mcp/*` through the existing API rate-limit middleware so Pro keys are attributed against the 50,000/month bucket on MCP traffic.

### 2.0.0 — 2026-04-25 (BREAKING — input-side casing)
- **Tool input schemas migrated `camelCase` → `snake_case`** to match the response convention shipped in 1.1.0. 13 input keys renamed across `uk_duty_calculator`, `consignment_calculator`, and `shipment_summary` (e.g. `commodityCode` → `commodity_code`, `originCountry` → `origin_country`, `items[].grossWeight` → `items[].gross_weight`). Agents calling these tools with prior camelCase keys now get a Zod validation error instead of a 200. **Re-prompt or update tool-call code.**
- All other tools (`cbm_calculator`, `chargeable_weight_calculator`, `ldm_calculator`, `pallet_fitting_calculator`, `unit_converter`, ADR family, `airline_lookup`, `container_lookup`, `hs_code_lookup`, `incoterms_lookup`, `unlocode_lookup`, `uld_lookup`, `vehicle_lookup`) already used snake_case (or single-word) input keys and are unchanged.

### 1.1.0 — 2026-04-25 (BREAKING — response-side casing)
- **API responses migrated `camelCase` → `snake_case` site-wide** across `/api/unlocode`, `/api/uld`, `/api/containers`, `/api/vehicles`, `/api/consignment`, `/api/duty`. All MCP tools in this package are passthroughs, so AI agents see snake_case keys (e.g. `commodity_code`, `location_code`, `internal_length_cm`) instead of the prior camelCase forms. **Re-prompt or update parsing logic.**
- No code changes to MCP tool implementations — every tool was already a passthrough wrapper around `apiGet` / `apiPost`. Input schemas continue to declare camelCase here; 2.0.0 deliberately closes that asymmetry.
- README badges: added monthly + total npm downloads alongside the existing version + license + Glama score badges.

### 1.0.8 — 2026-04-23 (hotfix)
- **Critical fix:** revert `list_prompts` / `list_resources` stub handlers introduced in 1.0.7. The raw SDK asserts the corresponding capability must be declared before `setRequestHandler` is called — 1.0.7 threw `Server does not support prompts` at startup, crashing the MCP server on every run. 1.0.8 removes the stubs and restores boot.
- Server identity bumped: `version: '1.0.7'` → `'1.0.8'`.
- No other changes. 18 tools, annotations, `shipment_summary` descriptions, and `smithery.yaml` from 1.0.7 are preserved.

### 1.0.7 — 2026-04-22
- Add `smithery.yaml` with empty configSchema (Smithery Quality Score: config UX +25).
- Add read-only `annotations` to all 18 tools (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`) with human-readable `title` (+7).
- Add missing parameter `.describe(...)` text to `shipment_summary` (+1).
- Add stub `list_prompts` / `list_resources` handlers so probes return `{ prompts: [] }` / `{ resources: [] }` instead of `-32601 Method not found` (+5).
- Fix server identity: `name: 'FreightUtils'` → `'freightutils-mcp'`, `version: '1.0.0'` → `'1.0.7'`.
- No breaking changes. Same 18 tools, same names, same behaviour.

### 1.0.6 — 2026-04-22
- Security: bump `@modelcontextprotocol/sdk` to `1.26.0` to patch **CVE-2026-25536** (cross-client data leak via shared transport/server instance reuse). See [GHSA-345p-7cg4-v4c7](https://github.com/advisories/GHSA-345p-7cg4-v4c7).
- No user-facing API changes. Same 18 tools.

---

## Other ways to use FreightUtils

FreightUtils ships across multiple distribution surfaces. Pick the one that fits how you work:

- **Website** — interactive tools at [freightutils.com](https://www.freightutils.com)
- **REST API** — 23 endpoints, free tier (100/day) and Pro tier (50K/month, £19/mo). [API docs](https://www.freightutils.com/api-docs)
- **MCP server** — for LLM agents and AI tooling. [npm: freightutils-mcp](https://www.npmjs.com/package/freightutils-mcp) · [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=freightutils)
- **n8n custom node** — for workflow automation. [npm: n8n-nodes-freightutils](https://www.npmjs.com/package/n8n-nodes-freightutils)
- **Custom GPT** — the [FreightUtils GPT](https://chatgpt.com/g/g-69fb8fdb0a5c819182c73f8d224cc3d0) on the OpenAI GPT Store, backed by the same OpenAPI spec.

Same data, same compliance reference set (ADR 2025, HS 2022, IATA-regulated airline prefixes), every surface kept in sync.

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Marius Cristoiu](https://www.linkedin.com/in/marius-cristoiu-a853812a2/), ADR-certified freight transport planner.
