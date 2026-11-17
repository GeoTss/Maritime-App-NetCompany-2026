# Pharos architecture review (2026-11-17)

Read-only review of `build/prototype` at `59b8c5b`, using the vocabulary of the `mattpocock-skills:codebase-design` skill: **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**, the deletion test, and "one adapter is a hypothetical seam, two are a real one". There are five slices: the API's AI core, the API's workflows and reads, the packages with the worker and the ERP simulator, the web console, and the evals with the e2e story. A separate reviewer read each slice. The lead re-checked every claim a recommendation rests on (marked ✔). Nothing was changed or run.

## Verdict

The load-bearing design holds up. `packages/domain` is pure, and its calculators are deep: one call over one parsed input. The model gateway (`apps/api/src/ai/llm.ts`) is one middleware seam with two real adapters (live `fetch` and the scripted fake), so the tests run the real tool loop in every mode. The release gate is one concern, and the grader reuses it. `apps/api/src/routing/facts.ts` is one fact builder with four callers. The ERP port is tested against the in-process simulator, and the pinned stack produces identical bytes twice.

The debt sits in three places:

- **The same knowledge is written more than once.** The clearest case is facts about one thing, built in two or three places that have already drifted apart.
- **Interfaces leak.** The web has to work out names, times and links the API already holds. Callers of ingestion and the executor have to know the call order.
- **Planning inputs are assembled in the wrong package**, and the tools re-assemble them.

None of this affects the measured numbers. Most of it can be fixed without touching a byte sent to the model.

## How to read the blast radius

| Class | Meaning | What it costs |
|---|---|---|
| **A** | Internal only. No byte sent to the model changes, nothing on a measured path changes, and the e2e story is unchanged. | Tests plus `npm run verify`. |
| **B** | Changes the API contract or the UI. No model bytes change. | Web changes and new screenshots, possibly an e2e text update. |
| **C** | Changes model request bytes: prompt, tool names/descriptions/schemas/order, tool-result or fact shape, conversation history. | `eval-bench` protocol, re-recorded replies, a paid dev measurement. The held-out split is closed, so publishing needs a fresh held-out set. |
| **D** | Changes the measured extraction path or a grader. | Proof on dev first, then a fresh held-out set before any published number moves. |

## Findings, ranked by value

### 1. Facts about one thing are built in several places, and the copies have drifted ✔ (B)

- **Bunker recommendation facts.** The tool builds them in `ai/tools/plan-bunkering.ts:47-60,147-159` with labels like `MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): quantity`. The approval view builds the *same fact ids* again in `read/db-source.ts:183-205` with different labels (`Quantity`, a different wording of the saving). It also adds an `effectivePriceUsdPerMt` fact the tool never emits. `read/fixtures.ts:357-362` uses a third id scheme. `db-source.test.ts:273` pins the different label. So one fact id carries two labels, depending on whether it appears in chat or on an approval card.
- **The web pays for it.** `apps/web/src/features/approvals/option-name.ts:29-36` regex-parses the *tool's* label format, which the view never sends. It then falls back to splitting the option id `<LOCODE>-<key>` and fuzzy-matching supplier names, using an extra `/api/review/reference` read. That is a leaky interface: the web knows the API's naming conventions, and a label edit silently breaks it.
- **The saving.** `propose-action.ts` stores a bare `expectedSavingUsd`. `approval-card.tsx:34-45` finds its fact by a regex over provenance paths and otherwise shows the number uncited.
- **Vessel panel.** `read/world-views.ts:43-69` serves fuel-on-board and ETA numbers with no facts. `ai/tools/vessel-status.ts` builds those facts, but only inside the tool. So `vessel-panel.tsx` shows animated `MetricNumber`s that cite nothing, under a "simulated data" label. This is the one place the UI is in tension with rules 2 and 6.
- **Proposed shape:**
  - A pure `bunkerPlanFactRows(plan, option, names)` shared by the tool and the view, in the same way `routing/facts.ts` serves routes.
  - A pure `vesselFacts(world, vessel, now)` shared by the tool and `VesselDetail.facts[]`.
  - `RecommendationView.optionLabel`, and `expectedSaving: Fact | null` built through `calcFact`.
  - Dependency category: in-process.
