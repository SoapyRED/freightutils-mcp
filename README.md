# FreightUtils MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI agents access to 11 freight calculation and reference tools.

## Tools

| Tool | Description |
|------|-------------|
| `cbm_calculator` | Calculate cubic metres (CBM) for sea freight |
| `chargeable_weight_calculator` | Air freight chargeable weight (volumetric vs actual) |
| `ldm_calculator` | Loading metres for European road freight |
| `adr_lookup` | Dangerous goods lookup (ADR 2025, 2,939 entries) |
| `adr_exemption_calculator` | ADR 1.1.3.6 small load exemption check |
| `airline_lookup` | Search 6,352 airlines by name, IATA/ICAO code, AWB prefix |
| `container_lookup` | ISO container specs and loading calculation |
| `hs_code_lookup` | Harmonized System tariff codes (6,940 codes) |
| `incoterms_lookup` | Incoterms 2020 trade rules |
| `pallet_fitting_calculator` | Box-on-pallet fitting with layers and rotation |
| `unit_converter` | Convert between freight units (weight, volume, length) |

## Quick Start

### Claude Desktop / Claude Code

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

### Remote HTTP (URL-based)

If your MCP client supports remote servers:

```
https://www.freightutils.com/api/mcp
```

## Examples

Once connected, your AI agent can:

- *"Calculate CBM for a box 120cm x 80cm x 100cm, 24 pieces"*
- *"Look up UN 1203 in the ADR database"*
- *"Check if 200L of petrol qualifies for ADR 1.1.3.6 exemption"*
- *"Find the HS code for lithium batteries"*
- *"What does FOB mean in shipping?"*
- *"How many boxes 40x30x25cm fit on a euro pallet?"*
- *"Calculate loading metres for 26 euro pallets on an artic trailer"*

## API

All tools call the free [FreightUtils API](https://www.freightutils.com/api-docs). No API key required. Courtesy rate limit: 100 requests/day per IP.

## License

MIT
