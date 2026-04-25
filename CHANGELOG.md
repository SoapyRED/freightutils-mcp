# Changelog

## 1.1.0 — 2026-04-25

### Underlying API change (passes through to MCP responses)

The FreightUtils REST API now returns `snake_case` response fields site-wide. Six endpoints were migrated from `camelCase`: `/api/unlocode`, `/api/uld`, `/api/containers`, `/api/vehicles`, `/api/consignment`, `/api/duty`. All MCP tools in this package are passthrough — they forward the API response verbatim, so AI agents using these tools now see snake_case keys (e.g. `commodity_code`, `location_code`, `internal_length_cm`) instead of the prior camelCase forms.

**This is a breaking change for agents that pattern-matched on the old camelCase keys.** Re-prompt or update parsing logic to use the new snake_case forms. The website CHANGELOG entry on 2026-04-25 has the complete per-endpoint old → new field rename table.

### MCP-side work

- No code changes to tool implementations — every tool was already a passthrough wrapper around `apiGet` / `apiPost` (verified by static audit of `src/tools.ts`).
- Tool input schemas unchanged. The `uk_duty_calculator` tool continues to declare `commodityCode`/`originCountry`/`customsValue` etc. on input; the FreightUtils API still accepts both the camelCase and snake_case forms on POST `/api/duty`, so existing agent prompts continue to work. A future v2.0.0 may align the input schemas to snake_case as a deliberate breaking change.

### Docs

- README badges: added monthly + total npm downloads alongside the existing version + license + Glama score badges.

## 1.0.8 — 2026-04-21

Maintenance release synced with website MCP v1.0.8 (serverInfo + mirror — matches hotfix npm release).

## 1.0.7 — earlier

Smithery score fixes + root smithery.yaml.

## 1.0.6 — earlier

CVE-2026-25536 — sync to patched MCP SDK 1.26.0.