- **Deletion test:** `option-name.ts` and its test, the saving regex, and the panel's uncited numbers all disappear.
- **Constraint:** the tool's output must stay byte-identical, and the replay tests prove it. Only the approval-card labels change.
- **Effort:** M.

### 2. The API omits fields the UI then has to work out ✔ (B)

The web derives these itself:

- the weather `validAt` (`layer-toggles.tsx:34-37`, although `domain/weather-effect.ts:47` already owns the rule);
- "expected 0" metrics, found with a regex over label text (`evaluation-page.tsx:28`, labels written in `evals/publish.ts`);
- its own `DraftView` (`drafts-list.tsx:14`; `approvals/routes.ts:68` returns an untyped list);
- an audit key map (`audit-trail.tsx:15`), because `AuditEventView` is `kind: string, detail: Json`, not strict, with two writers (`execute.ts:85`, `decide.ts:159`);
- the "Show on map" target, found by matching vessel names in the answer prose (`answer-message.tsx:42-53`);
- the "model: live" badge in record mode (`assistant-dock.tsx:31-33`), although the per-call truth already exists (`agent.ts:288`).

- **Proposed shape:**
  - `WeatherStep.validAt`, from the domain helper;
  - `EvalMetric.expectedZero`;
  - a shared `DraftedMessageView`;
  - a per-kind audit event union with one writer;
  - `AskResult.calculations: [{id, kind, vesselId | mmsi}]` (or a `subject`);
  - `AskResult.modelSource`.
  - Dependency category: remote-but-owned, through `packages/shared`.
- **Also:** the ERP idempotency key shows in the audit detail and the supplier draft (`execute.ts:413,505,612`). It embeds the wall-time `seeded_at`, so on the pinned demo it is the only value that changes on every reseed.
- **Effort:** S–M. Most of the payoff is in the web, so this pairs naturally with the UI round.

### 3. Planning inputs are assembled in `packages/db`, and the tools re-assemble them ✔ (A)

- **Where it lives now:** `db/src/seed/demo-plan.ts:106-250` (`buildBunkerPlanInput`, `voyageState`, `fobProjectionInput`) and `db/src/route-plan.ts` hold production rules: the Gibraltar spur, bunkering hours, the congestion source, price, ETS market. Several of their values are seed constants (`SAFETY_MARGIN_DAYS = DEMO_SCENARIO.safetyMarginDays`). The `World` type lives in `db/seed/types.ts`, which is why this code can't sit next to the domain.
- **Re-assembly:** `ai/tools/emissions.ts:41-80` re-assembles the fuel-on-board projection, CO₂, ETS and CII by hand. `plan-bunkering.ts` makes two calls.
- **Duplicated rules:**
  - **Fuel price lookup, three readers.** `demo-plan.ts:221` takes the *first* row (`find`), `route-plan.ts:71-79` the *latest `asOf`*, and `ingest/resolve.ts:124` filters. Checked against the seed: today they agree, because the seed writes exactly one row per port and grade and nothing else writes price rows. They would disagree the moment a second price row lands, for example from a price feed.
  - **ETS market and year, three readers:** `route-plan.ts:85`, `demo-plan.ts:150`, `emissions.ts:49`.
  - **Speed step 0.5 kn, twice:** `route-plan.ts:54` and `domain/constants.ts:137`.
  - **Three notions of the emission-control area:**
    - the hand-set `Port.inEca`;
    - the `searoute-ts` `ecaFraction` baked into the legs;
    - `domain/eca.ts` `inSulphurEca`.
- **Hidden cost:** `loadWorld` reads all 16 tables on every tool call (13 call sites), and every rule then does linear scans. The interface hides that, and every test needs a full world.
- **Proposed shape:**
  - Move `World` and `RoutePlan` to `shared`. Put a planning module next to `domain` exposing `planVoyageBunkers(world, voyageId, offers)`, `voyageEmissions(world, voyageId)`, `latestPrice` and `readMarket`.
  - Memoise `loadWorld` per request, or add a narrower `loadVoyageContext`.
  - Add an agreement test between `Port.inEca` and `inSulphurEca`.
  - Dependency category: in-process.
