# Wave 1: Facts and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give each fact one builder and one label, and make the API return the fields the console now works out for itself. The web's workaround code then goes, with no byte sent to the model changing and no published number moving.

**Architecture:** the bunker and vessel facts get one pure builder each in `apps/api/src/facts/`, following the pattern of `routing/facts.ts`. The tool and the read views both call it. The shared contracts gain the fields the web derives today. The tool registry, progress events and ask failures each get one home, and so do the clock and seed constants. The web tasks then delete the derivations. Every API refactor is proven byte-identical by snapshot tests written before it and by free dev replays.

**Tech Stack:** unchanged (TypeScript 6, Hono, Drizzle, Zod, `@anthropic-ai/sdk` tool runner, React 19, Vitest, Playwright). No new dependency.

**Spec:** the architecture review of 2026-11-17, `side-session-notes/local_01497e8f-d9eb-4ebb-b68a-1c2a1266204d/architecture-review.md`, copied to `docs/ARCHITECTURE_REVIEW.md` in Task 0. Wave 1 is its findings 1, 2, 5, 6, 10 and 14, plus the dead code in 8 and 9. Also `CLAUDE.md`, and `docs/MASTER_PLAN.md` §3 and §6.

## Rulings

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| W1 | **One fact id, one `Fact`.** The tool's label is the canonical one: tool output is frozen, so the approval view adopts it. Approval-card rows then read `MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): quantity` instead of `Quantity`. The card names the option once, from `optionLabel`. The view's effective-price fact stays, built by the same module; only the view selects it. | Two labels per id is the drift the review found. The tool's bytes can't change. | One row-label restyle in the UI round. |
| W2 | **Vessel panel:** fuel on board per grade, voyage number, next port and its ETA become fact chips with the tool's ids and labels (db provenance). They stop animating (UI rule 6). The fuel-on-board projection chart stays a chart under the "simulated" tag. | Citing the projection needs a stored calculation. Storing one on a read would shift the calculation ids that later model requests carry. | Chart citations in a later wave. |
| W3 | **`expectedZero`** is written by `evals/publish.ts` and is required in `EvalSummary`. The committed `evals/published/summary.json` is re-published from the same four reports, with no model call. A check proves everything but `generatedAt` and the new flags is unchanged. | The flag lives where the knowledge is (publish), with no fallback path in the web. | One re-publish. |
| W4 | **No byte sent to the model changes, and this is proven, not inspected.** Snapshot tests are taken before each refactor. Dev replays of both suites must reproduce the Task 0 baseline scorecards. `evals/qa/tools-crosscheck.test.ts` stays green. The recorded story must pass with 0 replay misses. A miss means stop and find the cause: never re-record. | Recordings are keyed on request bytes, and the held-out split is closed. | — |
| W5 | **`now` is required** in the ingestion, review, executor and agent dependencies. The pinned offset and the default seed each get one home in `packages/db`, which anchors the world. | A forgotten `now` silently unpins the demo. | Typecheck-only churn in tests. |
| W6 | **Dead code goes:** `executeRecommendation` and the `x-pharos-data` header with `ReadSource.dataTag`. | Neither has a production caller or reader. | Restore from git. |
| W7 | **"Show on map"** uses `AskResponse.subjects`, the ships the tools resolved, in order of first appearance. The name match in answer prose goes. | The API knows which ship it planned for; the web guessed. | — |
| W8 | **Model tag:** a third state, "model: recording", is shown in record mode. This is web only, with no contract change. | Record mode is dev only. A per-answer source is not worth a contract field. | — |
| W9 | **Out of scope:** the planning-module move, the ingestion module, the executor strategies, making `ReadSource` optional, the eval `runPass`, the live-data seams, the multi-turn Conversation module, the `/ mt` normaliser, the graders, `KnownFactUnit` (it would touch the frozen gate), the three copies each of the fact-id alphabet and the calculate operations, the provenance paths copied into the web's `route-facts.ts`, the audit idempotency-key wording, and any visual redesign (the UI round). "Route B recommended" already has a test (`evals/qa/generate.test.ts:108-111`, Phase 7 R6d), so no new one is added. | Waves 2 and 3. | — |

## Global Constraints

