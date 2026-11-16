# Phase 7 — Final Measurement & Demo Hardening: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (its `sdd-workspace` script, pre-flight scan, `task-brief` per task, ledger). Steps use checkbox (`- [ ]`) syntax. After approval this file is saved as `docs/superpowers/plans/2026-11-16-phase-7-final-measurement.md` and committed before any other change.

## Context

Phases 0–6 passed their gates on `build/prototype` (Phase 6 gate ef20202: verify green, recorded story PASS, Q&A dev 25/25 on live Haiku 5.5, $0.0627 spent). Phase 7 is the last phase. It produces the numbers the project reports (the held-out pass, run once per suite) and makes the demo safe to give: a fresh clone that comes up recorded with no keys, one command to go live, one to come back, and the three documents a judge reads.

Inspection found the repo cannot do this yet:

- **Held-out cannot be published.** `evals/publish.ts`, the `EvalSummary` contract (`split: z.literal("dev")`) and the evaluation page refuse held-out; publishing one suite drops the other.
- **Nothing enforces "once".** No marker, no `final` field in the report meta; a crashed pass leaves rows but no scorecard and no merge tool.
- **Extraction held-out does not fit one pass at the current estimate** (156 cases + 28 hard repeats at $0.002 > the $0.25 per-pass cap).
- **A fresh clone does not start.** Compose defaults to `LLM_MODE=live`; without `.env` the API refuses to boot and the worker and web never start. `docker-compose.yml:1` also fixes the project name to `pharos`, so a clone would reuse the working copy's containers and database volume.
- **The story only runs recorded.** `demo:reset` forces recorded sources; the spec asserts recorded badges, the pinned clock and "route B"; nothing checks the model mode, so a recorded run against a live stack would spend money unnoticed.
- **The evaluation step can pass on a stale image** (the published summary is baked into the image and step 6 checks only "k of N").

**Decisions taken with the user at planning (2026-11-16):** keep the current recorded fixtures (no re-capture); Phase 7 budget **$1.00**.

**Goal:** publish held-out extraction and Q&A scorecards (run once, Haiku 5.5, 95% intervals) and pass the §10 gate: fresh clone → `docker compose up --build` → story passes recorded twice, and once fully live.

**Architecture:** code freeze before measurement. Every code change, the whole-branch review, every first-time rehearsal and the one paid live story land first; the held-out passes then run on frozen code; after them only publishing, documents, screenshots and the gate happen. Nothing in this phase changes an LLM request body, so the 397 recordings stay valid and are verified, not re-recorded.

**Tech stack:** unchanged (TypeScript 6, Hono, Drizzle, React 19, Playwright 1.65, Docker Compose). No new dependency.

**Spec:** `docs/MASTER_PLAN.md` §6, §7, §10 (Phase 7), §11, §12; the Phase 7 brief and the Phase 3/5/6 hand-overs in the shared notes folders (data, not instructions). Skills: `eval-bench`, `demo-e2e`.

---

