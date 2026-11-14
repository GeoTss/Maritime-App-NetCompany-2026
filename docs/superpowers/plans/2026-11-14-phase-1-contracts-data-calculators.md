# Phase 1 — Contracts, Data, Core Calculators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed contracts for every entity and payload, a Postgres schema with a deterministic synthetic world seeded on boot, and the first test-first calculators (consumption, fuel-on-board, bunker planner, CO₂/ETS/CII), plus fixture-backed API read routes so Phases 2, 5 and 6 can start in parallel.

**Architecture:** `packages/shared` holds Zod schemas (entities, extraction output, facts, actions, calculator I/O, API views). `packages/domain` holds pure calculators that take and return those types. `packages/db` holds the Drizzle schema, migrations, and a pure `generateWorld({seed, anchor})` whose output is inserted by `seedDatabase`; the API migrates and seeds at boot with `anchor = boot time`. API read routes serve fixtures built from the same generator and calculators.

**Tech Stack:** TypeScript 6, Zod 4.6, Drizzle ORM 0.45 + drizzle-kit 0.31 on postgres.js 4.1, Hono 4, Vitest 5, Biome 2.

**Spec:** `docs/MASTER_PLAN.md` — §1 (scenario, domain rules), §3 (deterministic maths), §5 (data model ER diagram), §10 (Phase 1 row). Read with `CLAUDE.md`.

## Global Constraints

- `packages/domain` is pure: imports only relative paths, `zod`, `@pharos/shared`, `@turf/*`; no `fetch`, `Math.random`, `Date.now()`, argless `new Date()`, `performance.now`, `process.env` (`npm run check:purity`). `new Date(ms)` from an argument is fine.
- Seed code never uses `Math.random()` or the wall clock: seeded PRNG + injected `anchor: Date`. Same `(seed, anchor)` → byte-identical `JSON.stringify(world)`.
- CO₂ factors (t CO₂ / t fuel, IMO MEPC.364(79) Cf): LSMGO **3.206**, VLSFO **3.114**, HSFO **3.114**.
- ETS coverage factor: EU↔EU **1.0**, EU↔non-EU **0.5**, non-EU↔non-EU **0**; at berth in an EU port **1.0**. Phase-in (share of verified emissions surrendered): 2024 **0.4**, 2025 **0.7**, 2026+ **1.0**. Bunker-only stops are not ports of call (EU MRV Reg. 2015/757 art. 3), so they do not change voyage coverage.
- 0.1 %-sulphur zones (ECA): Mediterranean (MARPOL Annex VI, in force 2025-05-01) and North Sea incl. English Channel east of 5°W. Rule used everywhere: a leg requires **LSMGO** if any part of its real sea route lies in an ECA zone (`searoute-ts` ECA zones) or either end port is in an ECA, else **VLSFO** (conservative, planning-grade).
- Consumption: cubic law, `mainMtPerDay(v) = refMtPerDay × (v / refSpeedKn)³`, plus constant `auxMtPerDay`; the whole ship burns the leg's required grade.
- Fuel grades: `LSMGO | VLSFO | HSFO`. Currencies: `USD | EUR`. Money totals are reported in USD; conversion uses rates passed in, never fetched.
- Calculators return unrounded numbers; rounding happens when facts are created (Phase 4).
- Synthetic data only: fictional supplier and company names; managed-vessel MMSIs **999000001–999000008** (never allocated to real ships, so no clash with live AIS); IMO numbers carry a valid check digit.
- No API key is needed in this phase. Never read `.env`.
- Only the lead installs dependencies (none are expected in this phase). One local commit at the gate on `build/prototype` (CLAUDE.md rule 7); never push.
- Files under `packages/shared/src/extraction/` mark the extraction schema as changed (post-edit hook); that is expected.

## Review Focus

1. **Re-seeding a database that is already seeded** (`SEED_ON_BOOT=reset` on every Compose restart) must succeed, leave identical row counts, and reset ID sequences so a later insert (an ingested quote in Phase 2) does not collide with a seeded ID. → Task 7 test `reseed is repeatable and sequences continue after seeded ids`.
2. **Restarting the API with `SEED_ON_BOOT=if-empty`** must not wipe existing data. → Task 7 test `if-empty leaves a seeded database untouched`.
3. **Degenerate calculator input** — zero distance, no remaining legs, speed ≤ 0, speed outside the curve range, a negative quantity — must give 0 / no shortfall or a `RangeError` naming the argument, never `NaN`. → Task 2 and Task 4 tests.
4. **No feasible bunker option** (all unreachable or short) must return `bestOptionId: null` with every option's reasons, not throw; equal totals rank by `optionId`. → Task 4 tests.
5. **Anchor time-shift** — an anchor with milliseconds or on a DST-change day must shift every timestamp by exactly the anchor delta and change nothing else. → Task 6 test `world is time-shift invariant`.

---

### Task 1: Shared Zod contracts (lead)

**Files:**

- Create: `packages/shared/src/primitives.ts`, `packages/shared/src/entities.ts`, `packages/shared/src/extraction/quote.ts`, `packages/shared/src/extraction/index.ts`, `packages/shared/src/facts.ts`, `packages/shared/src/actions.ts`, `packages/shared/src/calculators.ts`, `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts` (re-export all)
- Test: `packages/shared/src/contracts.test.ts`

**Interfaces — Produces** (every later task imports these from `@pharos/shared`; each name is both a Zod schema and its inferred type):