- **Constraint:** a pure move. Leave `DOMAIN_CODE_VERSION` and every output alone. Pin "one price row per port and grade" with a seed test before unifying the lookup.
- **Effort:** M.

### 4. There is no Conversation module, so multi-turn answers disown earlier figures ✔ (C)

- **Parked P23, corrected.** The gate *does* get earlier turns' facts (`agent.ts:250`, `fact-ledger.ts`). The model does not: `loadHistory` (`agent.ts:191-204`) sends only the questions and released answer text. So a later answer can't cite earlier figures and adds a caveat instead.
- **The test hides it.** `agent.test.ts:349-373` has the scripted model cite an id taken from turn 1's request, which a real model never sees.
- **The stored shape has no owner.** One module writes `messages.content` (an untyped jsonb). Five places read it, each with a private copy of the shape:
  - `agent.ts:185`
  - `fact-ledger.ts:9`
  - `read/db-source.ts:259`
  - `evals/qa/run.ts:413,460`
  - `evals/compare/run.ts:400`
- **Proposed shape:** `ai/conversation.ts` owns the rows, Zod schemas for the stored content, `open(id | null) → {id, history, facts}`, `recordTurn(...)`, and one `historyForModel`. That function renders earlier facts (`id, label, value, unit`) as a delimited data block. Dependency category: local-substitutable (the Postgres test container); the rendering is in-process.
- **Blast radius:** turn 2 and later change bytes. The single-turn Q&A benchmark is unaffected, but there is no multi-turn golden case to measure the change, so it needs new dev cases. The story's follow-up asks must be re-recorded.
- **Value:** it is the top "what would come next" item in `docs/APPROACH.md`, and the only finding the user sees in a live demo.
- **Effort:** M, plus a paid dev pass.

### 5. Adding a tool touches about seven places ✔ (A)

- **The places:**
  - the registry list in `agent.ts:19-28,95-107`;
  - the prompt's tool list (`prompts/agent-system.ts:23-32`) and a `PROMPT_VERSION` bump;
  - a web label in `tool-chips.tsx:24-34`;
  - two hard-coded lists in `agent.test.ts`;
  - possibly the gate's `FACT_UNITS` and `identifierValues`.
- **Repeated wrapping:** every tool repeats the same `runTool` + `betaZodTool` + `JSON.stringify` wrapping, and forgetting `runTool` drops its facts from the ledger.
- **The checklist is incomplete:** CLAUDE.md's "Adding an agent tool" checklist leaves out the prompt, the web label and the gate vocabulary.
- **Shared fact vocabulary, spread out:**
  - the fact-id alphabet is written in three places (`shared/facts.ts:5`, `release-gate.ts:214`, `tools/common.ts:62`);
  - the calculate operations are listed three times;
  - `Fact.unit` is a free string, so a unit missing from `FACT_UNITS` silently skips the unit check;
  - `apps/web/src/features/map/route-facts.ts:37-52` copies provenance paths from `routing/facts.ts`;
  - `routing/` imports fact constructors from `ai/tools/common.ts`.
- **Proposed shape:**
  - `tools/registry.ts` with `defineTool({name, description, inputSchema, run})`;
  - an `AgentToolName` enum in shared, used by `AskEvent.progress.tool` and an exhaustive web label map;
  - tests that iterate the registry;
  - a `KnownFactUnit` type with an exhaustive `Record` in the gate;
  - fact constructors and path constants in their own module;
  - an updated CLAUDE.md checklist.
  - Keep the prompt text hand-written.
- **Constraint:** names, descriptions, schemas and order stay byte-identical. The gate's *behaviour* must not change, because `evals/qa/grade.ts` imports it and "grounded" would move.
- **Effort:** S–M.

### 6. Progress events can't be paired, and a failed tool shows as done ✔ (A)

