# Recorded-mode fixtures

Public observations, captured once and committed so every source works offline. Recorded mode
rebases their times to the world anchor, so the Q&A truths and replays stay byte-stable.
Fleet vessels are always simulated; these files feed public traffic, congestion, hazards and
the route optimiser's weather only.

| File | Source | Captured | Contents |
| --- | --- | --- | --- |
| `ais-capture.jsonl` | AISStream.io WebSocket, `demo` boxes (Gibraltar strait, Rotterdam approaches, Malta, Saronic Gulf, Port Said) | 2026-11-15 ~22:55 UTC, 600 s (Phase 6) | 3 675 messages: 2 031 `PositionReport`, 1 644 `ShipStaticData` (1 348 with a draught, 296 with draught 0 = unknown; 670 positions with course 360 = unknown); 1 428 MMSIs; 22 named cargo/tanker ships under way at ≥ 8 kn; 0 hazard messages. Three 600 s captures were tried for safety, aid-to-navigation and SAR messages (all subscribed); none arrived in any of them, so the labelled synthetic hazard is the only hazard in recorded mode |
| `weather-snapshot.json` | Open-Meteo Marine + Forecast APIs (no key) | 2026-11-15, forecast from 00:00 UTC; Track 3 region added 2026-11-19 | 885 sea points, 80 steps of 3 h from 15 Nov 00:00 UTC; waves, wind (kn), currents (kn). The first 152 are the 2° grid of 15 Nov (lat 30–56, lon −12–34; land points dropped), byte-identical to that file. The other 733, fetched on 19 Nov and laid on the same timeline, lie within 120 nm of the sea lanes the first grid missed: round Africa, the Red Sea, the Arabian Sea and the Atlantic west of Europe (lat −38–56, lon −24–70) |
| `synthetic-hazards.json` | **Synthetic demo data**, not an observation | — | one hazard, 40 % along Thessaly Star's shortest sea route (south of Sardinia), radius 25 nm |
| `synthetic-storm.json` | **Synthetic demo data**, not an observation | — | a stationary gale west of Crete: two grid points at 8.5 m waves and 50 kn wind, laid over the recorded weather when `DEMO_STORM=on` (the Compose default; off in the evaluation world) |

Refresh (free; AIS needs `AISSTREAM_API_KEY` in `.env`):

```bash
npm run record:weather
npm run record:weather -- --region added
npm run record:ais -- --seconds 600 --bbox demo
```

`record:weather` replaces the file with the demo region; run it with `--region added` afterwards
to fetch the Track 3 points again and merge them in (paced under Open-Meteo's rate limit).

`record:ais` keeps the old file and exits non-zero when a run receives no position. After a
refresh, regenerate the Q&A truths (`npm run eval:qa-golden`) and re-record the replays: the
expected route and congestion answers depend on these files.

Phase 7 kept these files (user decision, 2026-11-16): the AIS capture of 15 Nov ~22:55 UTC and the weather snapshot
of 15 Nov. Recorded mode rebases both to the pinned clock, and a refresh would move 17 of the 65 Q&A truths and every
route replay, so the published scores describe the fixtures that ship.

Checks: `npm run smoke:weather` (live and stored weather both parse), `npm run smoke:ais -- --seconds 20`
(live positions received). First live smoke: 2026-11-15T19:24:56Z, 119 messages, 67 positions, 1 dropped.