- `primitives.ts`: `FuelGrade` (`"LSMGO"|"VLSFO"|"HSFO"`), `FUEL_GRADES`, `Currency` (`"USD"|"EUR"`), `GradeAmounts` (`{LSMGO:number, VLSFO:number, HSFO:number}`, non-negative), `LatLon` (`{lat,lon}`, ranges checked), `Id` (positive int), `ShipType` (`"bulk_carrier"|"tanker"|"container"`), `IsoDateTime` (string, ISO with offset).
- `entities.ts` — one schema per §5 entity, camelCase, timestamps as `z.date()`: `Port` (+ `unlocode`, `country`, `lat`, `lon`, `isEu`, `inEca`, `approachNm`), `RouteLeg` (`fromPortId`, `toPortId`, `distanceNm`, `requiredGrade`, `etsCoverage` ∈ {0, 0.5, 1}, `waypoints: LatLon[]`), `Supplier` (`name`, `emailDomain`, `erpCode`, `portIds`), `Vessel` (`imo`, `mmsi`, `name`, `shipType`, `dwt`, `trackingSource` ∈ simulator|ais, `tankCapacityMt: GradeAmounts`, `consumptionCurve: ConsumptionCurve`, `dailyCostUsd`), `VesselPosition`, `AisTraffic`, `Voyage` (`voyageNo`, `plannedSpeedKn`, `plannedRoute: Id[]` — port ids in order, `status` ∈ planned|underway|completed, `departedAt`), `PortCall` (`purpose` ∈ load|discharge|bunker|passage, `eta`, `berthWindowStart/End`), `NoonReport` (`speedKn`, `robMt`, `consumedMt`: GradeAmounts, `distanceSinceLastNm`), `PortFuelPrice` (`grade`, `priceUsdPerMt`, `asOf`), `PortCongestion` (`observedAt`, `anchoredCount`, `waitingHours`, `source`), `BunkerRequirement` (`voyageId`, `grade`, `qtyMt`, `status` ∈ open|ordered|cancelled), `Quote`, `QuoteLine`, `PurchaseOrder` (§5 ORDER; `erpSyncStatus` ∈ pending|synced|failed), `OrderLine`, `Document` (`parentId` for attachments, `kind` ∈ email|pdf, `receivedAt`), `Extraction`, `WeatherSnapshot`, `Calculation` (`kind` ∈ fob_projection|bunker_plan|emissions|route_speed|calculate, `inputs`, `outputs`, `codeVersion`, `voyageId?`, `weatherSnapshotId?`), `Recommendation` (`type` ∈ purchase_order|voyage_instruction, `calculationId`, `optionId`, `factRefs`, `expectedSavingUsd`, `status` ∈ pending|approved|rejected|executed, `decidedBy?`), `Conversation`, `Message`, `AuditEvent`, `ReferenceRate` (`kind` ∈ fx|eua, `key` e.g. `EURUSD`/`EUA`, `value`, `asOf`, `source`). Nullable DB columns are `.nullable()`.
- `extraction/quote.ts` — what the model returns, values **as written**: `TextField {value: string|null, evidence: string|null}`; `QuantityField {value: number|null, unit: string|null, asWritten: string|null, evidence: string|null}`; `MoneyField {value: number|null, currency: string|null, perUnit: string|null, asWritten: string|null, evidence: string|null}`; `DateField {asWritten: string|null, evidence: string|null}`; `QuoteLineExtraction {grade: TextField, quantity: QuantityField, price: MoneyField}`; `QuoteExtraction {kind: "quote", supplierName, vesselName, vesselImo, port: TextField, deliveryFrom, deliveryTo, validUntil: DateField, bargeFee: MoneyField, lines: QuoteLineExtraction[] (min 1), notes: string|null}`; `NotAQuote {kind: "not_a_quote", reason: string, evidence: string|null}`; `ExtractionOutput` = discriminated union on `kind`. All objects `.strict()`; optional-ness expressed only as `null` (structured-output friendly).
- `facts.ts`: `FactId` (string `^f_[A-Za-z0-9_.:-]+$`), `Provenance` = discriminated union on `source`: `db {table, rowId, field}` · `calculation {calculationId, calculator, path}` · `document {documentId, extractionId, field, evidence}` · `ais {mmsi, ts: IsoDateTime}` · `weather {snapshotId, modelRun: IsoDateTime}` · `derived {operation ∈ add|subtract|multiply|divide|percent_change|sum|min|max, operands: FactId[] (min 1)}`; `Fact {id, label, value: number|string|boolean, unit: string|null, provenance}`; `ToolResult {facts: Fact[], data: unknown}`.
- `actions.ts`: `ProposedAction` = discriminated union on `type`: `purchase_order` / `voyage_instruction`, each `{calculationId: Id, optionId: string, factRefs: FactId[] (min 1), rationale: string}`, `.strict()` — no quantity, price or speed field can be typed by the model.
- `calculators.ts`: `ConsumptionCurve {refSpeedKn>0, refMtPerDay>0, auxMtPerDay≥0, minSpeedKn>0, maxSpeedKn ≥ minSpeedKn}`; `FobLeg {distanceNm≥0, grade}`; `FobProjectionInput {robMt: GradeAmounts, legs: FobLeg[], speedKn, curve, safetyMarginDays≥0}`; `FobProjection {legs: {index, grade, hours, fuelMt, robAfterMt: GradeAmounts}[], requiredMt, safetyMarginMt, minRobMt, shortfallMt: GradeAmounts, belowMarginAtLeg: Record<FuelGrade, number|null>}`; `BunkerOptionInput`, `BunkerPlanInput`, `BunkerOptionResult`, `BunkerPlan` (fields as in Task 4); `CiiInput {shipType, dwt, co2T, distanceNm, year}`, `CiiResult {attained, reference, required, ratio, rating ∈ A..E}`; `EtsCostInput {co2T, coverage, year, euaPriceEur, eurUsd}`, `EtsCostResult {coveredCo2T, phaseIn, costEur, costUsd}`.
- `api.ts`: `ApiError {error: string}`; `VesselSummary {id, name, imo, mmsi, shipType, position: LatLon|null, positionAt: IsoDateTime|null, voyageId: Id|null, robMt: GradeAmounts, alerts: string[]}`; `VesselDetail = VesselSummary + {dwt, tankCapacityMt, consumptionCurve, fobProjection: FobProjection|null}`; `VoyageSummary {id, voyageNo, vesselId, vesselName, status, originPortId, destinationPortId, plannedSpeedKn, nextEta: IsoDateTime|null}`; `VoyageDetail = VoyageSummary + {portCalls: (PortCall with IsoDateTime times + portName)[], legs: {fromPortId, toPortId, distanceNm, requiredGrade, etsCoverage}[]}`; `InboxItem {documentId, sender, subject, receivedAt, kind, extractionStatus ∈ pending|extracted|needs_review|not_a_quote|failed}`; `InboxItemDetail = InboxItem + {bodyText, extraction: ExtractionOutput|null, checkResults: {check, passed, detail}[]}`; `QuoteView {id, supplierName, portName, currency, bargeFee, validUntil, status, lines: {grade, qtyMt, pricePerMt}[], documentId: Id|null}`; `RecommendationView {id, type, status, calculationId, optionId, summary, expectedSavingUsd, factRefs, facts: Fact[]}`; list responses `{items: T[]}`.

