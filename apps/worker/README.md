# Pharos worker

Long-running process that keeps the live-data tables fresh.

## Modes

| Variable | Values | Default |
| --- | --- | --- |
| `AIS_MODE` | `live` (AISStream), `replay` (loops `fixtures/recorded/ais-capture.jsonl`), `off` | `replay` |
| `WEATHER_MODE` | `live` (Open-Meteo, falls back to the snapshot on failure), `recorded` | `recorded` |
| `DATABASE_URL` | Postgres URL | required |
| `AISSTREAM_API_KEY` | AISStream key; `AIS_MODE=live` without it logs one line and runs `replay` | unset |

Keys are never logged.

## What it writes

- `ais_traffic` and, for fleet MMSIs, `vessel_positions`: positions from the AIS provider and from the
  fleet simulator (every 60 s, placed by the domain route maths); throttled per MMSI.
- `port_congestion` (source `ais`): every 5 minutes, from traffic seen in the last 30 minutes.
- `weather_snapshots`: at start and every 6 hours.
- `source_status`: `ais` and `weather` rows saying `live` or `recorded`.

A provider error is logged and the provider restarted; the process never exits on one.

Run: `npm run start -w @pharos/worker` (or `docker compose up worker`).