- **Failure looks like success:** `withProgress` sends `finished` in a `finally` (`agent.ts:121`), so a tool that throws is reported as finished.
- **Pairing depends on an unstated rule:** the web pairs events first-in-first-out per tool (`tool-chips.tsx:39-55`). That is correct only because `ctx.serial` runs calls one at a time, a rule spread across three modules that none of them states.
- **The type is defined twice:** `ToolProgress` duplicates `AskEvent.progress`.
- **Failure classification exists three times** (`ask/routes.ts:47-63`, `ask/stream.ts:16-21`, `evals/qa/run.ts:293-302`), and the eval regex-parses `AgentError.message`.
- **Proposed shape:**
  - a call id from the SDK's `toolUse.id`;
  - a `failed` phase;
  - the type derived from `AskEvent`;
  - `AgentError.reason`, plus one `classifyAskFailure`, keeping the scorecard's error-kind mapping identical.
- **Effort:** S.

### 7. The ingestion and review lifecycle pushes call order onto callers (A)

- **Call order and boot:**
  - "The caller starts `processDocument`" is a rule followed at `workflow.ts:51` and again at `decide.ts:275`.
  - The start-and-track code is repeated in `inbox/routes.ts:41-48` and `review/routes.ts:91-96`.
  - Deliver-next picks and hashes the email inside the route.
  - The boot-resume SQL (`server.ts:65-70`) is untested.
- **Duplicated writes:**
  - the quote insert (`workflow.ts:186-199`, `decide.ts:229-242`);
  - the pending-extraction insert;
  - `dayStart`;
  - "the first line with an open requirement" (`evaluate.ts:946-950`, `decide.ts:216-227`).
- **Proposed shape:** one ingestion module taking `{sql, extractor, now, log, schedule}` and offering `submit`, `deliverNextDemo`, `retry`, `accept` and `recoverOnBoot`. The `Extractor` port stays as it is (production plus the scripted fake makes it a real seam). Dependency category: local-substitutable.
- **Constraint:** `ExtractInput` and `evaluate` are unchanged, so the measured extraction path doesn't move.
- **Effort:** M.

### 8. The executor is deep outside but mixes two strategies inside ✔ (A)

- **Two strategies tangled:** `execute.ts` branches on `rec.type` three times (`:171`, `:216`, `:356`). It repeats a seven-table join (`:430-440`, `:590-600`) and the load-and-parse of the calculation.
- **Dead code:** `executeRecommendation` (`:153`) has no production caller, and its test forges `approved` in SQL.
- **A read in the write module:** `draftsOf` is a read living there.
- **Stored calculations have no contract:** route-speed inputs are written as an untyped literal (`routing/plan.ts:221-230`) and read back by two different partial schemas (`db-source.ts:212`, `execute.ts:228`).
- **Proposed shape:** keep the approve/reject interface. Inside it, a table of execution types with two adapters (purchase order, voyage instruction), so the seam is real. One context query. Move `draftsOf` to the read side. Add a `RouteSpeedCalculationInputs` schema in shared, type-checked on write (no reshaping, since fact paths into it reach the model) and parsed on read.
- **Effort:** M.

### 9. `ReadSource` has two adapters, one of them drifted, and covers half the reads ✔ (A)

- **The fixture adapter has drifted:** it emits check names the pipeline never produces (`fixtures.ts:287-288` against `CHECK_NAMES` at `evaluate.ts:56`).
- **A header nobody reads still dictates mount order:** `dataTag` / `x-pharos-data` has no reader in `apps/web` or `e2e`, yet it forces the route mount order (`app.ts:57`).
- **Tests build it just to mount:** `read` is the one required dependency of `createStackApp`, so about ten route tests build a fixture source only to mount the app.
- **Reads that bypass the seam:** `live/routes.ts:72-176` (inline SQL), `draftsOf`, and review's `listReviewItems` / `reviewReference`.
- **`fixtures.ts` is really the demo corpus:** `scripts/make-demo-inbox.ts`, `evals/qa/reference.ts`, `evals/compare/run.ts` and `ask/demo-fixture.ts` all import it.
- **Proposed shape:** delete `dataTag`, make `read` optional, move the corpus to its own module, and test reads against `db-source` on the test container.
- **Constraint:** keep the `.eml` bytes in `fixtures/demo-inbox/` identical.
- **Effort:** M.

### 10. The clock and the demo constants each have more than one home ✔ (A)

- **Repeated constants:**
  - the 5-minute pinned offset is written three times (`api/clock.ts:9`, `worker/main.ts:69`, `evals/smoke/run.test.ts:83`);
  - the seed is written three times (`api/config.ts:51`, `db/cli/world-seed.ts:2`, `read/fixtures.ts:20`).