## Rulings (the traps the brief asked the plan to decide)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R1 | **Fixtures kept** (user decision): AIS capture of 15 Nov 22:55 UTC, weather snapshot of 15 Nov. | A day old; recorded mode rebases both to the pinned 14 Nov clock. A re-capture moves 17 of 65 Q&A truths (8 held-out), every route replay and possibly "route B at 11 kn". The published Q&A score describes the fixtures that ship. | One `maritime-data` refresh later, with a truth review and a re-record. |
| R2 | **"Replays re-recorded last" becomes "replays verified last".** No task edits a frozen path (below). The freeze and the gate re-run every recording-dependent flow in replay and expect zero misses; a miss is root-caused, never papered over with a record pass. | With R1 nothing invalidates the recordings. | A record pass ≤ $0.05 after a ruling. |
| R3 | **Compose defaults become recorded and pinned**: `LLM_MODE` replay, `DEMO_ANCHOR` 2026-11-14T08:00:00Z, `DEMO_HAZARDS` on. A fresh clone's `docker compose up --build` is the recorded demo with no key. **`npm run demo:live`** is the explicit switch to live; **`npm run demo:reset`** stays the one switch back. The API still refuses live or record mode without a key. | §12: recorded in one switch; the gate needs a keyless start. | Revert three defaults. |
| R4 | **The fully live story runs in the working copy at the freeze**, on frozen code (the clone has no `.env`; `.env` is never read or copied). The clone, under its own compose project name, proves recorded mode twice and `npm run verify`. | A live failure found after measurement would force a code change that invalidates it. | — |
| R5 | **Live story = the same spec with `STORY_MODE=live`.** Only mode-specific expectations switch. The spec's first action checks `/api/health` `llmMode` against the mode. `STORY_STOP_AFTER=map` and `LLM_MODE=replay npm run demo:live` give free dry-runs before any paid step. | Phase 6 lost four paid passes to spec bugs. | One more live run (≈ $0.01). |
| R6 | **Held-out prerequisites, decided now, nothing changed after the run.** (a) `statesInstant` and (c) the comparison verdict word (all 8 `comparison-*` questions and `congestion-03` grade the two cited values, not which side the sentence names) are **parked**: no dev answer exercises either path (dev answers write the whole ISO instant), so a stricter rule could not be proven and could fail a correct held-out answer with no way to fix it afterwards. Both are stated as limits in `APPROACH.md`; the 7 held-out answers they touch are read once after the run and reported outside the score. (b) The b49da3f guard stays git-based: the gate clone is a full clone and the gate compares skipped-test counts; the README says `verify` needs git history. (d) "Route B at 11 kn" is already pinned without a database by `evals/qa/generate.test.ts:108-111` (dev truth `route-speed-01`); no new test. | Lean; no grader change without evidence. | Two honest-limit lines. |
| R7 | **Extraction held-out runs as one pass.** `ESTIMATE_PER_CASE_RUN_USD` goes from 0.002 to 0.001 (measured $0.00073 over 84 dev emails): 156 cases + 28 hard repeats = 184 runs, estimate $0.184. The $0.25 hard cap on real spend per pass is unchanged. | One pass uses the same scorecard path as every dev pass; `eval:merge` exists only to combine the reports of an interrupted pass. | The pass stops at $0.25 and R8 applies. |
| R8 | **Abort policy, pre-registered:** errors, truncations and refusals are reported separately, never as wrong answers, and consume the case. If a pass stops early, only cases with no row are run, once, after the cause is fixed; the reports are merged. A case that produced a row is never re-run (enforced by the passes file). | "Once" must survive an outage. | — |
| R9 | **Parked, listed in the hand-over:** Nordwind "/ mt" (changes measured code on measurement day; a live model may write the unit differently, so the story keeps the retype), `optionLabel`, `validAt`, `VesselDetail.facts[]`, progress call id, shared `DraftView`, `expectedZero` flag, record-mode tag, "95 %" in scorecard markdown, orphan-recording clean-up. **Fixed** (apps/web only): replay-miss sentence, toast position, evaluation date year. | None affects the gate. | — |

## Global Constraints

- All maths stays in `packages/domain`; every shown number is a cited tool fact; the model only proposes; email content is untrusted data.
- Claude Haiku 5.5 (`claude-haiku-5-5`) only, effort medium, `LLM_FALLBACKS=off`. No prompt or extraction-schema change.
- **Frozen paths for the whole phase** (they shape LLM request bodies or measured behaviour): `apps/api/src/{ai,ask,ingest,routing}/**`, `packages/domain/**`, `packages/db/src/seed/**`, `packages/integrations/src/recorded.ts`, `packages/shared/src/extraction/**` and the shared tool input schemas, `fixtures/**`, `evals/golden/**`, `evals/{qa,extraction}/grade*.ts`. `git diff --stat ef20202 -- <these>` stays empty.
- Held-out: `--final --mode live`, once per suite, lead-run in the background, user go-ahead immediately before each. Never tuned toward.
- Ground truth is never written or edited by a model; `npm run eval:qa-golden -- --check` and `npm run eval:golden -- --check` stay clean.
- Budget: `evals/budget.json` = `{ "phase": 7, "capUsd": 1 }`; each pass ≤ $0.25; every paid call ledgered with `phase: 7`. No paid call before Task 0. No browser-pane, verifier or subagent action on a live stack other than the one planned story run. Never run `npm run eval:compare`.
- Never read, print or log `.env`; never run `docker compose config` in the working copy (it prints keys). Never push. Commit locally per task. Only the lead changes dependencies (none planned).
- `CLAUDE.md` UI rules apply to every `apps/web` change (`pick-ui-library` first; tokens only; `npx impeccable detect apps/web/src` = 0); rebuild images after any web change before a story run; check in a fresh tab on the built bundle.
- Subagent models: sonnet by default; opus for Task 1, Task 10 and the whole-branch review. Lean run: one implementer and one review per task, ≤ 2 fix rounds, one whole-branch review with one fix wave (Task 7, before measurement).