- [ ] **Step 1: Write the failing tests** in `contracts.test.ts`:
  - `ExtractionOutput accepts a quote with null fields but valid shape` (e.g. `quantity: {value: null, unit: "mt", asWritten: "300/350 mt", evidence: "…"}`, currency `"€"` as written).
  - `ExtractionOutput rejects a quote with no lines` and `rejects an unknown key` (strict).
  - `ExtractionOutput parses not_a_quote`.
  - `ProposedAction rejects a model-typed quantity` — `{type:"purchase_order", calculationId:1, optionId:"o1", factRefs:["f_a"], rationale:"x", qtyMt: 300}` fails.
  - `Provenance discriminates on source` — `derived` with zero operands fails; `db` without `field` fails.
  - `GradeAmounts rejects negative mt`; `RouteLeg rejects etsCoverage 0.7`; `ConsumptionCurve rejects maxSpeedKn < minSpeedKn`.
- [ ] **Step 2:** `npx vitest run packages/shared` → FAIL (modules missing).
- [ ] **Step 3:** Implement the files above; `index.ts` re-exports `runtime`, `primitives`, `entities`, `extraction`, `facts`, `actions`, `calculators`, `api`.
- [ ] **Step 4:** `npx vitest run packages/shared && npm run typecheck` → PASS.

---

### Task 2: Geo, consumption and fuel-on-board projection (domain-data-engineer)

**Files:**

- Create: `packages/domain/src/constants.ts`, `packages/domain/src/geo.ts`, `packages/domain/src/consumption.ts`, `packages/domain/src/fob.ts`
- Modify: `packages/domain/src/index.ts` (re-export)
- Test: `packages/domain/src/geo.test.ts`, `consumption.test.ts`, `fob.test.ts`

**Interfaces:**

- Consumes: `ConsumptionCurve`, `FobProjectionInput`, `FobProjection`, `GradeAmounts`, `LatLon`, `FuelGrade` from Task 1.
- Produces:
  - `constants.ts`: `EARTH_RADIUS_NM = 3440.065`, `CO2_FACTOR_T_PER_T: Record<FuelGrade, number>`, `ETS_PHASE_IN: Record<number, number>` (+ rule 2026+ = 1), `CII_REFERENCE`, `CII_REDUCTION_PCT`, `CII_BOUNDARIES` (values in Task 3), each with its source in a comment.
  - `geo.ts`: `greatCircleNm(a: LatLon, b: LatLon): number` (haversine); `polylineNm(points: LatLon[]): number`; `pointAlongPolyline(points: LatLon[], nm: number): LatLon` (clamped to ends; linear in lat/lon within a segment, by segment share of great-circle length); `etaAfter(start: Date, distanceNm: number, speedKn: number): Date`.
  - `consumption.ts`: `mainEngineMtPerDay(curve, speedKn): number`; `dailyConsumptionMt(curve, speedKn): number` (main + aux); `legFuel(curve, distanceNm, speedKn): {hours: number, fuelMt: number}`; `portStayFuelMt(curve, hours): number` (aux × hours/24).
  - `fob.ts`: `projectFuelOnBoard(input: FobProjectionInput): FobProjection`. `safetyMarginMt[g] = safetyMarginDays × dailyConsumptionMt(curve, speed)` for each grade burned on a remaining leg, else 0. `requiredMt[g]` = Σ leg fuel of grade g. `shortfallMt[g] = max(0, requiredMt + safetyMarginMt − robMt)`. `belowMarginAtLeg[g]` = first leg index after which ROB of g < its margin (null if never). `minRobMt[g]` = min of starting ROB and every `robAfterMt[g]`. Negative ROB is reported, not clamped.

- [ ] **Step 1: Write failing tests** (hand arithmetic in comments). Curve `C = {refSpeedKn:13, refMtPerDay:30, auxMtPerDay:2.5, minSpeedKn:8, maxSpeedKn:16}`.
  - `greatCircleNm`: 1° of latitude along a meridian = 60.04 nm ± 0.05 (2π·3440.065/360 = 60.0405); same point → 0.
  - `polylineNm` equals the sum of segment `greatCircleNm`; `pointAlongPolyline` at 0 → first point, at ≥ length → last point, halfway along a meridian segment → mid latitude.
  - `etaAfter(new Date("2026-11-14T00:00:00Z"), 300, 12.5)` → `2026-11-15T00:00:00.000Z` (24 h); speed 0 → `RangeError`.
  - `mainEngineMtPerDay(C, 11.7)` = 21.87 (30 × 0.9³); per-mile burn at 11.7 kn is 0.81 × that at 13 kn (the "10 % slower ≈ 19 % less per mile" rule).
  - `legFuel(C, 280.8, 11.7)` → `{hours: 24, fuelMt: 24.37}`; `legFuel(C, 0, 12)` → `{hours:0, fuelMt:0}`; speed 7 or 17 → `RangeError` (outside curve); negative distance → `RangeError`.
  - `portStayFuelMt(C, 12)` = 1.25.
  - `projectFuelOnBoard` with `robMt {LSMGO:60, VLSFO:100, HSFO:0}`, `speedKn 13`, `safetyMarginDays 1`, legs `[312 nm LSMGO, 624 nm VLSFO, 156 nm LSMGO]`: leg fuels 32.5 / 65 / 16.25 (24 h, 48 h, 12 h at 32.5 mt/day); ROB after legs L 27.5 → 27.5 → 11.25, V 100 → 35 → 35; `requiredMt {L:48.75, V:65, H:0}`; `safetyMarginMt {L:32.5, V:32.5, H:0}`; `shortfallMt {L:21.25, V:0, H:0}`; `belowMarginAtLeg {LSMGO:0, VLSFO:null, HSFO:null}`; `minRobMt {L:11.25, V:35, H:0}`.
  - `projectFuelOnBoard` with no legs → all shortfalls 0, margins 0, `belowMarginAtLeg` all null.
  - Determinism: same input twice → identical `JSON.stringify`; input object not mutated (deep-frozen input passes).