- **Invariants:** all maths in `packages/domain`; every shown number is a cited tool fact; the model only proposes; email content is untrusted data (`CLAUDE.md` rules 1–4).
- **Frozen bytes:** prompt text; tool names, descriptions, input schemas and their order; `ToolResult` JSON (facts, their labels, values, units, provenance, order, and `data`); conversation history; the extraction input.
- **Frozen paths:** `git diff --stat 59b8c5b -- <these>` must be empty at the gate:
  - `apps/api/src/ai/prompts/**`, `apps/api/src/ai/release-gate.ts`, `apps/api/src/ai/llm.ts`;
  - `apps/api/src/ingest/{evaluate,parse-email,resolve}.ts`;
  - `packages/db/src/seed/**` (non-test), `packages/integrations/**`, `packages/shared/src/extraction/**`;
  - `fixtures/**`, `evals/golden/**`, `evals/{qa,extraction}/grade*.ts`;
  - `evals/lib/heldout-passes.ts`, `evals/heldout-passes.jsonl`, `evals/budget.json`.
- **`packages/domain` non-test code:** the only change is the additive `forecastStepAt` (Task 3). `DOMAIN_CODE_VERSION` is unchanged.
- **No paid call:** never use `LLM_MODE=live|record`, `--mode live|record`, `--final`, `npm run demo:live` or `npm run eval:compare`. Every eval run is `--mode replay` on the dev split. Never run anything against the held-out split.
- **Repo hygiene:** never read, print or log `.env`. Never push. Commit locally per task with a pathspec (`git commit -m "…" -- <paths>`). No dependency change.
- **UI rules for every `apps/web` change:**
  - `CLAUDE.md` UI rules: run `pick-ui-library` first; tokens only; `npx impeccable detect apps/web/src` must report 0;
  - rebuild with `docker compose build api web` before any story run or pane check;
  - check on the built bundle in a fresh tab.
- **Owners:** `ai-backend-engineer` for `apps/api`; `domain-data-engineer` for `packages/db` and `packages/domain`; `frontend-engineer` for `apps/web`. A task changes `packages/shared` contracts itself and its review checks them; the lead does `evals/publish.ts`, `CLAUDE.md` and docs.
- **Models:** sonnet by default; opus for Task 1 and the final review.
- **Verification commands:**
  - Replay: `npm run eval -- --suite qa --mode replay --label w1-<task>` and `npm run eval -- --suite extraction --mode replay --label w1-<task>`. The stack's `db` container must be up.
  - Scorecard match: `scripts/check-scorecard.sh <baseline-dir> <new-dir>`, created in Task 0. Exit 0 means every scorecard field except `latency` is identical.

## Review Focus

1. **A two-grade voyage.** Option ids carry a `<grade>-` prefix and plan-level labels a `<grade> plan: ` scope. The approval view must rebuild both from the stored plan alone (Task 1, test `view facts carry the grade scope`).
2. **A fleet vessel with no current voyage, or no future port call.** The panel must show what exists and leave the rest empty, not crash (Task 2 `vessel without a voyage`, Task 11 `panel without voyage facts`).
3. **A tool that throws mid-answer.** Its chip must show failed, and a later call of the same tool must pair with its own events (Task 5 `failed tool reports failed`, Task 11 `chips pair by call id`).
4. **An answer about a public AIS ship, or about two vessels.** The map link goes to the first ship resolved; an answer with no ship shows no link (Task 6, Task 11).
5. **A stale `summary.json` without `expectedZero`.** It must fail to parse with an error that names the field, and the committed file is regenerated in the same commit (Task 3).

---

### Task 0: Baseline, and the spec into the repo

**Files:**
- Create: `docs/ARCHITECTURE_REVIEW.md` (a copy of the review), `scripts/check-scorecard.sh`
- Commit: this plan

- [ ] **Step 1: Copy the review and write the check script.** `check-scorecard.sh <dirA> <dirB>` deep-compares `scorecard` in each dir's `scorecard.json` with `latency` deleted, exits 0 when equal, and otherwise prints the first differing key. Use `node -e`; no new dependency.
- [ ] **Step 2: Run `npm run verify`.** Expected: exit 0, 143 files, 3 031 pass, 1 skipped, 5 todo, lint 0 errors.
- [ ] **Step 3: Run both dev replays with `--label w1-base`.** Expected: 0 replay misses each, and the scorecard k and n matching the Phase 7 fix-wave replays (`20261116T143651Z-qa-dev-p7-fw`, `20261116T143645Z-extraction-dev-p7-fw`) under `check-scorecard.sh`. Write both new report dir names into the ledger as **the baseline**.
- [ ] **Step 4: Run `npm run demo:reset && npx playwright test`.** Expected: PASS, 0 replay misses.
- [ ] **Step 5: Commit** `docs/ARCHITECTURE_REVIEW.md`, `scripts/check-scorecard.sh` and this plan.

### Task 1: Bunker plan facts, one builder (API)