- **Silent wall-clock fallback:** `ingest/workflow.ts:35`, `review/decide.ts:50`, `executor/execute.ts:83` and `ai/agent.ts:239` each fall back to `new Date()` when no `now` is passed. Today only tests hit those paths, but a forgotten `now` would silently unpin the demo.
- **Proposed shape:** one export, owned by the package that anchors the world, and a required `now`.
- **Effort:** S.

### 11. The live-data seams are real but half bypassed (A–B)

- **AIS and weather:**
  - `AisProvider` has three adapters (live, replay, simulator), but pinned recorded loading (`integrations/recorded.ts:149`) rebases the capture and calls `ingestBatch` directly, so there are two recorded AIS paths.
  - The weather snapshot is read twice, with `floorToHour` defined twice.
  - The mode is chosen in three places, and `baseline.ts:35` infers the weather mode from the string `"open-meteo"`.
  - Parked: `onSocket` is fire-and-forget, so status writes can race, and a shutdown abort is reported as "down".
- **Traffic:**
  - `ais_traffic` is one mutable row per MMSI that facts cite by MMSI, so a cited draught stops resolving after the next report.
  - Raw snake_case SQL on the AIS tables appears at nine sites.
  - `TRAFFIC_LIMIT = 2000` applies silently (`live/routes.ts:33,74`).
  - Fleet AIS twins are filtered on the client (`map-data.ts:99-105`), so they flash while `/api/vessels` loads.
- **Proposed shape:**
  - a recorded adapter per provider, with `loadRecordedSources` built on them;
  - one `selectSources(cfg)`;
  - `onSocket` carrying a reason;
  - an append-only observation table (or snapshot id) behind one `trafficStore`, keeping the fact `rowId` format;
  - `/api/traffic` excluding fleet MMSIs.
  - Dependency category: true external for AISStream and Open-Meteo, mocked with fixtures; local-substitutable for the store.
- **Effort:** M (M–L with the observation table).

### 12. The evaluation pass lifecycle is copied between runners ✔ (A, guard-sensitive)

- **The copy:** `evals/qa/run.ts` imports about 20 lifecycle names from `evals/extraction/run.ts` (`withRunLock`, `createReportDir`, `resumeHint`, `writeFaultReport`, signal types and more) and copies the rest near line for line. Compare `extraction/run.ts:1076-1195,1286-1380` with `qa/run.ts:565-665,700-840`: guard, estimate, spend guard, lock, signals, the per-item loop, interim scorecards, post-run checks.
- **Parked items that live in this copy:**
  - in the extraction runner only, a cleanup throw hides the post-run checks;
  - there is a SIGKILL window between the rows append and the scorecard write, which is also a non-atomic `writeFileSync`;
  - the resume hint for hard-case repeats is wrong.
- **Merge and publish:** `merge.ts` and `publish.ts` read scorecards by dotted string path with casts, so renaming a scorecard field fails only at publish time.
- **Proposed shape:**
  - `evals/lib/pass.ts` with a `runPass(suiteAdapter)`. Extraction and Q&A are the two adapters, so the seam is real.
  - An atomic scorecard write (temp file, then rename).
  - Each scorecard exporting `parseReport` and `headlineMetrics`.
- **Constraint:** the run-once guard is load-bearing. Lock its call order (pass row, then the rows append, then the scorecard) with tests first, and check that publish produces identical JSON against `evals/published/summary.json`.
- **Value:** moderate. It only matters if more passes run, but any fresh held-out set (for findings 4 and 15) will run through this code.
- **Effort:** L, in two steps.

### 13. The web's query layer has no single home (B)