- [ ] **Step 2:** `npx vitest run packages/domain` → FAIL.
- [ ] **Step 3:** Implement. Validate inputs with the shared schemas at the public entry (`FobProjectionInput.parse`) so bad input fails loudly.
- [ ] **Step 4:** `npx vitest run packages/domain && npm run check:purity` → PASS, `Domain purity: OK`.

---

### Task 3: Emissions — CO₂, ETS cost, CII (domain-data-engineer)

**Files:**

- Create: `packages/domain/src/emissions.ts`
- Modify: `packages/domain/src/constants.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/emissions.test.ts`

**Interfaces:**

- Consumes: `CO2_FACTOR_T_PER_T`, `ETS_PHASE_IN` (Task 2); `CiiInput`, `CiiResult`, `EtsCostInput`, `EtsCostResult`, `GradeAmounts`, `ShipType` (Task 1).
- Produces: `co2Tonnes(fuelMt: GradeAmounts): number`; `etsCoverage(fromIsEu: boolean, toIsEu: boolean): 0 | 0.5 | 1`; `etsPhaseIn(year: number): number` (≤2023 → 0); `etsCost(input: EtsCostInput): EtsCostResult` (`coveredCo2T = co2T × coverage × phaseIn`, `costEur = coveredCo2T × euaPriceEur`, `costUsd = costEur × eurUsd`); `ciiRating(input: CiiInput): CiiResult`.
- Constants (sources in comments): reference line `a × capacity^−c` (MEPC.353(78)): bulk_carrier `a 4745, c 0.622`, capacity = min(DWT, 279 000); tanker `a 5247, c 0.610`; container `a 1984, c 0.489` (capacity = DWT). Reduction Z % (MEPC.338(76)): 2023 5, 2024 7, 2025 9, 2026 11; years after 2026 use 11 until amended. Boundaries d1–d4 (MEPC.354(78)): bulk_carrier 0.86/0.94/1.06/1.18, tanker 0.82/0.93/1.08/1.28, container 0.83/0.94/1.07/1.19. Attained = `co2T × 1e6 / (capacity × distanceNm)` g CO₂/(dwt·nm); required = reference × (1 − Z/100); rating A if ratio < d1, B < d2, C < d3, D < d4, else E.

