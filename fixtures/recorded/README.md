# Recorded-mode fixtures

Public observations, captured once and committed so every source works offline. Recorded mode
rebases their times to the world anchor, so the Q&A truths and replays stay byte-stable.
Fleet vessels are always simulated; these files feed public traffic, congestion, hazards and
the route optimiser's weather only.

| File | Source | Captured | Contents |
| --- | --- | --- | --- |
| `ais-capture.jsonl` | AISStream.io WebSocket, `demo` boxes (Gibraltar strait, Rotterdam approaches, Malta, Saronic Gulf, Port Said) | 2026-11-15 ~22:55 UTC, 600 s (Phase 6) | 3 675 messages: 2 031 `PositionReport`, 1 644 `ShipStaticData` (1 348 with a draught, 296 with draught 0 = unknown; 670 positions with course 360 = unknown); 1 428 MMSIs; 22 named cargo/tanker ships under way at ≥ 8 kn; 0 hazard messages. Three 600 s captures were tried for safety, aid-to-navigation and SAR messages (all subscribed); none arrived in any of them, so the labelled synthetic hazard is the only hazard in recorded mode |
| `weather-snapshot.json` | Open-Meteo Marine + Forecast APIs (no key) | 2026-11-15, forecast from 00:00 UTC | 152 sea points on a 2° grid (lat 30–56, lon −12–34; land points dropped), 80 steps of 3 h; waves, wind (kn), currents (kn) |
| `synthetic-hazards.json` | **Synthetic demo data**, not an observation | — | one hazard, 40 % along Thessaly Star's shortest sea route (south of Sardinia), radius 25 nm |

Refresh (free; AIS needs `AISSTREAM_API_KEY` in `.env`):

```bash
npm run record:weather
npm run record:ais -- --seconds 600 --bbox demo
```

`record:ais` keeps the old file and exits non-zero when a run receives no position. After a
refresh, regenerate the Q&A truths (`npm run eval:qa-golden`) and re-record the replays: the
expected route and congestion answers depend on these files.

Checks: `npm run smoke:weather` (live and stored weather both parse), `npm run smoke:ais -- --seconds 20`
(live positions received). First live smoke: 2026-11-15T19:24:56Z, 119 messages, 67 positions, 1 dropped.
