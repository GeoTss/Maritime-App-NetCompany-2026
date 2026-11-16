---
name: demo-e2e
description: Bring up the full Pharos stack with Docker Compose, reset it to the clean demo state, run and screenshot the six-step demo story with Playwright, and re-record model replays. Use before any demo, after UI or pipeline changes, and as the final Phase 7 gate.
---

# Demo end-to-end

Demo story: `docs/MASTER_PLAN.md` §1. Spec: `e2e/demo.spec.ts` (one serial test, six steps). Config: `playwright.config.ts` (baseURL `:5173`, reducedMotion, 1 worker, no webServer).

## Bring up and reset

1. `docker compose build` after any change to `apps/web` or `apps/api` (the web container serves the built app).
2. `npm run demo:reset` recreates api, erp, worker and web with `DEMO_ANCHOR=2026-11-14T08:00:00Z` (pinned clock 08:05Z), `SEED_ON_BOOT=reset`, `LLM_MODE=replay`, recorded AIS and weather, `DEMO_HAZARDS=on`, and waits for readiness.
   Compose itself also defaults to this recorded, pinned demo (no key needed); `npm run demo:live` is the explicit switch to live and `npm run demo:reset` the one switch back.
3. Check: `curl -fsS localhost:4000/api/health` shows `llmMode`.

## Run the story

- `npm run demo:reset && npx playwright test` (replay: free, offline, about 13 seconds for the story).
- Always reset first: the story delivers the inbox, plans routes and approves proposals, so it needs a fresh world.
- Screenshots go to `test-results/story/` by default. `STORY_SCREENSHOTS=docs npx playwright test` writes the committed set `docs/screenshots/phase-6/story-<n>-<name>.png` instead; do that only to refresh it deliberately. Look at the screenshots before reporting success. Before the step-6 shot the story waits (up to 15 s) for the step-5 toasts to clear.
- Per-step timings: `test-results/story-timings.json` is `{ mode, stopAfter, steps: [{ step, ms }], ...notes }` (first progress = the turn's status label shows tools called; answer = the gate line, both timed from the click), written pass or fail. Replay timings are not live latencies: they only show the UI is fast. Judge latency against MASTER_PLAN §6 from live runs: the live story's timings file and the Q&A and extraction evals.
- The test's first action asserts `/api/health` `llmMode` against `STORY_MODE`, so a story never runs against the wrong stack; in `live` and `record` it also asserts `extractModel` and `agentModel` are both `claude-haiku-5-5`. `STORY_STOP_AFTER=map` skips this llmMode and model check.
- The test fails on any request to a host other than localhost and on any console error, checked after the map when `STORY_STOP_AFTER=map` returns, after the live preflight, and at the end.

## Story modes (`STORY_MODE`)

| Mode | Stack | Model | Cost |
| --- | --- | --- | --- |
| `recorded` (default) | `npm run demo:reset` (pinned clock 08:05Z, recorded AIS and weather) | replayed, `llmMode` replay | free |
| `record` | `LLM_MODE=record npm run demo:reset` | replay-first; a miss calls the model and writes | paid on a miss |
| `live` | `npm run demo:live` (wall clock, live AIS and weather, live model) | live, `llmMode` live | paid (about $0.01 to $0.03) |

- `recorded` and `record` make the identical requests in the identical order (the determinism rule below).
- `live` is the same spec with live expectations: two live badges, unpinned clock, a free preflight before step 2 (`/api/sources` has both sources `live` and no "socket down" AIS detail; `/api/hazards` has `synthetic:1`; `POST /api/route-plan` for Aegean Pioneer has a feasible non-baseline option, else it fails with "live conditions block every route: report, not a product fix"), exactly one recommended route that is not row A, and a public ship that is the first plannable of up to five named non-fleet ships south of 45N. Screenshots go to `test-results/story-live/`; the Playwright timeout is 10 minutes.
- Live step 2 is looser than recorded (0 pending, the Algeciras email in needs_review, its written quantity containing 300 and 350): a live model may write the as-written span differently; the exact "300/350 mt" and the 1 needs_review / 2 extracted counts are recorded/record only. The live preflight also plans a route to Rotterdam for the chosen public ship and asserts Aegean Pioneer's best route is not A.
- `STORY_MODE=live` needs `npm run demo:live` first. Free rehearsal: `LLM_MODE=replay npm run demo:live && STORY_MODE=live STORY_STOP_AFTER=map npx playwright test` (live AIS and weather, replayed model: only the map step can run, unrecorded questions miss; it skips the llmMode and model check, so it passes on a replay-model stack). Never run `STORY_MODE=live` or `record` without `STORY_STOP_AFTER=map` unless the spend is approved. Switch back with `npm run demo:reset`.
- Step 6 reads `/api/eval/summary` and expects one visible `section[data-suite][data-split]` per published entry (two dev entries, four after the held-out run).

## Determinism rule

The pinned clock makes request keys stable: the same requests in the same order give the same replay key. So the story does the same actions in the same order every run: no optional branches, no extra POSTs, route plans (`POST /api/route-plan` stores a calculation) only where the story plans them. A replay miss means the story changed. Never assert an ERP key (PO number, draft reference, audit detail) byte-for-byte.

While a route tray is open the rest of the page is hidden from the accessibility tree: use labels or `nav a[href=...]` locators there, not role queries.

## Re-record replays

Recordings live in `fixtures/llm-recordings/` (api container bind-mounts it). Only after prompts and tools are final, and with the key in the project `.env` (never print it):

1. Budget check: `npm run eval:ledger total` (the story costs about $0.01 to $0.03 on Haiku).
2. `LLM_MODE=record npm run demo:reset && npx playwright test`. Record mode is replay-first: a request whose recording exists is served from it (free, never overwritten), and only a miss calls the model and writes. Recordings shared by several flows (the demo ask and the story send a byte-identical first request) therefore survive. To force a fresh sample, delete that recording file first. Fix spec bugs using replay (free).
3. Sum `costUsd` of the rows with mode `record` only (rows served from a recording show mode `replay` and a notional cost) from `GET /api/llm-calls` and ledger it: `npm run eval:ledger add -- --run demo-story-record --label phase6-story --cost <usd>`.
4. `npm run demo:reset && npx playwright test` twice: both must pass with no `replay miss` in `docker compose logs api`.
5. Leave the stack in replay (`npm run demo:reset`), commit new recordings.

A prompt edit invalidates the recordings: the replay layer fails loudly on a miss.

## Report

Per demo step: pass/fail, screenshot path, timing against the master plan §6 targets.