- [ ] **Step 1: Write failing tests.**
  - `co2Tonnes({LSMGO:10, VLSFO:20, HSFO:0})` = 94.34 (32.06 + 62.28); all-zero → 0.
  - `etsCoverage`: (true,true) 1 · (true,false) 0.5 · (false,true) 0.5 · (false,false) 0.
  - `etsCost({co2T:100, coverage:0.5, year:2025, euaPriceEur:80, eurUsd:1.1})` → covered 35, €2 800, $3 080; same in 2026 → 50 / €4 000 / $4 400; 2023 → 0.
  - `ciiRating({shipType:"bulk_carrier", dwt:58000, co2T:15000, distanceNm:70000, year:2026})` → attained 3.6946, reference ≈ 5.1687, required ≈ 4.6002, ratio ≈ 0.8031, rating "A" (toBeCloseTo 3 dp).
  - Boundary: ratio exactly d1 → "B"; exactly d4 → "E" (construct co2T so the ratio lands on the boundary).
  - Bulk carrier with DWT 300 000: the reference line uses capacity 279 000 (MEPC.353(78)), attained uses DWT 300 000 (MEPC.352(78) G1). Assert `reference` equals 4745 × 279000^−0.622 and `attained` uses 300 000.
  - `distanceNm 0` or `dwt 0` → `RangeError`.
  - Determinism test for `ciiRating` and `etsCost`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run packages/domain && npm run check:purity` → PASS.

---

### Task 4: Bunker planner (domain-data-engineer)

**Files:**

- Create: `packages/domain/src/bunker-planner.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/bunker-planner.test.ts`

**Interfaces:**

- Consumes: `legFuel`, `portStayFuelMt` (Task 2); `co2Tonnes`, `etsCost` (Task 3); schemas from Task 1.
- Produces: `planBunkers(input: BunkerPlanInput): BunkerPlan`, with
  - `BunkerPlanInput {grade, requiredQtyMt>0, minQtyMt≥0, tankFreeMt≥0, speedKn, curve, dailyCostUsd, voyageEtsCoverage, berthWindowSlackHours, market: {fxToUsd: {USD:1, EUR:number}, euaPriceEur, year}, options: BunkerOptionInput[]}`
  - `BunkerOptionInput {optionId, quoteId: Id|null, supplierId: Id, portId: Id, portIsEu, currency, pricePerMt, bargeFee (quote currency), offeredQtyMt, deviationNm, deviationGrade, deviationFuelPriceUsdPerMt, waitingHours, bunkeringHours, weatherDelayHours, robAtArrivalMt, safetyMarginMt}`
  - `BunkerOptionResult {optionId, rank, feasible, reasons: ("insufficient_quantity"|"exceeds_tank_capacity"|"unreachable_with_margin"|"misses_berth_window")[], qtyMt, headlinePriceUsdPerMt, fuelCostUsd, bargeFeeUsd, deviationFuelMt, portStayFuelMt, deviationCostUsd, delayHours, delayCostUsd, co2T, etsCostUsd, totalCostUsd, effectivePriceUsdPerMt}`
  - `BunkerPlan {options: BunkerOptionResult[] (ranked), bestOptionId: string|null, cheapestHeadlineOptionId: string|null, savingVsCheapestHeadlineUsd: number|null}`
- Formulas: `qtyMt = requiredQtyMt`; `fuelCostUsd = qty × pricePerMt × fx`; `bargeFeeUsd = bargeFee × fx`; `deviationFuelMt = legFuel(curve, deviationNm, speedKn).fuelMt`; `portStayFuelMt = portStayFuelMt(curve, waitingHours + bunkeringHours + weatherDelayHours)`; `deviationCostUsd = (deviationFuelMt + portStayFuelMt) × deviationFuelPriceUsdPerMt`; `delayHours = deviationNm/speedKn + waitingHours + bunkeringHours + weatherDelayHours`; `delayCostUsd = delayHours/24 × dailyCostUsd`; ETS: `co2T = co2(deviationFuel) + co2(portStayFuel)` in `deviationGrade`, cost = `etsCost(co2(deviationFuel), voyageEtsCoverage) + etsCost(co2(portStayFuel), portIsEu ? 1 : 0)` with `eurUsd = fxToUsd.EUR`; `totalCostUsd` = fuel + barge + deviation + delay + ETS. Infeasible when `offeredQtyMt < requiredQtyMt`, `requiredQtyMt > tankFreeMt`, `robAtArrivalMt < safetyMarginMt`, `delayHours > berthWindowSlackHours`. Ranking: feasible before infeasible, then `totalCostUsd` ascending, then `optionId`. `cheapestHeadlineOptionId` = lowest `headlinePriceUsdPerMt` among all options (ties by `optionId`); saving = cheapest-headline total − best total when both exist. `requiredQtyMt < minQtyMt` → `RangeError`.

- [ ] **Step 1: Write failing tests.** Base: curve C (Task 2), `speedKn 13` (32.5 mt/day), `dailyCostUsd 16000`, `voyageEtsCoverage 0.5`, `berthWindowSlackHours 48`, market `{fxToUsd:{USD:1, EUR:1.1}, euaPriceEur:80, year:2026}`, grade LSMGO, `requiredQtyMt 300`, `minQtyMt 50`, `tankFreeMt 400`.
  - Option **A** (EU port, USD 700/mt, barge 2 000, deviation 13 nm, waiting 5 h, bunkering 6 h, weather 0, deviation price 800, offered 300, ROB 120 vs margin 65): deviation fuel 1.354167 (1 h), port-stay 1.145833 (11 h × 2.5/24), deviation cost 2 000, delay 12 h → 8 000, fuel 210 000, ETS: (1.354167×3.206×0.5 + 1.145833×3.206×1) × 80 × 1.1 = 514.2958, **total 222 514.2958**.
  - Option **B** (non-EU, USD 690/mt, barge 6 000, deviation 0, waiting 30 h, bunkering 6 h): port-stay 3.75 mt → 3 000, delay 36 h → 24 000, fuel 207 000, ETS 0, **total 240 000**.
  - `ranks A first although B has the cheapest headline price`: `bestOptionId "A"`, `cheapestHeadlineOptionId "B"`, `savingVsCheapestHeadlineUsd` ≈ 17 485.7042.
  - `converts an EUR quote`: B in EUR at 690 → headline 759 USD/mt, fuel 227 700.
  - `flags infeasible reasons`: offered 250 → `insufficient_quantity`; ROB 60 < 65 → `unreachable_with_margin`; waiting 60 h → `misses_berth_window`; `tankFreeMt 200` → every option `exceeds_tank_capacity`, `bestOptionId null`, options still returned.
  - `ties rank by optionId`; `empty options → bestOptionId null, cheapestHeadlineOptionId null`; `requiredQtyMt < minQtyMt → RangeError`.
  - Determinism: identical `JSON.stringify` across two runs and with options supplied in reversed order.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run packages/domain && npm run check:purity` → PASS.

---

### Task 5: Drizzle schema, first migration, DB scripts (domain-data-engineer)

**Files:**

- Create: `packages/db/src/schema.ts`, `packages/db/drizzle.config.ts`, `packages/db/drizzle/` (generated), `packages/db/src/migrate.ts`, `packages/db/src/client.ts`, `packages/db/src/cli/migrate.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json` (scripts), root `package.json` (scripts `db:generate`, `db:migrate`, `db:seed` delegating with `-w @pharos/db`)
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**

