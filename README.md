# FreightUtils MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI agents access to 17 freight calculation and reference tools.

## Tools

| Tool | Description |
|------|-------------|
| `cbm_calculator` | Calculate cubic metres (CBM) for sea freight |
| `chargeable_weight_calculator` | Air freight chargeable weight (volumetric vs actual) |
| `ldm_calculator` | Loading metres for European road freight |
| `consignment_calculator` | Multi-item consignment calculator (combined LDM/CBM/chargeable weight) |
| `pallet_fitting_calculator` | Box-on-pallet fitting with layers and rotation |
| `container_lookup` | ISO container specs and loading calculation |
| `unit_converter` | Convert between freight units (weight, volume, length) |
| `adr_lookup` | Dangerous goods lookup (ADR 2025, 2,939 entries) |
| `adr_exemption_calculator` | ADR 1.1.3.6 small load exemption calculator |
| `hs_code_lookup` | Harmonized System tariff codes (6,940 codes) |
| `incoterms_lookup` | Incoterms 2020 trade rules |
| `uk_duty_calculator` | UK import duty & VAT estimator (live GOV.UK data) |
| `airline_lookup` | Search 6,352 airlines by name, IATA/ICAO code, AWB prefix |
| `unlocode_lookup` | UN/LOCODE location codes (116,129 locations) |
| `uld_lookup` | Air cargo ULD types (15 Unit Load Devices) |
| `vehicle_lookup` | Road freight vehicle & trailer types (17 EU/US vehicles) |
| `shipment_summary` | Composite shipment analysis — chains multiple tools in one call |

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
https://www.freightutils.com/api/mcp/mcp
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
- *"What are the specs of an AKE (LD3) ULD container?"*
- *"What's the payload of a standard 13.6m curtainsider?"*
- *"Estimate UK import duty on HS 847989 from China, value £10,000"*
- *"Find the UN/LOCODE for Rotterdam"*
- *"Get a full shipment summary for 6 pallets going road from Hamburg to Felixstowe"*

## API

All tools call the free [FreightUtils API](https://www.freightutils.com/api-docs). No API key required. Courtesy rate limit: 100 requests/day per IP.

## License

MIT