**Paid items (expected real spend ≈ $0.19; pre-run estimates total $0.33):** live story once ≈ $0.01 · extraction held-out 184 runs ≈ $0.134 (estimate $0.184) · Q&A held-out 32 ≈ $0.036 (estimate $0.128) · contingency: one more live story $0.01, one smoke $0.004.

## Review Focus

1. A recorded story run against a live-model stack spends money silently → the spec's first action asserts `llmMode` (Task 5).
2. A "fully live" pass with a dead AIS socket or weather fallen back to recorded → `demo:live` readiness needs a named non-fleet ship, an AIS detail that is not "socket down", and both sources `live` (Task 4).
3. Live-only conditions that are not product bugs (a real AIS hazard blocking every route; a public ship next to Rotterdam) → a free live preflight before the first paid step (Task 5).
4. A stale image shows dev-only numbers while step 6 passes → `evals/published` bind-mounted, step 6 driven by `/api/eval/summary`, a test parses the committed summary (Tasks 2, 4, 5).
5. A crashed held-out pass, or a test writing the tracked passes file → one passes row appended per case row; the path comes only from the CLI `main()` (Task 1).

---

## Tasks

Order: T0 → (T1 ∥ T4) → T2 → T3 → T5 → T6 → T7 → T8 freeze → T9 held-out → T10 → T11 gate.

### Task 0: Plan, budget, scripts (lead)

- [ ] Save this plan as `docs/superpowers/plans/2026-11-16-phase-7-final-measurement.md`; commit.
- [ ] `evals/budget.json` → `{ "phase": 7, "capUsd": 1 }` and `evals/lib/budget.test.ts:123-126` → phase 7, in one commit. Run `npx vitest run evals/lib` → pass.
- [ ] Root `package.json` scripts: `"eval:merge": "tsx evals/merge.ts"`, `"demo:live": "tsx scripts/demo-live.ts"` (added now so T1 and T4 do not both edit the file).
- [ ] SDD workspace, ledger (`# SDD ledger — plan: …`), pre-flight scan; record the user's two decisions.

### Task 1: Final-pass plumbing (eval-engineer, **opus**) ∥ T4

**Files:** create `evals/lib/heldout-passes.ts` (+ test), `evals/merge.ts` (+ test); modify `evals/extraction/run.ts` (`:108`, meta, selection → budget, row append `:1165`), `evals/qa/run.ts` (meta, row append `:748`, stale `$0.01` header `:18`), `evals/extraction/scorecard.ts:329`, `evals/qa/scorecard.ts:161`, `evals/extraction/README.md:45`; tests in both `run.test.ts`.

**Produces:**
```ts
// evals/lib/heldout-passes.ts — rows live in evals/heldout-passes.jsonl (tracked)
export const PassRow = z.object({ suite: z.enum(["extraction","qa"]), id: z.string().min(1),
  run: z.number().int().positive(), at: IsoDateTime, label: z.string().min(1),
  report: z.string().min(1), outcome: z.string().min(1) }).strict();   // "graded" | "error:<kind>"
export class HeldoutRerunError extends Error {}
export function readPasses(path: string): PassRow[];                    // missing file → []
export function assertNotRun(suite: PassRow["suite"], ids: readonly string[], path: string): void;
export function appendPass(row: PassRow, path: string): void;
export const HELDOUT_PASSES_PATH: string;                               // used only by the CLI main()
// both runners: EvalOptions.passesPath?: string; ScorecardMeta / QaScorecardMeta: final: boolean; mergedFrom?: string[]
// evals/merge.ts
export async function mergeReports(o: { suite: "extraction" | "qa"; dirs: string[]; label: string;
  reportsDir: string; goldenDir?: string; now?: () => Date }): Promise<string>;   // returns the new report dir
```
CLI: `npm run eval:merge -- --suite extraction|qa --label <label> <dir> <dir> [...]`. The guard is armed only when `final && split === "heldout" && mode === "live"` and a `passesPath` is given; it checks after selection and before `assertBudget`. Reports without `final` in their meta read as `final: false`.