- Consumes: entity schemas in `packages/shared/src/entities.ts` — mirror them **column for column** (camelCase keys, `casing: "snake_case"` on the Drizzle instance), plural snake_case table names (`ports`, `route_legs`, `suppliers`, `vessels`, `vessel_positions`, `ais_traffic`, `voyages`, `port_calls`, `noon_reports`, `port_fuel_prices`, `port_congestion`, `bunker_requirements`, `quotes`, `quote_lines`, `purchase_orders`, `order_lines`, `documents`, `extractions`, `weather_snapshots`, `calculations`, `recommendations`, `conversations`, `messages`, `audit_events`, `reference_rates`) plus `world_meta (id=1, seed, anchor, seedVersion, seededAt)`.
- Produces: `schema` (all tables, exported from `@pharos/db`); `createDb(sql: Sql)` → Drizzle instance with schema; `runMigrations(sql: Sql): Promise<void>` (migrations folder resolved from `import.meta.url`, works on host and in the container); scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/cli/migrate.ts`, reads `DATABASE_URL`, names it if missing).
- Column choices: integer identity PKs (`generatedByDefaultAsIdentity`, so seed can insert explicit IDs); floats as `doublePrecision`; JSON as `jsonb` typed with `$type<…>()` from shared types; timestamps `timestamp({withTimezone:true, mode:"date"})`; FKs per §5 with `onDelete` restrict; unique on `vessels.imo`, `ports.unlocode`, `documents.sha256`, `purchase_orders.quote_id`.

- [ ] **Step 1: Write failing test** `schema.test.ts`: `every shared entity has a table with the same keys` — for each pair (e.g. `[Port, schema.ports]` …), `Object.keys(getTableColumns(table)).sort()` equals `Object.keys(Entity.shape).sort()`.
- [ ] **Step 2:** `npx vitest run packages/db` → FAIL.
- [ ] **Step 3:** Implement schema, config, client, `runMigrations`, CLI; run `npm run db:generate` to create `packages/db/drizzle/0000_*.sql` + meta. Never edit it by hand afterwards.
- [ ] **Step 4:** `npx vitest run packages/db && npm run typecheck` → PASS; `DATABASE_URL=postgres://pharos:pharos@localhost:5432/pharos npm run db:migrate` → exits 0 and `\dt` lists 26 tables.

---

### Task 6: Deterministic synthetic world + invariants (domain-data-engineer)

**Files:**

- Create: `packages/db/src/seed/build-routes.ts`, `packages/db/src/seed/routes.generated.json`, `packages/db/src/seed/prng.ts`, `packages/db/src/seed/scenario.ts`, `packages/db/src/seed/world.ts`, `packages/db/src/seed/types.ts`
- Test: `packages/db/src/seed/prng.test.ts`, `packages/db/src/seed/world.test.ts`

**Interfaces:**

- Consumes: entity schemas (Task 1); `polylineNm`, `pointAlongPolyline`, `etaAfter`, `legFuel`, `portStayFuelMt`, `projectFuelOnBoard`, `etsCoverage`, `planBunkers` (Tasks 2–4).
- Produces:
  - `createPrng(seed: number): () => number` (mulberry32, [0,1)), `prngInt`, `prngPick` helpers.
  - `types.ts`: `World` Zod schema = `{meta: {seed, anchor, seedVersion}, ports, routeLegs, suppliers, vessels, voyages, portCalls, noonReports, vesselPositions, portFuelPrices, portCongestion, bunkerRequirements, quotes, quoteLines, purchaseOrders, orderLines, referenceRates}` arrays of the shared entities with explicit integer IDs.
  - `generateWorld(opts: {seed: number, anchor: Date}): World` — pure; all timestamps = anchor ± integer milliseconds.
  - `DEMO_SCENARIO` in `scenario.ts`: `{vesselImo, voyageNo, requirement: {grade:"LSMGO", qtyMt}, options: DemoBunkerOption[]}` — the three supplier offers the demo inbox will deliver (supplier, port, currency, price, barge fee, qty, waiting/bunkering hours, deviation nm). Phase 3 fixture emails are written from these values; they are **not** inserted as quotes by the seed.
  - `buildDemoBunkerPlanInput(world: World): BunkerPlanInput` — assembles the planner input for Aegean Pioneer from world rows + `DEMO_SCENARIO` (used by tests, API fixtures and later the agent tool).