**Files:**
- Create: `apps/api/src/facts/core.ts`, `apps/api/src/facts/bunker.ts`, `apps/api/src/facts/bunker.test.ts`
- Modify: `apps/api/src/ai/tools/common.ts` (remove `factId`, `calcFact`, `dbFact`), every importer of those three (`ai/tools/*.ts`, `routing/facts.ts`, `read/db-source.ts`, their tests), `apps/api/src/ai/tools/plan-bunkering.ts:44-62,138-207`, `apps/api/src/read/db-source.ts:171-209,320-344`, `apps/api/src/read/fixtures.ts:357-362`, `packages/shared/src/api.ts:176-193` (`RecommendationView`), `apps/api/src/read/db-source.test.ts:273`

**Interfaces:**
- Produces:
  - `facts/core.ts`: `factId`, `calcFact`, `dbFact`, moved verbatim, with no re-export from `common.ts`.
  - `facts/bunker.ts`:
    - `BUNKER_TOOL = "plan_bunkering"` (the tool imports it as its `TOOL`);
    - moved unchanged: `BUNKER_OPTION_FACTS`, `bunkerOptionLabel`, `BUNKER_DISPLACEMENT_LABEL`, `BUNKER_DISPLACEMENT_FIELD`;
    - `BUNKER_SAVING_PATH = "savingVsCheapestHeadlineUsd"`;
    - `interface BunkerFactContext { calculationId: Id; plan: BunkerPlan; scope: string; names: (optionId: string) => { supplier: string; port: string }; displacementMt: number | null }`;
    - `bunkerScope(grade: FuelGrade, optionId: string): string`, which returns `"<grade> plan: "` when `optionId` starts with `<grade>-`, else `""`;
    - `bunkerPlanFacts(c: BunkerFactContext): Fact[]`, exactly the tool's list in its current order;
    - `bunkerOptionViewFacts(c: BunkerFactContext, optionId: string): Fact[]`, returning:
      - for the option: `qtyMt`, `headlinePriceUsdPerMt`, `totalCostUsd`, `effectivePriceUsdPerMt` (label name `effective price (total cost per mt)`, unit `USD/mt`) and `fuelEuCostUsd`;
      - then, when this option is best, `bestOptionId` and the saving;
      - all built with the same label helpers as the tool.
  - `RecommendationView` gains `optionLabel: z.string().nullable()` (bunker: `"<supplier> at <port>"`; route: the candidate's `label`) and `expectedSaving: Fact.nullable()`. The second is the view fact at `BUNKER_SAVING_PATH`, or the route's `savingVsBaselineUsd` fact; it is null when `expectedSavingUsd` is null or the plan is unreadable.

- [ ] **Step 1: Write the characterization test on the unchanged code.** `bunker.test.ts` → `plan_bunkering facts are unchanged`. On the test database, run `planBunkering` for MV Aegean Pioneer, and for one voyage with two open grades (if the seed has none, add a second open requirement in the test setup). Assert `expect(JSON.stringify(result)).toMatchSnapshot()`. Run it to create the snapshot, and commit it before Step 3.
- [ ] **Step 2: Write the failing tests.**
  - `view facts are the tool's facts`: every view fact whose id the tool emits deep-equals the tool's fact with that id;
  - `view facts carry the grade scope`: for a `VLSFO-` option, the best-option label starts `VLSFO plan: `;
  - `recommendation names its option`: for the demo proposal, `optionLabel === "Kestrel Marine Fuels at Marsaxlokk"` and `expectedSaving.value === expectedSavingUsd`;
  - `route recommendation names its candidate`: `optionLabel` equals the candidate label in the stored inputs.
- [ ] **Step 3: Run them.** Expected: the characterization test passes; the other three fail.
- [ ] **Step 4: Implement.** Do the move into `facts/core.ts`, then the builder. The tool and the view call it. The view gets names from the supplier and port maps it already reads, and scope from `bunkerScope`. The fixture adapter builds with the same functions.
- [ ] **Step 5: Run the tests.** Run `npx vitest run apps/api/src/facts apps/api/src/read apps/api/src/ai/tools evals/qa/tools-crosscheck.test.ts`. Expected: PASS, with the characterization snapshot untouched.
- [ ] **Step 6: Run the Q&A dev replay** with `--label w1-t1`, then `check-scorecard.sh <baseline qa> <new>`. Expected: exit 0, 0 misses.
- [ ] **Step 7: Commit.**

### Task 2: Vessel facts, one builder (API)

**Files:**
- Create: `apps/api/src/facts/vessel.ts`, `apps/api/src/facts/vessel.test.ts`
- Modify: `apps/api/src/ai/tools/vessel-status.ts:14-60,103-125`, `apps/api/src/read/world-views.ts:25-71` (`buildVessels(world, now)`), its callers in `read/db-source.ts` and `read/fixtures.ts`, `packages/shared/src/api.ts:55-61`

**Interfaces:**
- Consumes: `dbFact` (Task 1).
- Produces:
  - `facts/vessel.ts`:
    - `VESSEL_TOOL = "get_vessel_status"`;
    - `interface VesselRowFacts { name: Fact; imo: Fact; robMt: Record<FuelGrade, Fact> | null; voyageNo: Fact | null; nextPort: Fact | null; nextPortEta: Fact | null }`;
    - `vesselRowFacts(world: World, vessel: Vessel, now: Date): VesselRowFacts`, where `robMt` comes from `voyageState(world, voyage.id).report` and is null without a current voyage, and the next port call is the first with `eta >= now`, as the tool has it.
  - Shared: `VesselFacts = z.object({ robMt: z.object({ LSMGO: Fact, VLSFO: Fact, HSFO: Fact }).strict().nullable(), voyageNo: Fact.nullable(), nextPort: Fact.nullable(), nextPortEta: Fact.nullable() }).strict()`, and `VesselDetail` gains `facts: VesselFacts`.

- [ ] **Step 1: Write the characterization test on the unchanged code.** `get_vessel_status facts are unchanged`: snapshot `JSON.stringify(result)` for MV Aegean Pioneer and for one fleet vessel with no current voyage. Commit the snapshot.
- [ ] **Step 2: Write the failing tests.**
  - `detail facts are the tool's facts`: the four `VesselDetail.facts` entries deep-equal the tool's facts with the same ids;
  - `vessel without a voyage`: `robMt`, `voyageNo`, `nextPort` and `nextPortEta` are all null.
- [ ] **Step 3: Implement.** The tool pushes the builder's facts in its current order; `buildVessels` takes the source's `now`.
- [ ] **Step 4: Run** `npx vitest run apps/api/src/facts apps/api/src/read apps/api/src/ai/tools evals/qa/tools-crosscheck.test.ts`. Expected: PASS, with the snapshot untouched.
- [ ] **Step 5: Run the Q&A dev replay** (`w1-t2`) and `check-scorecard.sh`. Expected: exit 0.
- [ ] **Step 6: Commit.**

### Task 3: Contract fields: forecast times, drafts, audit, expected zero

**Files:**
- Modify:
  - `packages/domain/src/weather-effect.ts` and `index.ts` (add `forecastStepAt`, test first);
  - `packages/shared/src/api.ts:392-417` (`WeatherView`), `:466-467` (`AuditEventView`) and `:490-542` (`EvalSummary`);
  - `packages/shared/src/entities.ts:384-394` (add `DraftedMessageView`) and `:439-447` (`AuditEvent.kind`);
  - `apps/api/src/live/routes.ts` (the weather view), `apps/api/src/approvals/routes.ts:68`;
  - `evals/publish.ts:37,263,295` and `evals/published/summary.json` (re-published).
- Test: `packages/domain/src/weather-effect.test.ts`, `packages/shared/src/contracts.test.ts`, `apps/api/src/live/routes.test.ts`, `apps/api/src/approvals/routes.test.ts`, `evals/publish.test.ts`

**Interfaces:**
- Produces:
  - Domain: `forecastStepAt(grid: { startAt: string; stepHours: number }, step: number): Date`.
  - Weather: `WeatherView` gains `validAt: IsoDateTime` (the served step) and `stepTimes: z.array(IsoDateTime)` (length `steps`).
  - Drafts: `DraftedMessageView = DraftedMessage.extend({ createdAt: IsoDateTime }).strict()` and `DraftedMessageList = listOf(DraftedMessageView)`.
  - Audit:
    - `AUDIT_KINDS`, the `as const` list of every kind `executor/execute.ts` and `review/decide.ts` write (read them; add nothing new);
    - `AuditEvent.kind` and `AuditEventView.kind` become `z.enum(AUDIT_KINDS)`;
    - `AuditEventView` becomes `.strict()`.
  - Evaluation: each `EvalSummary` metric gains a required `expectedZero: z.boolean()`.

- [ ] **Step 1: Write the failing tests.**
  - `forecastStepAt(…, 0)` equals `startAt`, and `forecastStepAt({ startAt: "2026-11-14T06:00:00Z", stepHours: 3 }, 2)` equals `2026-11-14T12:00:00Z`;
  - `weather view states each step's time`: `stepTimes.length === steps` and `validAt === stepTimes[step]`;
  - `drafts route returns DraftedMessageList`;
  - `every audit kind the executor and review write parses`, by running their existing approve, reject and accept test paths and parsing each row with `AuditEventView`;
  - `publish marks expected-zero metrics`: `expectedZero` is true exactly for `errors`, `unauthorised` and `unsafeAutoAccepts`, and every label is unchanged;
  - `EvalSummary without expectedZero fails to parse` (the parse error's path names `expectedZero`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The weather route computes the times with `forecastStepAt` only. Publish takes the flag from each `metric(...)` call; label strings are untouched.
- [ ] **Step 4: Re-publish `summary.json` in Phase 7's order, held-out first, so the entry order is kept.**
  1. Run `npm run eval:publish -- --extraction evals/reports/20261116T152129Z-extraction-heldout-p7-heldout --qa evals/reports/20261116T154031Z-qa-heldout-p7-heldout`.
  2. Run `npm run eval:publish -- --extraction <the extraction dev report named in docs/EVAL_LOG.md> --qa evals/reports/20261116T003513Z-qa-dev-dev-haiku-p6`.
  3. Compare:
     ```bash
     git show 59b8c5b:evals/published/summary.json > "$TMPDIR/summary-before.json"
     node -e 'const s=p=>{const o=require(p);return JSON.stringify({...o,generatedAt:0,suites:o.suites.map(x=>({...x,metrics:x.metrics.map(({expectedZero,...m})=>m)}))})};process.exit(s(process.argv[1])===s(process.argv[2])?0:1)' "$TMPDIR/summary-before.json" "$PWD/evals/published/summary.json"
     ```
  Expected: exit 0. Any other difference means stop and report.
- [ ] **Step 5: Run** `npx vitest run packages/domain packages/shared apps/api/src/live apps/api/src/approvals evals/publish.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit,** including `summary.json`.

### Task 4: Tool registry and tool names

**Files:**
- Create: `apps/api/src/ai/tools/registry.ts`, `apps/api/src/ai/tools/registry.test.ts`
- Modify:
  - `apps/api/src/ai/agent.ts:19-28,95-107`;
  - each tool's `…Tool(ctx)` factory (`ai/tools/*.ts`), which is removed, and its `name`, `description` and schema moved into a definition;
  - `apps/api/src/ai/agent.test.ts:104-114,242-252`;
  - `packages/shared/src/tools.ts` (additive `AgentToolName`), `packages/shared/src/api.ts:275-287` (`AskEvent.progress.tool`);
  - the `CLAUDE.md` tool checklist.

**Interfaces:**
- Produces:
  - Shared: `AgentToolName = z.enum(["list_fleet", "get_vessel_status", "list_quotes", "plan_bunkering", "get_emissions", "plan_route_speed", "get_port_congestion", "calculate", "propose_action"])`. This is the registry's current order, and the names are each tool's `TOOL` constant.
  - Registry:
    - `interface AgentToolDef<S extends z.ZodType> { name: AgentToolName; description: string; inputSchema: S; run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult> }`;
    - `defineTool<S extends z.ZodType>(def: AgentToolDef<S>): AgentToolDef<S>`;
    - `AGENT_TOOL_DEFS: readonly AgentToolDef<z.ZodType>[]`, in today's order;
    - `agentTools(ctx: ToolContext): AgentTools`, where each def becomes `betaZodTool({ name, description, inputSchema, run: async (input) => JSON.stringify(await def.run(ctx, input)) })`.
  - Each tool's exported function (`planBunkering`, `getVesselStatus`, …) keeps calling `runTool` itself, because tests call those functions directly.

- [ ] **Step 1: Write the characterization test on the unchanged code.** `request tools are unchanged`: capture one scripted ask's request body (the scripted LLM's fetch seam) and snapshot `body.tools`. Commit the snapshot.
- [ ] **Step 2: Write the failing tests.**
  - `registry order matches AgentToolName`;
  - `every tool records its call`: for each def, `run` on a fresh test context with a valid input adds exactly one `ctx.calls` entry, which proves `runTool` is used;
  - `agent.test.ts` builds its expected tool lists from `AGENT_TOOL_DEFS`.
- [ ] **Step 3: Implement.** Descriptions and schemas move verbatim.
- [ ] **Step 4: Run** `npx vitest run apps/api/src/ai`. Expected: PASS, with the `body.tools` snapshot untouched.
- [ ] **Step 5: Update the `CLAUDE.md` checklist.** It must say to add the definition to `AGENT_TOOL_DEFS` (append only: the order is part of every replay key); its name to `AgentToolName`; its line in the prompt's tool list, with a `PROMPT_VERSION` bump under the `eval-bench` protocol; its web label; and any new fact unit to the release gate.
- [ ] **Step 6: Run the Q&A dev replay** (`w1-t4`) and `check-scorecard.sh`. Expected: exit 0.
- [ ] **Step 7: Commit.**

### Task 5: Progress events with call ids, and one failure classifier

**Files:**
- Create: `apps/api/src/ask/failure.ts`, `apps/api/src/ask/failure.test.ts`
- Modify: `apps/api/src/ai/agent.ts:43-47,108-125,150-165` (`ToolProgress`, `withProgress`, `AgentError`), `packages/shared/src/api.ts:275-287`, `apps/api/src/ask/routes.ts:47-63`, `apps/api/src/ask/stream.ts:16-21`, `evals/qa/run.ts:293-302`

**Interfaces:**
- Consumes: `AgentToolName` (Task 4).
- Produces:
  - `AskEvent` progress becomes `{ type: "progress"; callId: string; tool: AgentToolName; phase: "started" | "finished" | "failed"; ms: number }`.
  - `type ToolProgress = Omit<Extract<AskEvent, { type: "progress" }>, "type">`.
  - `withProgress` takes `callId` from the run context's `toolUse.id` (`BetaToolRunContext`). A run without it throws `Error("tool run without a tool_use id")`.
  - `AgentError` gains `reason: AgentFailureReason`, the union of the categories the three classifiers distinguish today (read them; add none).
  - `classifyAskFailure(err: unknown): { reason: AgentFailureReason | "internal"; status: number; message: string }`. The route, the stream and the Q&A runner all call it.

- [ ] **Step 1: Write the characterization test on the unchanged code.** `the Q&A runner's error kinds are unchanged`: for one instance of each error the agent throws (and one plain `Error`), assert the kind the runner's current function returns. Commit it.
- [ ] **Step 2: Write the failing tests.**
  - `progress carries the tool_use id`: in a scripted two-call ask, the `started` and `finished` events share the request's `tool_use` id;
  - `failed tool reports failed`: a tool that throws emits `started` then `failed`, never `finished`;
  - `classifyAskFailure` maps each error to the status and message the route and stream return today.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api/src/ai apps/api/src/ask evals/qa`. Expected: PASS, with the characterization test unchanged.
- [ ] **Step 5: Run the Q&A dev replay** (`w1-t5`) and `check-scorecard.sh`. Expected: exit 0; the scorecard's error section is identical.
- [ ] **Step 6: Commit.**

### Task 6: Ask subjects for "Show on map"

**Files:**
- Modify:
  - `apps/api/src/ai/tools/common.ts` (`ToolContext.subjects`, `createToolContext`);
  - the tools that resolve a ship: `vessel-status.ts`, `plan-bunkering.ts` (each planned vessel), `emissions.ts`, `route-speed.ts`;
  - `apps/api/src/ai/agent.ts` (return the subjects);
  - `packages/shared/src/api.ts:236-269` (`askFields`), `apps/api/src/ask/response.ts`.
- Test: `apps/api/src/ai/agent.test.ts`, the four tool tests

**Interfaces:**
- Produces:
  - `AskSubject = z.discriminatedUnion("kind", [z.object({ kind: z.literal("vessel"), vesselId: Id }).strict(), z.object({ kind: z.literal("ais"), mmsi: z.string().min(1) }).strict()])`.
  - `askFields.subjects: z.array(AskSubject)`, deduplicated, in order of first appearance.
  - `ToolContext.subjects: AskSubject[]`, pushed with `addSubject(ctx, s)` in `common.ts`, which ignores duplicates.
  - Tool results are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `route plan for a public ship yields an ais subject`;
  - `bunker plan for all vessels yields subjects in plan order`;
  - `an answer with no ship tool has no subjects`;
  - `AskResponse` parses with `subjects`.
- [ ] **Step 2: Implement.** If a persisted `AskResponse` (for example the demo-ask fixture) no longer parses, stop and report. Do not edit `fixtures/**`.
- [ ] **Step 3: Run** `npx vitest run apps/api/src/ai apps/api/src/ask evals/qa/tools-crosscheck.test.ts`, and the Q&A dev replay (`w1-t6`) with `check-scorecard.sh`. Expected: PASS, exit 0.
- [ ] **Step 4: Commit.**

### Task 7: One home for the clock and the seed; `now` required

**Files:**
- Create: `packages/db/src/demo-clock.ts`
- Modify:
  - `packages/db/src/index.ts` (export `PINNED_NOW_OFFSET_MS`, `pinnedNow`, `DEFAULT_WORLD_SEED`);
  - `apps/api/src/clock.ts:9,20`, `apps/worker/src/main.ts:69`, `evals/smoke/run.test.ts:83`;
  - `apps/api/src/config.ts:51`, `apps/api/src/read/fixtures.ts:20` (delete `FIXTURE_SEED`; importers use `DEFAULT_WORLD_SEED`);
  - `apps/api/src/ingest/workflow.ts:35`, `apps/api/src/review/decide.ts:50`, `apps/api/src/executor/execute.ts:83`, `apps/api/src/ai/agent.ts:239`, `apps/api/src/app.ts:65`, `apps/api/src/read/routes.ts:25`, and their callers and tests.

**Interfaces:**
- Produces: `PINNED_NOW_OFFSET_MS = 5 * 60_000` and `pinnedNow(anchor: Date): Date` from `@pharos/db`. `now: () => Date` is required in `IngestDeps`, `ReviewDeps`, `ExecutorDeps`, the agent's dependencies, and the app and read-route options.

- [ ] **Step 1: Write the failing test.** `pinnedNow is anchor plus five minutes` in `packages/db`.
- [ ] **Step 2: Implement.** Delete every `?? (() => new Date())` in the listed modules; the typecheck finds every caller.
- [ ] **Step 3: Run** `npm run typecheck`, then `npx vitest run apps/api apps/worker packages/db evals/smoke`. Expected: PASS; `stack.test.ts` (two pinned stacks, identical bytes) passes.
- [ ] **Step 4: Run both dev replays** (`w1-t7`) and `check-scorecard.sh`. Expected: exit 0.
- [ ] **Step 5: Commit.**

### Task 8: Dead code: `executeRecommendation` and `x-pharos-data`

**Files:**
- Modify: `apps/api/src/executor/execute.ts:153-176`, `apps/api/src/executor/execute.test.ts` (around `:567`), `apps/api/src/read/routes.ts:7,26-30`, `apps/api/src/read/source.ts:17-18`, `apps/api/src/read/db-source.ts:407`, `apps/api/src/read/fixtures.ts:424`, `apps/api/src/app.ts:57`, and the tests that assert the header

- [ ] **Step 1: Move the executor tests.** Each test that forges `approved` in SQL to call `executeRecommendation` goes through `approveRecommendation`. Delete any that duplicate an existing approve test, and name each one deleted in the commit message.
- [ ] **Step 2: Delete** `executeRecommendation`, `DATA_SOURCE_HEADER`, `ReadSource.dataTag`, the header middleware and the mount-order constraint.
- [ ] **Step 3: Check no reader remains.** `grep -rn "x-pharos-data\|dataTag\|executeRecommendation" apps e2e evals scripts` prints nothing.
- [ ] **Step 4: Run** `npx vitest run apps/api`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Data-correctness guards (independent of Tasks 1–8)

**Files:**
- Create: `packages/db/drizzle/0009_*.sql` (generated), `packages/db/src/world-invariants.test.ts`
- Modify: `packages/db/src/schema.ts:156-157` (and `lightship_mt`), `packages/domain/src/route-optimiser.test.ts:~551`

- [ ] **Step 1: Write the tests.** In `world-invariants.test.ts`, on `generateWorld` with the default seed and the demo anchor:
  - `one price row per port and grade`;
  - `Port.inEca agrees with inSulphurEca for every port`.

  In `route-optimiser.test.ts`, `never worse with a load on the curve`: the existing never-worse property, with curves that carry a `load`.
- [ ] **Step 2: Run them.** Expected: PASS. If the ECA test fails, stop and report the ports that disagree. Do not change seed data or boxes, because that moves numbers.
- [ ] **Step 3: Remove the defaults.** Remove `.default(0)` from `lightship_mt`, `cargo_mt` and `ballast_mt`, then run `npm run db:generate`. Expected: a 0009 migration containing only three `DROP DEFAULT` statements.
- [ ] **Step 4: Run** `npx vitest run packages/db packages/domain apps/api`. Expected: PASS. A test that inserts vessels or voyages without these columns now fails; it gets the values explicitly.
- [ ] **Step 5: Commit.**

### Task 10: Web, approvals (consumes Tasks 1 and 3)

**Files:**
- Delete: `apps/web/src/features/approvals/option-name.ts` and its test
- Modify:
  - `apps/web/src/features/approvals/approval-card.tsx:23-45,86-124,180-199`;
  - `approvals-page.tsx` (drop the `/api/review/reference` read if names were its only use);
  - `drafts-list.tsx:14` (use `DraftedMessageList`), `audit-trail.tsx` (the shared strict type; `KEY_LABEL` stays: it is presentation).

- [ ] **Step 1: Run `pick-ui-library`.** The card's new "Option" row is a `<dl>` pair beside "Expected saving", with no new component.
- [ ] **Step 2: Write the failing tests** (`approval-card.test.tsx`):
  - `names the option from optionLabel` (`data-testid="option-name"` reads `Kestrel Marine Fuels at Marsaxlokk`);
  - `saving is the expectedSaving fact chip`;
  - `no uncited saving`: with `expectedSaving: null` it reads "not stated";
  - `fact rows show the fact labels`.
- [ ] **Step 3: Implement.** Delete `savingFactOf`, `SAVING_PATH`, `optionName` and `hasOptionFact`.
- [ ] **Step 4: Run** `npx vitest run apps/web` and `npm run typecheck`. Expected: PASS. Run `npx impeccable detect apps/web/src`. Expected: 0.
- [ ] **Step 5: Check in the browser pane.** Run `docker compose build api web && npm run demo:reset`, then the story through step 5. Check the approvals page in a fresh tab on the built bundle: the option row, the saving chip and the long fact labels, with no console errors.
- [ ] **Step 6: Commit.**

### Task 11: Web, map, assistant and evaluation (consumes Tasks 2, 3, 4, 5 and 6)

**Files:**
- Modify:
  - `apps/web/src/features/map/vessel-panel.tsx:1-4,186-220`, `apps/web/src/features/map/layer-toggles.tsx:33-38`;
  - `apps/web/src/features/assistant/answer-message.tsx:42-60`, `assistant-dock.tsx:28-34`;
  - `apps/web/src/components/primitives/tool-chips.tsx` (label map and pairing), `apps/web/src/components/source-badge.tsx` (the `model-recording` kind);
  - `apps/web/src/features/evaluation/evaluation-page.tsx:28`.

- [ ] **Step 1: Run `pick-ui-library`.** The panel uses the existing `FactCell` / `FactChip`; the failed chip and the new tag use existing tokens.
- [ ] **Step 2: Write the failing tests.**
  - Vessel panel:
    - `panel cites fuel on board`: each grade's value is a fact chip with the API's fact id, and no `MetricNumber` remains for these;
    - `panel without voyage facts` shows the plain values under the simulated tag only where the facts are null.
  - Map and answers:
    - `forecast label reads stepTimes`;
    - `show on map uses the first subject` (`vessel=` and `mmsi=` cases, and no link without subjects).
  - Assistant:
    - `chips pair by call id` (two calls of one tool, the first failing);
    - `failed chip reads failed`;
    - the tool label map is a `Record<AgentToolName, string>`;
    - `record mode shows model: recording`.
  - Evaluation: `expected-zero layout reads expectedZero`; no regex over label text remains.
- [ ] **Step 3: Implement.** Delete `mapTarget`, the `forecastLabel` arithmetic, `EXPECTED_ZERO` and the first-in-first-out pairing.
- [ ] **Step 4: Run** `npx vitest run apps/web`, `npm run typecheck` and `npx impeccable detect apps/web/src`. Expected: PASS and 0.
- [ ] **Step 5: Check in the browser pane.** After a rebuild and `demo:reset`, run the full recorded story, then check in a fresh tab on the built bundle: the vessel panel at 1440 and 390 px; the weather slider times; "Show on map" from the route answer; the tool chips; the evaluation page. No console errors.
- [ ] **Step 6: Commit.**

### Task 12: Wave gate

- [ ] **Step 1: Whole-branch review.** An opus reviewer reads `59b8c5b..HEAD` against this plan and the review; then one fix wave and a re-review.
- [ ] **Step 2: Run `npm run verify`.** Expected: exit 0, and test counts at or above Task 0's.
- [ ] **Step 3: Check the frozen paths.** Run `git diff --stat 59b8c5b -- <frozen paths from Global Constraints>`. Expected: empty. `npm run eval:golden -- --check` and `npm run eval:qa-golden -- --check` must be clean.
- [ ] **Step 4: Run both dev replays** (`w1-gate`) against the baseline with `check-scorecard.sh`. Expected: exit 0 each.
- [ ] **Step 5: Run the story twice.** `docker compose build && npm run demo:reset && npx playwright test`, twice. Expected: PASS, 0 replay misses each. Then run `STORY_SCREENSHOTS=docs npx playwright test`. Expected: PASS, with the screenshots refreshed.
- [ ] **Step 6: Record the wave.** Add a line to `MASTER_PLAN` §13, and write a hand-over note in the shared notes folder: what changed, the parked items, and what wave 2 starts from.
- [ ] **Step 7: Commit.** Do not push.