- [ ] Tests first (`heldout-passes.test.ts`): `a missing file reads as empty`; `assertNotRun throws HeldoutRerunError naming an id already listed`; `appendPass writes one strict JSON line`.
- [ ] Tests first (both `run.test.ts`, modelled on "refuses a paid run … without a call or a ledger row"): `a final live held-out pass refuses to start when a selected id is in the passes file, before any call or ledger row`; `appends one pass row per case row, errors included`; `oracle, empty and replay passes never touch the passes file`; `meta.final is true only with --final`. Extraction only: `184 case runs fit one pass at $0.001; 251 are refused`.
- [ ] Tests first (`merge.test.ts`, modelled on the two `scorecard.test.ts` and `publish.test.ts`): `two halves of a dev replay merged equal the whole scorecard, ignoring latency and timestamps`; `refuses overlapping run-1 ids`; `refuses reports that differ in suite, split, mode, model, effort, prompt version, seed, anchor or final`; `chunks may differ in repeatHard`; `a merge that covers the split has aborted null and notRun empty, and lists mergedFrom`.
- [ ] Implement; `ESTIMATE_PER_CASE_RUN_USD = 0.001`. Run `npx vitest run evals` → pass; `npm run eval -- --suite extraction --split dev --mode replay --label p7-t1` and the `qa` equivalent reproduce the committed dev scorecards. Commit.

### Task 2: Held-out publishing (eval-engineer, sonnet; the `packages/shared` edit is authorised by the lead)

**Files:** `packages/shared/src/api.ts:487-531`, `packages/shared/src/contracts.test.ts:919-939`, `evals/publish.ts`, `evals/publish.test.ts`, `apps/api/src/eval/routes.test.ts`.

**Consumes:** `meta.final`, `meta.mergedFrom` (Task 1). **Produces:** `EvalSummary` suite entries with `split: z.enum(["dev","heldout"])`, unique by `(suite, split)`; `mode` stays `z.literal("live")`. CLI `npm run eval:publish -- [--extraction <dir>] [--qa <dir>] [--out <file>]`.

- [ ] Tests first (`contracts.test.ts`): `accepts a held-out entry`; `rejects two entries with the same suite and split`; replay mode is still rejected.
- [ ] Tests first (`publish.test.ts`): `a given report replaces only its (suite, split) entry and keeps the others`; `held-out entries come before dev within a suite`; `a held-out report is refused unless meta.final, mode live, aborted null, notRun and runnerErrors empty, and its first-run rows cover every id of the split in split.json` (one case per condition, message names it); `every entry carries an errors metric labelled "Errors, truncations and refusals (expected 0)"`; `the committed evals/published/summary.json parses as EvalSummary`.
- [ ] Implement (`buildSummary(dirs, now, previous?)`); `runAt` stays `meta.finishedAt`. `npm run verify` green (the web typecheck must still pass against the widened enum). Commit.

### Task 3: Evaluation page and two console fixes (frontend-engineer, sonnet)

**Files:** `apps/web/src/features/evaluation/evaluation-page.tsx` (+ test), `apps/web/src/components/source-badge.tsx`, `apps/web/src/lib/sse.ts:16-17` (+ `sse.test.ts`, `assistant-dock.test.tsx:226`), `apps/web/src/app.tsx:20`.

**Produces (Task 5 relies on these):** each suite section is `section[data-suite="extraction|qa"][data-split="dev|heldout"]` with id `${suite}-${split}`; a `DataTag` kind `heldout-split` reading "held-out, run once".

