---
name: demo-e2e
description: Bring up the full Pharos stack with Docker Compose, reset it to the clean demo state, run and screenshot the six-step demo story with Playwright, and re-record model replays. Use before any demo, after UI or pipeline changes, and as the final Phase 7 gate.
---

# Demo end-to-end

Demo story: `docs/MASTER_PLAN.md` §1. Script and preflight: `docs/DEMO_SCRIPT.md` _(Phase 7)_.

## Bring up and reset

1. `docker compose up -d --build` — wait until `docker compose ps` shows every service `healthy`.
2. `curl -fsS http://localhost:4000/api/health` → `status: ok`.
3. `npm run demo:reset` — reseeds the demo world, empties the inbox, clears recommendations and orders. _(Phase 2+)_

## Run the story

- Recorded mode (free, deterministic): `LLM_MODE=replay SOURCES=recorded npx playwright test e2e/demo.spec.ts`
- Fully live once before a demo: `LLM_MODE=live SOURCES=live npx playwright test e2e/demo.spec.ts` (needs both API keys; check with the SessionStart status).
- Screenshots land in `test-results/`; look at them (or the browser pane) before reporting success.

## Re-record replays

Only as the **last** step after prompts are final: `LLM_MODE=record npx playwright test e2e/demo.spec.ts`, then commit `fixtures/llm-replays/`. A later prompt edit invalidates them — the replay layer fails loudly on a miss.

## Report

Per demo step: pass/fail, screenshot path, and timing against the latency targets in the master plan §6.
