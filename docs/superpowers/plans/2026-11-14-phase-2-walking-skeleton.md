# Phase 2 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The thinnest live path through Pharos: a supplier email delivered through the inbox becomes a quote record, a plain-language question gets a tool-backed answer whose every number is a cited fact, and the agent's proposal is approved by a human and pushed to the ERP simulator as a purchase order, all visible in a bare web page, with the latency and cost of every model call measured.

**Architecture:** Everything runs in `apps/api`. One LLM gateway (an `Anthropic` client with a custom `fetch`) gives `LLM_MODE=live|record|replay` and records usage/latency/cost of every call in `llm_calls`. Ingestion is a fixed in-process workflow (parse → LLM extract → code normalise/verify/resolve → quote or review). The ops agent is one tool-runner loop over three typed tools (vessel status, bunker plan, propose action) that return facts; a code release gate checks every number in the answer against those facts before it is shown. Approval runs a code executor that writes the order and pushes it to the ERP simulator with an idempotency key. Read routes switch from fixtures to the database.

**Tech Stack:** `@anthropic-ai/sdk` 1.8.0 (`messages.parse` + `zodOutputFormat`, `beta.messages.toolRunner` + `betaZodTool`), Claude Opus 5.5, Hono, postal-mime, html-to-text, Drizzle/Postgres, Zod 4, Vitest. No new dependencies.