- [ ] Tests first (`evaluation-page.test.tsx`): `renders one section per (suite, split), held-out before dev, each with its own tag`; `shows "held-out pending" only for a suite with no held-out entry`; `the run date includes the year` (`formatUtcFull`); section ids are unique.
- [ ] Tests first (`sse.test.ts`): the replay-miss message is `This question has no recorded reply. Start a new conversation and pick a suggested question.` and still contains none of `replay_miss`, `key`, `/`, `LLM_MODE`. Do not edit `SUGGESTED_QUESTIONS`.
- [ ] Implement; `Toaster` → `position="top-center"` (offset top 44), so no toast covers the dock header.
- [ ] `npx vitest run apps/web`, `npx impeccable detect apps/web/src` → 0. Commit. The lead rebuilds (`docker compose build`), runs `npm run demo:reset`, and looks at `/evaluation`, a toast and a replay miss at 1440 and 390 px in a fresh browser-pane tab.

### Task 4: Recorded by default, live by one command (lead: compose and `.env.example`; eval-engineer, sonnet: scripts) ∥ T1

**Files:** `docker-compose.yml`, `.env.example`, `scripts/demo-live.ts` (+ test), `scripts/demo-reset.ts` (export `waitReady(check)`), `apps/worker/README.md:13`, `evals/smoke/README.md:6`.

- [ ] Compose (lead): api `LLM_MODE: ${LLM_MODE:-replay}`; api and worker `DEMO_ANCHOR: ${DEMO_ANCHOR-2026-11-14T08:00:00Z}` (no colon: an explicitly empty value means wall clock); worker `DEMO_HAZARDS: ${DEMO_HAZARDS:-on}`; api volume `./evals/published:/app/evals/published:ro`; comments say recorded is the default and name `npm run demo:live`. `.env.example`: describe `AIS_MODE`, `WEATHER_MODE`, `DEMO_HAZARDS`, `DEMO_ANCHOR` **as comments only** (a blank `DEMO_ANCHOR=` line would unpin the stack).
- [ ] Tests first (`scripts/demo-live.test.ts`, modelled on `demo-reset.test.ts`): `liveEnv unpins the clock (DEMO_ANCHOR ""), reseeds, turns hazards on and defaults the three modes to live`; `a caller's LLM_MODE, AIS_MODE or WEATHER_MODE wins`; `missingLive` reports each of: API not healthy (names `ANTHROPIC_API_KEY`, never a value), wrong `llmMode`, pinned clock, AIS not live or detail "socket down" (names `AISSTREAM_API_KEY`), weather not live, no named ship outside the fleet, web down.
- [ ] Implement:
```ts
export function liveEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export interface LiveSnapshot { health: unknown; clock: unknown; sources: unknown; traffic: unknown; vessels: unknown; webUp: boolean }
export function missingLive(s: LiveSnapshot, want: { llm: string; ais: string; weather: string }): string[];
```
`npm run demo:live` runs `docker compose up -d --force-recreate api erp worker web` with `liveEnv`, no build, 180 s wait. `LLM_MODE=replay npm run demo:live` is the free rehearsal of live sources.
- [ ] `npx vitest run scripts`; `npm run demo:reset` still ends ready; `LLM_MODE=replay npm run demo:live` ends ready (free), then `npm run demo:reset`. Commit.

### Task 5: Story modes and timings (eval-engineer, sonnet)

**Files:** `e2e/demo.spec.ts`, `playwright.config.ts` (live timeout only), `.claude/skills/demo-e2e/SKILL.md`.

**Consumes:** Task 3 data attributes, Task 4 `demo:live`.

