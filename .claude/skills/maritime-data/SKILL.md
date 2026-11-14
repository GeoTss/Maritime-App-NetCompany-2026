---
name: maritime-data
description: Regenerate or change Pharos's synthetic maritime world (ports, route legs, fleet, voyages, noon reports, suppliers, fuel prices) deterministically and validate its invariants; record or refresh the AIS capture and weather snapshot used in recorded mode. Use when seed data, demo scenario numbers, or recorded-mode fixtures need to change.
---

# Maritime data

The demo world must be **deterministic** (same seed → byte-identical data) and **internally consistent**, because evals compute expected answers from it.

## Change the synthetic world

1. Edit the scenario inputs in `packages/db/src/seed/` (never hand-edit generated rows).
2. `npm run db:seed -w @pharos/db` — reseeds the dev database. _(available from Phase 1)_
3. `npm run test -- packages/db` — runs the seed invariant tests:
   - fuel continuity: each noon report's ROB = previous ROB − consumed (per grade, ±0.1 mt);
   - ETA consistency: port-call ETAs follow leg distance ÷ planned speed from the boot anchor;
   - grade-by-zone: every leg inside a 0.1% S zone requires LSMGO;
   - the demo trap holds: the cheapest headline quote is **not** the best total-cost option.
4. If an invariant fails, fix the scenario inputs, not the test.

## Refresh recorded-mode fixtures _(Phase 5+)_

- AIS: `npm run record:ais -- --minutes 10 --bbox med` (needs `AISSTREAM_API_KEY`; if missing, tell the user which variable to set and stop this step).
- Weather: `npm run record:weather -- --route demo`.
- Commit the new files under `fixtures/recorded/` and note the capture time in `fixtures/recorded/README.md`.
- Re-run Q&A evals in replay mode afterwards: expected answers depend on these snapshots.

## Never

- Never use `Math.random()` or the wall clock in seed code; use the seeded PRNG and the injected clock.
- Never put real company names or real people in synthetic data; real ships appear only as public AIS traffic.