- **Strengths:** `lib/api.ts` is the best module on the web side: one parse boundary with `ApiFailure`. `lib/sse.ts` with `assistant-store.ts` and the command-menu registration are deep too.
- **Scattered queries:** query hooks are split between `lib/queries.ts` and `features/map/map-data.ts`. Four pages inline their own queries and mutations, and `inbox-page.tsx:106` repeats the `/api/inbox` query function from `:55`.
- **Cross-page links have no owner:** cross-feature URL contracts (`?vessel=`, `?mmsi=`, `/inbox?document=`) are string templates written by producers and parsed by consumers.
- **Bundle:** `kit-page.tsx` (814 lines, a dev design kit) ships in the production bundle. With MapLibre, that is the likely cause of the chunk over 500 kB.
- **Naming and placement:** `components/primitives/approval-card.tsx` and `features/approvals/approval-card.tsx` share a name but not a role. `map-fixtures.ts` is test-only data sitting in product code.
- **Proposed shape:**
  - per-domain `*-data.ts` hooks, with each mutation stating its own invalidation;
  - typed route helpers for the URL contracts;
  - `React.lazy` for the kit page and the map route;
  - rename the primitive to `decision-card`;
  - move the fixtures under a test folder.
- **Effort:** S–M. This belongs in the UI round.

### 14. Data-correctness guards are missing (A)

- **Silent zero defaults:** migration 0008 and `schema.ts:156-157` give `cargo_mt`, `ballast_mt` and `lightship_mt` a default of 0. A missing load silently reads as lightship, and the load factor then cuts main-engine burn. Backfill, then drop the defaults.
- **Test gaps:**
  - no seed test pins "route B recommended" for the demo vessel (`route-plan.test.ts:175` checks only that B is feasible);
  - the never-worse property (`route-optimiser.test.ts:551`) never puts a load on the curve.
- **Effort:** S each. Test-only, or no change to any value.

### 15. Leave on the measured path for now (D)

- **Price normaliser:** `normalise.ts:73` rejects "EUR 690 / mt" and "USD / MT". The fix collapses whitespace around `/`. It would move extraction results, probably upward.
- **Grader limits:** the comparison verdict word is not graded, and `statesInstant` matches date and time independently. A grader change moves graded outcomes.
- **Lowest value:** an internal split of `ingest/evaluate.ts` (the quoted-thread logic at `:440-602` into `thread.ts`) behind the same interface. Check order and detail strings must stay identical.
- **Constraint:** each item needs dev proof, then a fresh held-out set before any published number changes.

### Smaller items

- **e2e:** `e2e/demo.spec.ts` keeps its own mode-to-expectation map and its own Haiku literal.
- **`demo-live`:** its `want.ais` check times out only when someone sets `AIS_MODE` to replay or off themselves. Plain `npm run demo:live` is fine, as confirmed by the Phase 7 session. Fix: map replay/off to "recorded" before comparing.
- **`qa/generate.ts`:** it accretes per-phase review renderers that need git history. The extraction runner's `main()` takes no argv, while Q&A's takes it.
- **Small fixes:** the scorecard markdown writes "95 %"; `MASTER_PLAN` §7 counts are out of date.

## Do not touch, unless you mean to re-record and re-measure

- Prompt text, tool names, descriptions, input schemas and their order.
- Fact labels and the `ToolResult` JSON (the Q&A grader parses fact labels).
- The parse-email `bodyText` / `sourceText` format.
- `fixtures/demo-inbox/*.eml` and `fixtures/recorded/*`.
- The seed's `DEMO_SCENARIO` numbers and `DOMAIN_CODE_VERSION`.
- `evals/heldout-passes.jsonl`, `evals/golden/**` and the grader logic.
- `apps/web/src/components/ui/*` (shadcn, edited in place) and the `FactText` / `FactChip` / untrusted-text rendering contract.

## Suggested order

1. **Wave 1, facts and contracts (A + B, no model bytes): findings 1, 2, 5, 6, 10 and 14, plus the dead code in 8 and 9.**
   - The strongest evidence: three reviewers found finding 1 independently.
   - It closes the UI's one rule tension.
   - It deletes web workaround code, so it sets up the UI improvements round.
2. **Wave 2, structure (A): findings 3, 7, 8, 9 and 11, and 12 if more evaluation passes are planned.** These are pure moves behind unchanged interfaces, each provable with the existing tests and a recorded story run.
3. **Wave 3, measured changes (C / D): finding 4 (multi-turn facts, which needs new multi-turn dev cases and a budget), then finding 15.** Publishing either needs a fresh held-out set, because the current one is closed.
