---
name: demo-e2e
description: Bring up the full Pharos stack with Docker Compose, reset it to the clean demo state, run and screenshot the six-step demo story with Playwright, and re-record model replays. Use before any demo, after UI or pipeline changes, and as the final Phase 7 gate.
---

# Demo end-to-end

Demo story: `docs/MASTER_PLAN.md` §1. Spec: `e2e/demo.spec.ts` (one serial test, six steps). Config: `playwright.config.ts` (baseURL `:5173`, reducedMotion, 1 worker, no webServer).

## Bring up and reset

1. `docker compose build` after any change to `apps/web` or `apps/api` (the web container serves the built app).
2. `npm run demo:reset` recreates api, erp, worker and web with `DEMO_ANCHOR=2026-11-14T08:00:00Z` (pinned clock 08:05Z), `SEED_ON_BOOT=reset`, `LLM_MODE=${LLM_MODE:-replay}`, recorded AIS and weather, `DEMO_HAZARDS=on`, and waits for readiness.
3. Check: `curl -fsS localhost:4000/api/health` shows `llmMode`.

## Run the story

- `npm run demo:reset && npx playwright test` (replay: free, offline, about 1 minute).
- Always reset first: the story delivers the inbox, plans routes and approves proposals, so it needs a fresh world.
- Screenshots go to `test-results/story/` by default. `STORY_SCREENSHOTS=docs npx playwright test` writes the committed set `docs/screenshots/phase-6/story-<n>-<name>.png` instead; do that only to refresh it deliberately. Look at the screenshots before reporting success.
- Per-step timings: `test-results/story-timings.json`. Replay timings are not live latencies: they only show the UI is fast. Judge latency against MASTER_PLAN §6 from live runs (the Q&A and extraction evals).
- Live rehearsal before a demo (paid, ask first): `LLM_MODE=live npm run demo:reset && npx playwright test`. Answers take about 45 s each; the assertions do not depend on the wording.
- The test fails on any request to a host other than localhost and on any console error.

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