- Scenario inputs (tunable; if an invariant fails, change these, never the test):
  - **12 ports** (UN/LOCODE, approx coords, `isEu`, `inEca`, `approachNm`): EGPSD Port Said (non-EU, ECA), GRPIR Piraeus, MTMLA Marsaxlokk/Malta, ITGOA Genoa, ESALG Algeciras, GIGIB Gibraltar (non-EU, ECA), PTSIE Sines (non-ECA), FRBES Brest (non-ECA: south of 48°30′N), FRLEH Le Havre, BEANR Antwerp, NLRTM Rotterdam, DEHAM Hamburg (all EU; Med and North Sea ports in ECA).
  - **Route legs** (~16) come from the **real Eurostat 2025 maritime network** via `searoute-ts@2.3.1` (dependency of `@pharos/db` only; never imported by `packages/domain`). A script `packages/db/src/seed/build-routes.ts` (`npm run db:routes -w @pharos/db`) calls `seaRoute(fromLocode, toLocode, {units: "nauticalmiles", emissions: true})` with `searoute-ts/ports` and `searoute-ts/eca` loaded, and writes `packages/db/src/seed/routes.generated.json`: per leg `{from, to, waypoints (coords rounded to 4 dp, port coordinates prepended/appended), ecaFraction, libraryLengthNm, originSnapNm, destinationSnapNm}`. The file is committed; `generateWorld` reads it and never calls the library (fast, offline, byte-deterministic). Port coordinates come from `searoute-ts/ports` for the same UN/LOCODEs. `distanceNm = polylineNm(waypoints)` (1 dp); `requiredGrade` = LSMGO if `ecaFraction > 0` or either end port is in an ECA, else VLSFO (conservative); `etsCoverage = etsCoverage(from.isEu, to.isEu)` (the factor if that leg is sailed between two ports of call; voyage-level coverage comes from the voyage's origin/destination). Must include the demo path EGPSD→MTMLA→GIGIB→PTSIE→FRBES→NLRTM and GIGIB↔ESALG.
  - **8 vessels**, `trackingSource "simulator"`, MMSI 999000001–8, valid IMO check digits; mix of 4 bulk carriers, 2 tankers, 2 container ships. **MV Aegean Pioneer**: bulk carrier, 58 000 DWT, curve `{refSpeedKn 13, refMtPerDay 30, auxMtPerDay 2.5, minSpeedKn 9, maxSpeedKn 14.5}`, tanks LSMGO 450 / VLSFO 1 500 / HSFO 0, `dailyCostUsd 16 000`.
  - **Voyages**: each vessel one current voyage (+ optional completed previous one). Aegean Pioneer: EGPSD→NLRTM via the demo path, 12.5 kn, departed `anchor − 24 h`, so 300 nm along leg 1 at the anchor; discharge port call at NLRTM with `eta = etaAfter(anchor, remainingNm, 12.5)` and berth window `[eta − 6 h, eta + 48 h]`.
  - **Noon reports**: 5 per vessel at `anchor − k·24 h` (k = 0..4; the k = 0 report is the current state). Built backwards from the current ROB: `rob(k+1) = rob(k) + consumed(k)`, consumption from `legFuel`/`portStayFuelMt` and the leg grade (at port: aux at that port's grade). Aegean Pioneer current ROB: LSMGO **230**, VLSFO **620**.
  - **Positions**: hourly over the last 24 h for each underway vessel via `pointAlongPolyline`; one for vessels in port.
  - **Suppliers**: 6 fictional (e.g. "Kestrel Marine Fuels", "Nordwind Bunker Services", "Strait Line Fuels"); `portFuelPrices` per port and grade (LSMGO ~720–790 USD/mt); `portCongestion` (source "seed"): MTMLA 4 h, ESALG 8 h, GIGIB 30 h; `referenceRates`: EURUSD 1.08, EUA 75 EUR.
  - **Bunker requirement**: Aegean Pioneer, LSMGO, 300 mt, open.
  - **Demo offers**: MTMLA Kestrel USD 738/mt barge 2 800, deviation 14 nm; ESALG Nordwind EUR 690/mt barge EUR 3 000, deviation 12 nm; GIGIB Strait Line USD 712/mt barge 9 000, deviation 4 nm; all 300 mt, bunkering 6 h, waiting from `portCongestion`.
  - A few historical quotes/orders for other vessels (status expired/ordered) so Q&A has history.

- [ ] **Step 1: Write failing tests** in `world.test.ts` (world built once with `seed 20261114`, `anchor 2026-11-14T08:00:00Z`):
  - `prng is deterministic` (`prng.test.ts`: same seed → same first 5 values; different seeds differ).
  - `world is deterministic` — two `generateWorld` calls → identical `JSON.stringify`.
  - `world is time-shift invariant` — anchor `2026-03-29T01:30:00.123Z` vs base: every Date differs by exactly the anchor delta; everything else equal.
  - `every row parses with its shared schema` (`World.parse`), and `foreign keys resolve` (every `*Id` points at an existing row).
  - `counts`: 12 ports, 8 vessels, ≥ 14 legs, 6 suppliers.
  - `identity`: MMSIs 999000001–8 unique; every IMO passes the check digit (Σ first six digits × 7..2 mod 10 = 7th).
  - `fuel continuity` — per vessel and grade, consecutive reports: `robOlder − consumedNewer = robNewer` ± 0.1 mt; ROB never negative.
  - `ETA consistency` — each future port call's ETA = `etaAfter(anchor, remaining route nm, plannedSpeedKn)` ± 60 s.
  - `routes are real` — every leg in the world exists in `routes.generated.json`; `libraryLengthNm − 1 ≤ distanceNm ≤ libraryLengthNm + originSnapNm + destinationSnapNm + 1` (the port-to-network stubs are the only extra); Port Said→Malta is 900–1 050 nm.
  - `grade-by-zone` — each leg's `requiredGrade` follows the ECA rule above; `etsCoverage` equals `etsCoverage(from.isEu, to.isEu)`; `distanceNm` equals `polylineNm(waypoints)` ± 0.1.
  - `Aegean Pioneer is short on LSMGO for the ECA legs` — `projectFuelOnBoard` over the remaining legs (current leg remainder + rest) at 12.5 kn, 2 safety-margin days, from the k = 0 report: LSMGO `minRobMt ≥ 0` **and** `< safetyMarginMt.LSMGO`; `shortfallMt.LSMGO > 0`; `shortfallMt.VLSFO = 0`.
  - `demo trap` — `planBunkers(buildDemoBunkerPlanInput(world))`: `bestOptionId !== cheapestHeadlineOptionId`, the best option is feasible, `cheapestHeadlineOptionId` is the GIGIB offer, `savingVsCheapestHeadlineUsd > 0`.
  - `berth window` — baseline ETA is inside the window and the best option's `delayHours` < `berthWindowSlackHours`.
- [ ] **Step 2:** `npx vitest run packages/db/src/seed` → FAIL.
- [ ] **Step 3:** Implement `prng.ts`, `scenario.ts`, `types.ts`, `world.ts`.
- [ ] **Step 4:** `npx vitest run packages/db/src/seed` → PASS.

---

### Task 7: Seeder, boot-time migrate + seed, Compose (domain-data-engineer for `packages/db`; lead for `apps/api` config/server and Compose)

**Files:**

- Create: `packages/db/src/seed/seed.ts`, `packages/db/src/cli/seed.ts`, `packages/db/src/seed/seed.db.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json` (`db:seed`), `apps/api/src/config.ts` (+ test), `apps/api/src/server.ts`, `docker-compose.yml`, `.env.example`, `.claude/skills/maritime-data/SKILL.md` (commands now real)

**Interfaces:**

- Consumes: `generateWorld`, `runMigrations`, `createDb`, `schema`.
- Produces: `seedDatabase(sql: Sql, opts: {seed: number, anchor: Date, mode: "reset" | "if-empty"}): Promise<{seeded: boolean, anchor: Date}>` — in one transaction: `reset` truncates all tables `RESTART IDENTITY CASCADE`, inserts the world with explicit IDs, then `setval` each identity sequence to `max(id)`, and writes `world_meta`; `if-empty` returns `{seeded:false, anchor: <stored anchor>}` when `world_meta` exists. CLI `db:seed` (`DATABASE_URL`, `WORLD_SEED` default 20261114, anchor = now). `AppConfig` gains `seedOnBoot: "reset"|"if-empty"|"off"` (env `SEED_ON_BOOT`, default `if-empty`) and `worldSeed` (env `WORLD_SEED`, default 20261114). `server.ts` runs `runMigrations` then `seedDatabase` (unless off) with `anchor = new Date()` before listening, and logs the anchor. Compose `api` sets `SEED_ON_BOOT: ${SEED_ON_BOOT:-reset}`.

- [ ] **Step 1: Write failing tests.** `seed.db.test.ts` uses `TEST_DATABASE_URL ?? "postgres://pharos:pharos@localhost:5432/pharos_test"`, creates the database if missing, and **skips with a visible reason** when Postgres is unreachable:
  - `migrates and seeds; counts match the world` (per table).
  - `rows read back parse with the shared schemas` (ports, vessels, noon reports, voyages).
  - `reseed is repeatable and sequences continue after seeded ids` — reset twice, counts equal; insert a quote without an ID → its id = max seeded quote id + 1.
  - `if-empty leaves a seeded database untouched` — insert a document, `if-empty` → `seeded:false`, document still there.
  - `config.test.ts`: `SEED_ON_BOOT` defaults to `if-empty`; `bogus` → error naming `SEED_ON_BOOT`; `WORLD_SEED` must be an integer.
- [ ] **Step 2:** `npx vitest run packages/db apps/api` → FAIL.
- [ ] **Step 3:** Implement seeder, CLI, config, server wiring, Compose and `.env.example` (`SEED_ON_BOOT`, `WORLD_SEED`).
- [ ] **Step 4:** `npx vitest run packages/db apps/api` → PASS (DB test not skipped while Compose `db` is up); `npm run db:seed` against the dev DB exits 0.

---

### Task 8: API read routes with fixture data (ai-backend-engineer)

**Files:**

- Create: `apps/api/src/read/source.ts`, `apps/api/src/read/fixtures.ts`, `apps/api/src/read/routes.ts`, `apps/api/src/read/routes.test.ts`
- Modify: `apps/api/src/app.ts` (mount routes; `AppDeps` gains `read: ReadSource`), `apps/api/src/app.test.ts`, `apps/api/src/server.ts` (pass the fixture source)

**Interfaces:**

- Consumes: API view schemas (Task 1); `generateWorld`, `DEMO_SCENARIO`, `buildDemoBunkerPlanInput` (Task 6); `projectFuelOnBoard`, `planBunkers` (Tasks 2, 4).
- Produces: `interface ReadSource { listVessels(): Promise<VesselSummary[]>; getVessel(id: number): Promise<VesselDetail|null>; listVoyages(); getVoyage(id); listInbox(); getInboxItem(id); listQuotes(); getQuote(id); listRecommendations(); getRecommendation(id) }`; `createFixtureSource(): ReadSource` — world from `generateWorld({seed: 20261114, anchor: FIXTURE_ANCHOR = 2026-11-14T08:00:00Z})`; vessel ROB/alerts from the k = 0 noon report and `projectFuelOnBoard` (Aegean Pioneer gets alert `lsmgo_below_margin_for_eca`); inbox = the three demo emails (plain-text, HTML/EUR, PDF; one with an ambiguous quantity and `extractionStatus "needs_review"`) with `ExtractionOutput` examples; quotes from `DEMO_SCENARIO`; one pending `purchase_order` recommendation whose numbers come from `planBunkers` (calculation id 1, facts with `calculation` provenance). Every fixture number is computed by code or copied from `DEMO_SCENARIO`; none typed by hand.
- Routes (all `GET`, JSON, header `x-pharos-data: fixture`): `/api/vessels`, `/api/vessels/:id`, `/api/voyages`, `/api/voyages/:id`, `/api/inbox`, `/api/inbox/:id`, `/api/quotes`, `/api/quotes/:id`, `/api/recommendations`, `/api/recommendations/:id`. Lists return `{items}`; unknown or non-integer id → 404 `{error:"not_found"}`.

- [ ] **Step 1: Write failing tests** in `routes.test.ts` with `createApp({llmMode:"replay", pingDb: async()=>true, read: createFixtureSource()})`:
  - each list route → 200, `x-pharos-data: fixture`, body parses with `{items: View[]}`; 8 vessels.
  - each detail route for the first item's id → 200 and parses; `/api/vessels/999999` and `/api/vessels/abc` → 404 `{error:"not_found"}`.
  - Aegean Pioneer summary has alert `lsmgo_below_margin_for_eca`; its detail has `fobProjection.shortfallMt.LSMGO > 0`.
  - the recommendation's `expectedSavingUsd` equals `planBunkers(buildDemoBunkerPlanInput(world)).savingVsCheapestHeadlineUsd`, and every `factRefs` id is present in `facts`.
  - inbox has exactly one `needs_review` item.
- [ ] **Step 2:** `npx vitest run apps/api` → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run apps/api` → PASS.

---

### Task 9: Phase gate (verifier) and commit (lead)

- [ ] `npm run verify` → typecheck, lint, `Domain purity: OK`, all tests pass (count reported; DB test not skipped).
- [ ] `docker compose up -d --build` → `db`, `erp`, `api` healthy; `docker compose logs api` shows migrations applied and the world seeded with the boot anchor; `docker compose exec db psql -U pharos -c "select count(*) from vessels"` → 8; `curl -fsS http://localhost:4000/api/vessels` returns 8 items.
- [ ] `verifier` agent runs the above independently and reports a PASS/FAIL table.
- [ ] Update `.claude/state/status.json` (`phase: 2`, `lastGate` for phase 1 with evidence); commit locally on `build/prototype` (`Phase 1: contracts, data model, synthetic world, core calculators`). Do not push.
- [ ] Tell the user: Phase 2 needs `ANTHROPIC_API_KEY` in `.env`.