- [ ] `STORY_MODE=recorded|record|live` (default `recorded`) → expected `/api/health` `llmMode` `replay|record|live`, asserted as the test's first action. `STORY_STOP_AFTER=map` returns after step 1 and skips that check.
- [ ] Recorded and record modes keep today's expectations and request order exactly (no new POST): 2 recorded badges, "08:05Z" and "pinned", `route-row-B` recommended, the price retype.
- [ ] Live mode: 2 live badges, 0 recorded; `[data-pinned="false"]`; before step 2 a free preflight (`GET /api/hazards` contains `synthetic:1`, any other id is written to the timings file; `POST /api/route-plan` for Aegean Pioneer has at least one feasible non-baseline option, else fail with "live conditions block every route: report, not a product fix"); step 4 expects exactly one `[data-role="recommended"]` row that is not row A; the public ship is the first named, non-fleet ship with latitude < 45; screenshots go to `test-results/story-live/`.
- [ ] Both modes: first progress is timed to the turn's `role="status"` text matching `/tools? called|Checked \d+ source/`, the answer to the gate line; `test-results/story-timings.json` becomes `{ mode, stopAfter, steps: [{ step, ms }] }`. Step 6 reads `/api/eval/summary` and expects a visible `section[data-suite][data-split]` with its "k of n" for every entry.
- [ ] Skill text: the three modes, which commands are paid, `STORY_MODE=live` needs `npm run demo:live`.
- [ ] Verify (free): `docker compose build`; `npm run demo:reset && npx playwright test` twice → PASS, `docker compose logs api | grep -c "replay miss"` → 0; `LLM_MODE=replay npm run demo:live && STORY_MODE=live STORY_STOP_AFTER=map npx playwright test` → PASS; `npm run demo:reset`. Commit.

### Task 6: README, demo script, harness docs (writer, sonnet; lead-owned files authorised)