**Spec:** `docs/MASTER_PLAN.md` — §1 demo story, §3 deterministic maths, §6 runtime AI pipeline, §7 B (grounding graders, for the gate's shape), §10 Phase 2 row (gate: *works live end to end; latency and real cost per call measured*). Read with `CLAUDE.md`. Anyone touching `apps/api/src/ai/` loads the `claude-api` skill first.

## Global Constraints

- **The model never computes a number.** Quantities, prices, totals, savings, ETAs come from `packages/domain` via tools; the model transcribes email values as written (Phase 1 `ExtractionOutput`) and chooses tools. Normalisation (currency, unit, grade, number parsing) is pure code in `packages/domain`.
- **Every number shown is a fact.** Tool results carry `facts[]` (`Fact` from `@pharos/shared`); the release gate withholds any answer containing a number that matches no fact at its displayed precision (one automatic repair turn first).
- **The model only proposes.** `propose_action` inserts a *pending* recommendation that references a stored `calculations` row and an `optionId`; it accepts no quantity, price or speed (`ProposedAction` is strict). Orders are written only by the executor after `POST /api/recommendations/:id/approve`. Nothing is sent to external parties; the ERP simulator is internal.
- **Email content is untrusted data**, passed inside `<email_document>` delimiters (any literal closing tag in the body escaped), never as instructions.
- **Model settings:** model `claude-opus-5-5` for both prompts (env `EXTRACT_MODEL`, `AGENT_MODEL`); thinking is always on for this model — omit `thinking`, set `output_config.effort` explicitly (env `EXTRACT_EFFORT`, `AGENT_EFFORT`, default `medium`); forced `tool_choice` `any`/`tool` returns 400 on this model — use `auto`; no assistant prefill. Refusal fallbacks **on in the app** (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`), **off in eval/test runs** (env `LLM_FALLBACKS=on|off`, default `on`). Static system prompts carry `cache_control`.
- **LLM modes:** `live` calls the API; `record` calls it and writes each request/response pair to `RECORDINGS_DIR` (default `fixtures/llm-recordings`); `replay` serves only recordings and throws `ReplayMissError` (naming the request key) on a miss. Tests run in replay against a database seeded with `anchor = 2026-11-14T08:00:00Z`, seed `20261114`. Reported latency/cost come from live runs only.
- **Keys:** never read, print or log `.env` or key values. Host scripts that need the key load it with `tsx --env-file=.env …`; containers get it from Compose.
- **Spend:** Phase 2 live calls (recording + smoke) are expected to cost under $2; stop and report if a single run exceeds $1.
- Prompt files live in `apps/api/src/ai/prompts/` and carry a `PROMPT_VERSION` string stored on each extraction. Editing them marks the live-smoke requirement (Stop hook) once `npm run eval:smoke` exists (Task 9).
- No new npm dependencies; only the lead changes the lockfile. Local commits per task on `build/prototype`; never push.

## Review Focus

1. **Delivering the same email twice** (button double-click, re-upload) must not create a second document or quote: dedupe by `documents.sha256`, return the existing document id with `duplicate: true`. → Task 6 test `redelivery is idempotent`.
2. **Approving the same recommendation twice, or approving while the ERP is down,** must create exactly one purchase order; an ERP outage leaves the order `erpSyncStatus: "failed"` and the recommendation `approved` (not executed), and a later approve retries the push with the same idempotency key. → Task 8 tests.
3. **A model answer with an uncited or self-computed number** ("that is $8,000 cheaper") must never reach the user: after one repair turn it is withheld with `gate.passed: false` and the offending numbers listed. → Task 7 tests `withholds after a failed repair`.
4. **A replay miss** (prompt or tool output changed without re-recording) must fail loudly with the request key and the recording path, never silently call the live API. → Task 3 test.
5. **An email that is not a quote, or a quote for an unknown vessel/port/supplier,** must not create a quote: status `not_a_quote` or `needs_review` with the failed check named, document still visible in the inbox. → Task 6 tests.

---

### Task 1: Contracts for ingestion, ask, approval, ERP and LLM metrics (lead)

**Files:** Modify `packages/shared/src/api.ts`, `packages/shared/src/entities.ts`, `packages/shared/src/index.ts`; Create `packages/shared/src/providers/erp.ts`; Test `packages/shared/src/contracts.test.ts` (extend).

**Interfaces — Produces:**

- `entities.ts`: `LlmCall {id, purpose ∈ extract|agent, model, mode ∈ live|record|replay, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, latencyMs, costUsd, stopReason: string|null, requestKey: string, documentId: Id|null, conversationId: Id|null, createdAt}`.
- `api.ts`: `DeliverResult {documentId: Id, duplicate: boolean, remaining: number}` (deliver-next; `remaining` = undelivered demo emails); `UploadResult {documentId, duplicate}`; `AskRequest {question: string (1..2000), conversationId: Id|null}`; `GateResult {passed: boolean, repaired: boolean, ungroundedNumbers: string[]}`; `AskResponse {conversationId: Id, messageId: Id, answer: string|null (null when withheld), facts: Fact[], gate: GateResult, recommendationIds: Id[], llmCallIds: Id[]}`; `DecisionResult {recommendationId, status: RecommendationStatus, orderId: Id|null, erpPoNumber: string|null, erpSyncStatus: "pending"|"synced"|"failed"|null}`; `LlmCallView` = `LlmCall` with `createdAt: IsoDateTime`.
- `providers/erp.ts`: `ErpOrderRequest {supplierErpCode, vesselImo, port: unlocode, currency, lines: {grade, qtyMt>0, pricePerMt>0}[] (min 1), bargeFee≥0, reference: string}`, `ErpOrderResponse {poNumber: string, status: "confirmed", createdAt: IsoDateTime, duplicate: boolean}`. Header contract: `Idempotency-Key` (required).
- [ ] Tests: `AskResponse` with `answer: null` and `gate.passed: false` parses; `ErpOrderRequest` rejects empty lines and qty 0; `LlmCall` rejects negative tokens. Run `npx vitest run packages/shared` → PASS; `npm run typecheck` → PASS.

### Task 2: DB — `llm_calls`, `loadWorld`, quote-driven planner input (domain-data-engineer)

**Files:** Modify `packages/db/src/schema.ts` (+ generated `drizzle/0001_*.sql`), `packages/db/src/seed/demo-plan.ts`, `packages/db/src/index.ts`; Create `packages/db/src/load-world.ts`; Test `packages/db/src/load-world.db.test.ts`, `packages/db/src/seed/demo-plan.test.ts`, extend `schema.test.ts`.

**Interfaces:**

- Consumes: `LlmCall` (Task 1); `World`, `generateWorld`, `seedDatabase`, `buildDemoBunkerPlanInput` (Phase 1).
- Produces:
  - table `llm_calls` mirroring `LlmCall` (FKs to documents/conversations nullable); migration via `npm run db:generate`.
  - `loadWorld(sql: Sql): Promise<World>` — reads every world table in id order (and `world_meta`), returns a `World` that passes `World.parse`.
  - `BunkerOffer {optionId, quoteId: Id|null, supplierId, portId, currency, pricePerMt, bargeFee, qtyMt}` and `buildBunkerPlanInput(world: World, voyageId: Id, offers: BunkerOffer[]): BunkerPlanInput` — same rules as Phase 1's `buildDemoBunkerPlanInput` (requirement qty, FOB shortfall, tank free, ETS coverage, berth slack, market rates, waits from latest congestion, robAtArrival per port) with `deviationNm = port.approachNm` and `bunkeringHours = DEFAULT_BUNKERING_HOURS = 6`. `buildDemoBunkerPlanInput` becomes a thin wrapper mapping `DEMO_SCENARIO.options` to offers.
  - `optionIdFor(port: Port, supplier: Supplier): string` = `${port.unlocode}-${supplierKey}` (the scheme Phase 1 uses, e.g. `MTMLA-kestrel`), so live quotes and demo options share ids.
- [ ] Tests: `loadWorld after seedDatabase(reset) deep-equals generateWorld for the same seed and anchor` (JSON-compare; skips visibly without Postgres like Phase 1's DB test); `buildBunkerPlanInput from offers equal to the demo options gives the same planBunkers result as buildDemoBunkerPlanInput` (identical JSON); every port used by the demo has `approachNm` equal to its demo `deviationNm` (otherwise fix the scenario, not the test); schema mirror includes `LlmCall`. Run `npx vitest run packages/db` → PASS.

### Task 3: Domain normalisers (domain-data-engineer)

**Files:** Create `packages/domain/src/normalise.ts`, `packages/domain/src/normalise.test.ts`; Modify `packages/domain/src/index.ts`.

**Interfaces — Produces** (pure, no throws on bad text — return `null`):

- `parseAmount(asWritten: string): number | null` — first number in the string; accepts `1,234.5`, `1 234,5` is **null** (ambiguous decimal comma), `738`, `9,000`; a range or alternatives (`300/350`, `300-350`, `300 to 350`, `abt 300`) → `null`.
- `normaliseCurrency(raw: string | null): Currency | null` — `USD|US$|$|usd|U.S. dollars` → `USD`; `EUR|€|eur|euro(s)` → `EUR`; else `null`.
- `normaliseMassUnit(raw: string | null): "mt" | null` — `mt|MT|mts|t|tonnes|metric tons|metric tonnes` → `mt`; `m3|cbm|litres` → `null` (needs density: review).
- `normalisePerUnit(raw: string | null): "per_mt" | "lump_sum" | null` — `mt|pmt|per mt|/mt|per metric ton` → `per_mt`; `lump sum|ls|lumpsum` → `lump_sum`.
- `normaliseGrade(raw: string | null): FuelGrade | null` — contains `LSMGO`, `MGO`, `DMA` with 0.1 → `LSMGO`; `VLSFO`, `0.5%` fuel oil → `VLSFO`; `HSFO`, `IFO380`, `RMG380`, `3.5%` → `HSFO`; ambiguous (both) → `null`.
- `evidenceSupports(source: string, evidence: string | null, asWritten: string | null): boolean` — after collapsing whitespace and lower-casing: `evidence` is a substring of `source` and `asWritten` (if given) is a substring of `evidence`.
- [ ] Tests: one table-driven test per function with the cases above plus `null`/empty input; determinism. `npx vitest run packages/domain && npm run check:purity` → PASS.

### Task 4: ERP simulator orders (integrations-engineer)

**Files:** Modify `services/erp-sim/src/app.ts`, `services/erp-sim/src/app.test.ts`.

**Interfaces:** Consumes `ErpOrderRequest`, `ErpOrderResponse` (Task 1). Produces `POST /orders` (body validated with Zod; header `Idempotency-Key` required → 400 `{error:"idempotency_key_required"}` if missing) → 201 with `ErpOrderResponse` (`poNumber` = `PO-` + 6-digit zero-padded sequence starting `000001`, `duplicate:false`); same key again → 200, same `poNumber`, `duplicate:true`; same key with a different body → 409 `{error:"idempotency_conflict"}`. `GET /orders/:poNumber` → 200 order or 404. In-memory store; `createErpApp({ now: () => Date })` injects the clock.
- [ ] Tests for each status above. `npx vitest run services/erp-sim` → PASS.

### Task 5: LLM gateway — live/record/replay, metrics, cost (ai-backend-engineer)

**Files:** Create `apps/api/src/ai/llm.ts`, `apps/api/src/ai/pricing.ts`, `apps/api/src/ai/llm.test.ts`, `apps/api/src/ai/pricing.test.ts`; Modify `apps/api/src/config.ts` (+ test).

**Interfaces:**

- Consumes: `LlmMode`, `LlmCall` (Task 1); `llm_calls` table (Task 2).
- Produces:
  - `AppConfig` gains `extractModel`, `agentModel` (default `claude-opus-5-5`), `extractEffort`, `agentEffort` (`low|medium|high|xhigh|max`, default `medium`), `llmFallbacks: boolean` (env `LLM_FALLBACKS`, default on), `recordingsDir` (env `RECORDINGS_DIR`, default `<repo>/fixtures/llm-recordings`).
  - `createLlm(opts: {mode, apiKey?, recordingsDir, onCall: (m: CallMetrics) => void | Promise<void>}): { client: Anthropic }` — the client's custom `fetch` computes `requestKey = sha256(canonical JSON of the request body + method + path)`; `live` forwards; `record` forwards and writes `<recordingsDir>/<requestKey>.json` `{request, response: {status, headers subset, body}}`; `replay` returns the stored response or throws `ReplayMissError(requestKey, path)`. Every call reports `CallMetrics {requestKey, model, latencyMs, usage, stopReason, mode}` to `onCall` (replay reports latency 0). Canonical JSON = keys sorted recursively.
  - `costUsd(model: string, usage): number` with a per-model table in `pricing.ts` (Opus 5.5: $4 input, $20 output, $0.20 cache read, 1.25× input for 5-minute cache writes, per MTok; source comment: claude-api skill model table, cached 2026-11-03).
  - `recordLlmCall(sql, purpose, metrics, links): Promise<Id>` inserting into `llm_calls`.
- [ ] Tests: replay hit returns the recorded body; replay miss throws `ReplayMissError` naming key and path and **never calls the network** (inject a throwing base fetch); record writes the file and returns the live body; same body with keys in a different order → same key; `costUsd` hand example: 1 000 input + 500 output + 2 000 cache read on Opus 5.5 = 0.004 + 0.010 + 0.0004 = **$0.0144**; config defaults and `LLM_FALLBACKS=off`.

### Task 6: Demo inbox fixtures + ingestion workflow (eval-engineer for fixtures, then ai-backend-engineer)

**6a — fixtures (eval-engineer). Files:** Create `scripts/make-demo-inbox.ts`, `scripts/make-demo-inbox.test.ts`, `fixtures/demo-inbox/01-kestrel-marsaxlokk.eml`, `fixtures/demo-inbox/02-straitline-gibraltar.eml`; Modify `apps/api/src/read/fixtures.ts` (export only). Export `buildDemoEmails` from `apps/api/src/read/fixtures.ts` and build both `.eml` files (RFC 5322, `text/plain; charset=utf-8`, fixed `Date:` and `Message-ID:`) from its Kestrel and Strait Line bodies (Strait Line as plain text in Phase 2; the PDF and HTML variants arrive in Phase 3). `--check` mode exits 1 if the files on disk differ. Test: running the builder reproduces the committed files byte for byte.

**6b — ingestion (ai-backend-engineer). Files:** Create `apps/api/src/ingest/parse-email.ts`, `apps/api/src/ingest/workflow.ts`, `apps/api/src/ingest/resolve.ts`, `apps/api/src/ai/prompts/extract-quote.ts`, `apps/api/src/ai/extract.ts`, `apps/api/src/inbox/routes.ts`, tests beside each.

**Interfaces:**

- Consumes: Tasks 1–3, 5; `ExtractionOutput`; demo inbox files.
- Produces:
  - `parseEmail(raw: Uint8Array): Promise<ParsedEmail {sender, subject, receivedAt, bodyText, sha256}>` (postal-mime; HTML-only bodies via html-to-text; `sha256` of the raw bytes).
  - `Extractor` interface `{ extract(doc: {subject, sender, bodyText}): Promise<{output: ExtractionOutput, metrics}> }`; `createLlmExtractor(llm, config)` uses `client.messages.parse` with `zodOutputFormat(ExtractionOutput)`, the system prompt from `prompts/extract-quote.ts` (`PROMPT_VERSION = "extract-quote/v1"`), the email inside `<email_document>` delimiters.
  - `ingestRaw(deps, raw, source): Promise<{documentId, duplicate}>` — dedupe by sha256 → insert `documents` → return; then (not awaited by the route) run `processDocument(deps, documentId)`: extract → `extractions` row (`rawOutput`, `fieldEvidence`, `promptVersion`, `model`) → checks (`evidence_found` per field via `evidenceSupports`, `currency_known`, `unit_known`, `grade_known`, `quantity_unambiguous`, `vessel_resolved`, `port_resolved`, `supplier_resolved` by sender domain, `price_within_band` ±15 % of the port's market price, `requirement_found`) → if all pass: `quotes` (`status "received"`, `requirementId`) + `quote_lines` with normalised values; else extraction `needs_review`; `not_a_quote` → extraction status `not_a_quote`. Failures → extraction `failed` with the error message. Every LLM call recorded via `recordLlmCall`.
  - Routes: `POST /api/inbox/upload` (raw `.eml` body, `message/rfc822` or `application/octet-stream`) → 202 `UploadResult`; `POST /api/inbox/deliver-next` → 202 `DeliverResult` (next file in `fixtures/demo-inbox/` by name whose sha256 is not yet in `documents`; 409 `{error:"inbox_empty"}` when none remain).
- [ ] Tests (code steps with a fake `Extractor`; DB tests skip visibly without Postgres): `clean Kestrel email becomes a received quote with normalised USD 738/mt, 300 mt LSMGO, barge 2800, port MTMLA, supplier Kestrel`; `redelivery is idempotent`; `not_a_quote output stores no quote`; `unknown vessel → needs_review with vessel_resolved failed`; `evidence not in source → needs_review`; `quantity null (as-written range) → needs_review`. Replay test: record the two real extractions once (`LLM_MODE=record`, `LLM_FALLBACKS=off`, `tsx --env-file=.env`, pinned anchor), commit the recordings, then `extractor in replay mode returns a quote for each demo email`.

### Task 7: Ops agent, fact ledger, release gate, `POST /api/ask` (ai-backend-engineer)

**Files:** Create `apps/api/src/ai/prompts/agent-system.ts`, `apps/api/src/ai/agent.ts`, `apps/api/src/ai/tools/vessel-status.ts`, `apps/api/src/ai/tools/plan-bunkering.ts`, `apps/api/src/ai/tools/propose-action.ts`, `apps/api/src/ai/release-gate.ts`, `apps/api/src/ask/routes.ts`, tests beside each.

**Interfaces:**

- Consumes: Tasks 1, 2, 5, 6; `planBunkers`, `projectFuelOnBoard`, `remainingFobLegs`, `DOMAIN_CODE_VERSION`.
- Produces:
  - Tools (each `betaZodTool` with a strict Zod input; output `ToolResult` JSON):
    - `get_vessel_status({vessel: string})` — resolve by name or IMO; facts: latest-report ROB per grade (`db` provenance on `noon_reports`), FOB `requiredMt`, `safetyMarginMt`, `shortfallMt` per grade (stored as a `calculations` row `fob_projection`, `calculation` provenance), next port and ETA.
    - `plan_bunkering({vessel: string})` — open requirement → quotes with status `received` for it → `buildBunkerPlanInput(loadWorld, voyageId, offers)` → `planBunkers` → `calculations` row (`bunker_plan`, inputs, outputs, `codeVersion`) → facts per option (`headlinePriceUsdPerMt`, `totalCostUsd`, `delayHours`, `etsCostUsd`, `rank`, `feasible`) plus `bestOptionId`, `cheapestHeadlineOptionId`, `savingVsCheapestHeadlineUsd`, each with `calculation` provenance and path. Fewer than one quote → a fact-free result saying so.
    - `propose_action(ProposedAction)` — validates the calculation exists, the option exists and is feasible, every `factRefs` id was returned earlier in this conversation; inserts a `pending` recommendation with `expectedSavingUsd` read from the calculation (not from the model); returns its id.
  - Fact ids are deterministic per call site: `f_<tool>_<calculationId|rowId>_<path>` (sanitised to the `FactId` pattern).
  - `checkNumbers(answer: string, facts: Fact[]): GateResult` — every numeric token (digits with optional thousands commas, decimals, leading `$`/`€`, trailing `%`) must equal a numeric fact value rounded to the token's displayed decimals, or appear verbatim inside a string fact (IMO, voyage no.); numbers inside fact citations `[f_…]` are ignored.
  - `runAgent(deps, question, conversationId?): Promise<AskResponse>` — `client.beta.messages.toolRunner` with the three tools, `agentModel`, `agentEffort`, fallbacks per config, cached system prompt (`PROMPT_VERSION = "agent-system/v1"`) that requires citing a fact id after every number and calling `propose_action` only when a plan's best option is feasible; collects facts from tool results into the ledger; runs `checkNumbers`; on failure sends one repair message listing the ungrounded numbers; still failing → `answer: null`, `gate.passed: false`. Persists `conversations`/`messages` and links `llm_calls`.
  - Route `POST /api/ask` (`AskRequest` → `AskResponse`).
- [ ] Tests: `checkNumbers` table — `"$233,851 [f_x]"` with fact 233851.2 passes at 0 dp; `"8,000 cheaper"` with no such fact fails and lists `8,000`; IMO inside a string fact passes; percentages; `withholds after a failed repair` (fake runner returning bad text twice); tool tests on a seeded test DB with the two demo quotes inserted directly: `plan_bunkering ranks MTMLA-kestrel first and GIGIB-straitline as cheapest headline`, `propose_action rejects an unknown factRef and a model-typed quantity`, `expectedSavingUsd equals the calculation's savingVsCheapestHeadlineUsd`. Replay test: record one live ask ("Where should Aegean Pioneer bunker, and who should we buy from?") with pinned anchor and `LLM_FALLBACKS=off`; assert `gate.passed`, a pending recommendation for `MTMLA-kestrel`, every number cited.

### Task 8: Approval, executor, DB read source, bare page (ai-backend-engineer)

**Files:** Create `apps/api/src/executor/erp-client.ts`, `apps/api/src/executor/execute.ts`, `apps/api/src/approvals/routes.ts`, `apps/api/src/read/db-source.ts`, `apps/api/src/llm-calls/routes.ts`, `apps/api/src/ui/index.html`, `apps/api/src/ui/routes.ts`, tests beside each; Modify `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/read/fixtures.ts` (extract the world-based builders so both sources share them).

**Interfaces:**

- Consumes: Tasks 1, 2, 4, 6, 7.
- Produces:
  - `createErpClient(baseUrl, fetchImpl?)` with `placeOrder(req: ErpOrderRequest, idempotencyKey): Promise<ErpOrderResponse>` (Zod-validated; network error or 5xx → throws `ErpUnavailableError`).
  - `approveRecommendation(deps, id, decidedBy): Promise<DecisionResult>` — pending → `approved` (audit `recommendation.approved`); create `purchase_orders` + `order_lines` once (qty = calculation option `qtyMt`, price/currency/barge from the quote — never from the model), `idempotencyKey = "rec-<id>"`; push to ERP → `synced` + `erpPoNumber`, recommendation `executed`, quote `ordered`, requirement `ordered`, audit `order.synced`; ERP down → `erpSyncStatus "failed"`, audit `order.sync_failed`, recommendation stays `approved`; calling again on `approved`/`executed` re-uses the existing order and retries only an unsynced push. `rejectRecommendation` → `rejected` + audit. Routes `POST /api/recommendations/:id/approve|reject` (`decidedBy` defaults to `"operator"`) → `DecisionResult`.
  - `createDbSource(sql): ReadSource` — vessels/voyages from `loadWorld(sql)` through the shared builders; inbox from `documents` + latest `extractions`; quotes from `quotes`/`quote_lines`; recommendations from `recommendations` + facts re-derived from the referenced calculation. Header `x-pharos-data: db`. `server.ts` uses it; fixtures remain for tests.
  - `GET /api/llm-calls` → `{items: LlmCallView[]}` (latest first, limit 200).
  - `GET /` → one static HTML page (no build step, no external assets): inbox list with "Deliver next email" and per-item status; quotes table; ask box showing the answer with clickable fact chips (label, value, unit, provenance) or the gate failure; recommendations with Approve / Reject showing the PO number; llm-call table (latency, tokens, cost). Polls every 2 s while anything is pending.
- [ ] Tests: `approve twice creates one order and one ERP call`; `ERP down leaves order failed and recommendation approved; approve again syncs with the same key`; `reject is final`; DB source returns the 8 seeded vessels and the ingested quote; `GET /` returns 200 HTML containing "Deliver next email"; ERP client against `createErpApp` in-process.

### Task 9: Live smoke + measurement (eval-engineer)

**Files:** Create `evals/smoke/run.ts`, `evals/smoke/README.md`; Modify root `package.json` (`"eval:smoke": "tsx evals/smoke/run.ts"`).

**Interfaces:** Consumes the HTTP API only (`API_URL`, default `http://localhost:4000`). Produces `npm run eval:smoke`: checks `/api/health` reports `llmMode: live` (else exits 2 with "start the API with LLM_MODE=live"); delivers both demo emails and polls until each extraction leaves `pending` (timeout 90 s each); asserts the two quotes match `DEMO_SCENARIO` (supplier, port, currency, price, barge, qty); asks the demo question; asserts `gate.passed`, at least one fact chip, a pending recommendation for `MTMLA-kestrel`; approves it and asserts an `erpPoNumber`; reads `/api/llm-calls` for the run's calls. Writes `evals/reports/<UTC timestamp>-smoke/report.json` + `report.md` (step latencies; per LLM call: purpose, model, tokens, latency, cost; totals) and prints the table. On success touches `.claude/state/markers/live-smoke`. Exits non-zero on any failed assertion, listing it.
- [ ] Dry test: `evals/smoke/run.test.ts` runs the runner against the in-process app in replay mode (recordings from Tasks 6–7) and asserts the report shape and the marker write (to a temp dir via `MARKERS_DIR`).

### Task 10: Phase gate (verifier) and commit (lead)

- [ ] `npm run verify` green (replay tests pass, DB tests not skipped, purity OK).
- [ ] `LLM_MODE=live docker compose up -d --build` → all healthy; `npm run eval:smoke` passes live; report lists every LLM call with latency and cost; total under $1.
- [ ] Browser check of `GET /`: deliver → quote → ask (fact chips) → approve → PO number visible.
- [ ] `verifier` reports PASS/FAIL table; update `.claude/state/status.json` (phase 3; gate evidence incl. measured extraction/answer latency and cost; run `npx biome format --write` on it); commit; do not push. Tell the user the measured latency and cost against the §6 targets (email ~20 s, answer ~45 s).
