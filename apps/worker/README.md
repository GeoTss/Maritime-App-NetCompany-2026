# Pharos worker

Long-running process that keeps the live-data tables fresh.

## Modes

| Variable | Values | Default |
| --- | --- | --- |
| `AIS_MODE` | `live` (AISStream), `replay` (loops `fixtures/recorded/ais-capture.jsonl`), `off` | `replay` |
| `WEATHER_MODE` | `live` (Open-Meteo, falls back to the snapshot on failure), `recorded` | `recorded` |
| `DATABASE_URL` | Postgres URL | required |
| `AISSTREAM_API_KEY` | AISStream key (trimmed; whitespace only counts as unset); `AIS_MODE=live` without it logs one line and runs `replay` | unset |
| `DEMO_HAZARDS` | `on` also loads the labelled synthetic demo hazard with live AIS; `replay` always loads it, `off` AIS never does | `off` |

In Docker Compose the stack defaults to the recorded, pinned demo (`AIS_MODE=replay`, `WEATHER_MODE=recorded`, `DEMO_HAZARDS=on`, `DEMO_ANCHOR` 2026-11-14T08:00:00Z). `npm run demo:live` switches it to live AIS and weather on the wall clock; `npm run demo:reset` switches back.

Keys are never logged.

## What it writes

- `ais_traffic` and, for fleet MMSIs, `vessel_positions`: positions from the AIS provider and from the
  fleet simulator (every 60 s, placed by the domain route maths); throttled per MMSI.
- `port_congestion` (source `ais`): every 5 minutes, from traffic seen in the last 30 minutes.
- `nav_hazards`: hazards from AIS safety traffic (distress beacons, SAR aircraft, virtual aids to
  navigation, safety messages), plus the labelled synthetic demo hazard (`synthetic:1`, from
  `fixtures/recorded/synthetic-hazards.json`) when `DEMO_HAZARDS` allows it.
- `weather_snapshots`: at start and every 6 hours.
- `source_status`: `ais` and `weather` rows saying `live` or `recorded`.

## Baseline restore

The API reseeds on boot (`SEED_ON_BOOT=reset` truncates every table, the live ones included). At
start and every 5 minutes the worker calls `ensureLiveBaseline` (packages/integrations): it stores a
weather snapshot when there is none, puts back the synthetic hazard row when it is enabled and
missing, and writes the `ais` and `weather` source rows when they are missing. Existing rows are
left alone, so a call with nothing missing writes nothing. When the baseline stored the snapshot at
start, the 6-hourly weather refresh waits one interval before its first run.

A provider error is logged and the provider restarted; the process never exits on one.

Run: `npm run start -w @pharos/worker` (or `docker compose up worker`).
