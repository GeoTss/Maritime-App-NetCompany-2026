# Phase 0 — Harness & Scaffold Implementation Plan

> **For agentic workers:** executed by the lead session (Phase 0 files are lead-owned per the master plan §8). Steps use checkbox syntax.

**Goal:** A repo where hooks enforce quality from the first edit, the workspace typechecks and tests, and `docker compose up` brings up `db`, `erp` and `api` healthy.

**Architecture:** npm workspaces; TypeScript source consumed directly (no build step; `tsx` at runtime); one root typecheck config for all Node code; Hono services; Postgres 17 in Compose.

**Tech Stack:** Node 22.12, npm 11, TypeScript 6.0, Biome 2, Vitest 5, Hono 4, Zod 4, postgres.js, unpdf 1.9, pdf-lib (fixtures only).

**Spec:** `docs/MASTER_PLAN.md` (§5 stack, §8 harness, §10 Phase 0 row).

## Global Constraints

- Node `>=22.12`; `unpdf` pinned `^1.9` (2.x needs Node 24).
- TypeScript 6.0, not 7.0 (7.0 is the native compiler; less proven with this toolchain).
- `packages/domain` is pure: no network, LLM SDK, `process.env`, `Date.now()`/argless `new Date()`, `Math.random`, `performance.now`.
- Hooks never print secret values; `.env` is never read into tool output.
- Nothing is pushed; commits are local on `build/prototype`.
- `LLM_MODE` ∈ `live | record | replay`; the API refuses to boot in `live` or `record` without `ANTHROPIC_API_KEY`.
- npm on this machine must run with `npm_config_cache=.npm-cache` (the user cache has root-owned files).

## Review Focus

1. A hook script that crashes on unexpected stdin (empty, non-JSON) must not block work — fail open with a message, except the Bash safety guard, which still blocks on a clear match.
2. Stop-gate loop: when `stop_hook_active` is true the gate must not block again.
3. `.env.example` must stay editable while `.env` is protected.
4. API boot with `LLM_MODE=replay` and no key must succeed (Phases 0–1 need no key).
5. Purity check must not flag comments or the word "fetch" inside identifiers like `prefetchPlan`.

---

### Task 1: Workspace & tooling

**Files:** `package.json`, `tsconfig.base.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `.dockerignore`, `packages/{shared,domain,db}/…`, `apps/api/…`, `services/erp-sim/…`

- [ ] Root scripts: `typecheck`, `lint`, `format`, `test`, `verify`, `check:purity`.
- [ ] Install pinned deps with the repo-local cache; `npm run verify` passes on the empty skeleton.

### Task 2: Domain purity checker

**Files:** `scripts/check-domain-purity.mjs`, `scripts/check-domain-purity.test.ts`
**Produces:** `checkSource(path: string, text: string): {line:number, rule:string, snippet:string}[]`; CLI exits 1 on any violation.

- [ ] Tests: flags `fetch(`, `Math.random()`, `Date.now()`, `new Date()`, `process.env`, `import Anthropic from "@anthropic-ai/sdk"`, `import x from "node:http"`; allows `new Date(iso)`, `prefetchPlan()`, the same words in comments, imports from `zod`, `@pharos/shared`, `@turf/*`, relative paths.

### Task 3: API config & boot guard

**Files:** `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
**Produces:** `loadConfig(env: Record<string,string|undefined>): AppConfig` throwing `ConfigError`; `createApp(deps): Hono` with `GET /api/health` → `{ status, llmMode, db }`.

- [ ] Tests: live without key throws with a message naming `ANTHROPIC_API_KEY`; replay without key returns config; invalid `LLM_MODE` throws; health route returns 200 with `db:"down"` when the db probe rejects.

### Task 4: PDF text smoke

**Files:** `scripts/make-smoke-pdf.ts`, `fixtures/smoke/sample-quote.pdf`, `apps/api/src/ingest/pdf-text.ts`, `apps/api/src/ingest/pdf-text.test.ts`, `scripts/pdf-smoke.ts`
**Produces:** `extractPdfText(bytes: Uint8Array): Promise<string>`.

- [ ] Test: text of the fixture contains `LSMGO` and `420 mt`.

### Task 5: ERP simulator skeleton

**Files:** `services/erp-sim/src/server.ts`, `services/erp-sim/src/app.ts`, `services/erp-sim/src/app.test.ts`

- [ ] Test: `GET /health` → 200 `{status:"ok"}`.

### Task 6: Compose

**Files:** `Dockerfile`, `docker-compose.yml`

- [ ] `db` (postgres:17-alpine, `pg_isready` healthcheck), `erp` (:4100), `api` (:4000, depends on healthy db) all healthy; `docker compose run --rm api npx tsx scripts/pdf-smoke.ts` prints the fixture text.

### Task 7: Claude Code harness

**Files:** `.claude/settings.json`, `.claude/hooks/*.mjs`, `.claude/hooks/hooks.test.ts`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/state/status.json`, `CLAUDE.md`

- [ ] Hook tests via piped stdin: `git push` → exit 2; `rm -rf /` → exit 2; `npm install x` from a builder `agent_type` → exit 2; `ls` → exit 0; edit `.env` → exit 2; edit `.env.example` → exit 0; Stop with a type error present → `decision: "block"`; Stop with `stop_hook_active: true` → no block.

### Task 8: Gate & commit

- [ ] `npm run verify` green; compose healthy; boot guard demonstrated; commit locally.