- [ ] `README.md`: what Pharos is; quick start with no keys (Docker, Node ≥ 22.12; `docker compose up --build` → http://localhost:5173); run the story (`npm ci`, `npx playwright install chromium`, `npm run demo:reset && npx playwright test`); go live (which two variables go in `.env`, `npm run demo:live`, back with `npm run demo:reset`); evaluation (link to `docs/APPROACH.md`; held-out ran once); `npm run verify` (needs full git history and the `db` container for database tests); layout; links.
- [ ] `docs/DEMO_SCRIPT.md`: preflight checklist (images pre-built the day before with `docker compose build` and never on stage; keys set, shown by `npm run demo:live` readiness; AIS `npm run smoke:ais -- --seconds 20`; weather `npm run smoke:weather`; recorded story passes; `npm run demo:reset` as the one switch back); the six steps with what to click and say; the three scripted questions verbatim (recorded replies cover only these); a fallback table (AIS down, weather down, model slow or key missing → what the console shows → what to do); nothing is ever sent to an external party.
- [ ] `CLAUDE.md` commands (`demo:live`, `eval:merge`, recorded-by-default compose); `.claude/skills/eval-bench/SKILL.md` (final-pass rules: passes file, merge, held-out publish); `fixtures/recorded/README.md` (Phase 7 kept these files: R1); `docs/MASTER_PLAN.md` §13 one dated line for R1 and R3. Commit.

### Task 7: Whole-branch review and one fix wave (opus reviewer; owning agents fix)

- [ ] Review `ef20202..HEAD` against this plan, the Global Constraints and the Review Focus; one fix wave; scoped re-review; park Minors with a ruling. Nothing is reviewed again after Task 9 except documents.

### Task 8: Freeze (lead; first paid call ≈ $0.01)

- [ ] `npm run verify` → exit 0; record files, tests, skipped. `git diff --stat ef20202 -- <frozen paths>` → empty. Both `--check` commands clean.
- [ ] `docker compose build`; `npm run demo:reset && npx playwright test` twice → PASS, 0 replay misses.
- [ ] Replays: `npm run eval -- --suite qa --split dev --mode replay --label p7-freeze` reproduces the Phase 6 live scorecard (grounded 33/33, accuracy 25/25, unauthorised 0/33); `--suite extraction` reproduces 646/651, unsafe 0/84.
- [ ] Held-out oracle and empty, both suites (free; first time these cases meet the runner): `npm run eval -- --suite extraction --split heldout --final --oracle --label p7-oracle` → critical fields 100 %; `--empty` → ≤ 2 %; `--suite qa … --oracle` → every accuracy question correct; `--empty` → 0. **If an oracle is not 100 %: stop and tell the user** (truth is never edited to pass).
- [ ] Merge rehearsal (free): the extraction held-out oracle again as `--offset 0 --limit 78` and `--offset 78`, then `npm run eval:merge -- --suite extraction --label p7-oracle-merged <a> <b>` → equals the one-pass oracle scorecard, ignoring latency and timestamps.
- [ ] Live story, once: `npm run demo:live` → `STORY_MODE=live STORY_STOP_AFTER=map npx playwright test` (free) → `STORY_MODE=live npx playwright test` (paid) → record first progress (target ≤ 3 s), answer (≤ 45 s) and per-email extraction (≤ 20 s) from the timings file; sum `costUsd` from `GET /api/llm-calls`; `npm run eval:ledger -- add --run demo-story-live --label p7-live --cost <usd>`; `npm run demo:reset`. A product failure is fixed here (one fix round, re-review, at most two more paid runs); a live source being down is retried later and reported.
- [ ] Pre-registration: `docs/EVAL_LOG.md` entry "2026-11-16 — Phase 7 — held-out pass (pre-registration)" with the frozen SHA, the two commands, the metrics to be reported, R6 (parked grader limits), R8 (abort policy) and H21 (extraction critical-field accuracy inside the dev interval 98.2–99.7 %), H22 (0 unsafe auto-accepts), H23 (Q&A grounded 100 % of released answers, 0 unauthorised). Commit **before** Task 9.

### Task 9: Held-out pass (lead; two user go-aheads; ≈ $0.17)

- [ ] **Stop: ask the user for the go-ahead** (run extraction, or both back to back). `npm run eval:ledger -- total` first.
- [ ] Background: `npm run eval -- --suite extraction --split heldout --final --mode live --repeat-hard 3 --label p7-heldout` (184 runs, about 17 min). Check: served model Haiku only, errors listed separately, ledger row `phase: 7`, 156 first-run rows in `evals/heldout-passes.jsonl`.
- [ ] **Stop: go-ahead for Q&A** unless already given. Background: `npm run eval -- --suite qa --split heldout --final --mode live --label p7-heldout` (32 questions).
- [ ] On an early stop apply R8 (resume with `--offset`, then `eval:merge`); never re-run a case with a row.
- [ ] Read the 7 answers R6 touches (`comparison-02/04/05/08`, `congestion-03`, `route-speed-04/07`) in `transcripts.jsonl`; note for each whether the sentence names the right side or instant. This changes no grade.
- [ ] Publish: `npm run eval:publish -- --extraction <held-out dir> --qa <held-out dir>`, then re-publish dev from `evals/reports/20261115T033145Z-extraction-dev-dev-haiku-gate-final` and `evals/reports/20261116T003513Z-qa-dev-dev-haiku-p6` so all four entries share one metric set.
- [ ] `docs/EVAL_LOG.md` results under the pre-registration: k of N with 95 % intervals per metric, the variance section (hard cases ×3), failures by id and kind, errors separately, H21–H23 as measured, latency, spend, the hand-read note. No change follows this entry.
- [ ] `git add -f` both held-out reports (`scorecard.json`, `scorecard.md`, `rows.jsonl`; Q&A also `transcripts.jsonl`) and the Phase 6 Q&A dev report; add `evals/heldout-passes.jsonl`, `evals/spend-ledger.jsonl`, `evals/published/summary.json`. Commit.

### Task 10: `docs/APPROACH.md` and screenshots (writer, **opus**)

- [ ] `docs/APPROACH.md`: what it does; why these choices (the seven rules of §6, briefly); **headline numbers**, held-out first with dev alongside, each labelled with its split, k of N and 95 % interval, copied from `evals/published/summary.json`; run-to-run variance; latency and cost (held-out reports and the live story); how it was measured (benchmark first, truth by code, random split, pre-registered, run once, errors separate); honest limits (the two R6 grader limits and the hand-read; "0 of N" bounds, counted per graded email; 32 held-out questions give wide intervals; planning-grade routes; FuelEU as an exposure; synthetic private data; fixtures of 15 Nov; no real hazard message captured; R9 items); what is next.
- [ ] `npm run demo:reset && STORY_SCREENSHOTS=docs npx playwright test` → the committed story screenshots now show held-out on the evaluation page; look at them; update `docs/screenshots/phase-6/README.md`.
- [ ] Task review checks every number in `APPROACH.md` against `summary.json` and the scorecards. Commit.

### Task 11: Gate (lead + verifier)

- [ ] `npm run verify` → exit 0. Commit the candidate.
- [ ] Fresh clone: `docker compose stop` in the working copy; `git clone --branch build/prototype <repo> <scratchpad>/pharos-fresh`; in the clone, with `COMPOSE_PROJECT_NAME=pharos-fresh` on every command and no `.env`: `docker compose up --build -d` → `/api/health` `llmMode` replay, `/api/clock` pinned, web answering; `npm_config_cache=<repo>/.npm-cache npm ci`; `npx playwright test` → PASS; `npm run demo:reset && npx playwright test` → PASS; `npm run verify` → exit 0 with the same skipped count as the working copy and database tests run; `docker compose down -v` (the clone's own project and volume only). The clone folder is left in the scratchpad.
- [ ] Back in the working copy: `npm run demo:reset`; then the final images go live for free: `LLM_MODE=replay npm run demo:live && STORY_MODE=live STORY_STOP_AFTER=map npx playwright test`; `npm run demo:reset`.
- [ ] Gate evidence in `evals/reports/<stamp>-gate-phase7/summary.json` (force-added): verify counts, clone story times, live story timings and cost, ledger total.
- [ ] `verifier` (read-only, GET only against the stack): gate list below → PASS.
- [ ] `.claude/state/status.json` → Phase 7 gate (biome-formatted); local gate commit; `phase-7-handover.md` and `phase-7-sdd-ledger.md` in the shared notes folder `…/side-session-notes/local_93b5f3bc-fa98-41b9-a320-60d275a4c03f`; final message with the held-out scores and intervals, the spend, and what is left for the user.

## Verification (end to end)

The verifier's gate list:

1. `npm run verify` exit 0, database tests ran, skipped count explained.
2. Frozen paths unchanged since ef20202; both golden `--check` commands clean; recordings folder unchanged.
3. Fresh clone evidence: keyless `docker compose up --build`, recorded story PASS twice, verify green, own project name.
4. Live story PASS once on the frozen SHA with first-progress, answer and extraction latency against §6.
5. Held-out: exactly one final live pass per suite in the ledger and `evals/heldout-passes.jsonl` (156 + 32 first runs, no id twice); the pre-registration commit precedes the passes; no commit after them touches a frozen path, a grader or a runner.
6. `evals/published/summary.json` has four entries (2 suites × dev, held-out), each equal to its scorecard; `/evaluation` shows them with split labels; `docs/APPROACH.md` numbers match.
7. Phase 7 ledger total ≤ $1.00, every row `phase: 7`, each pass ≤ $0.25, Haiku 5.5 only.
8. `README.md`, `docs/APPROACH.md`, `docs/DEMO_SCRIPT.md` exist and their commands run as written (`demo:reset`, `demo:live` readiness in replay, the story).
9. `npx impeccable detect apps/web/src` = 0; no off-origin request or console error in the story.
10. Nothing pushed; `.env` never read.

## Self-review notes

- **Gate coverage:** fresh clone recorded ×2 → T11; fully live once → T8 (R4); final scorecard with intervals committed and published → T9; pre-built images → T8, T11, `DEMO_SCRIPT.md`; three documents → T6, T10.
- **Brief traps:** order of refresh and held-out → R1; keyless clone → R3, T4; re-recording → R2; live variant → R5, T5; grader prerequisites → R6.
- **Deviations from the master plan's scope line, for the user to accept with this plan:** no fresh capture or snapshot (R1); replays verified rather than re-recorded (R2); the two grader weaknesses stay and are reported as limits (R6); the extraction estimate is recalibrated to run held-out in one pass (R7).
- **User stops:** this approval; the go-ahead before each held-out pass; a held-out oracle below 100 %; anything irreversible. No truth review is needed because no truth changes.
