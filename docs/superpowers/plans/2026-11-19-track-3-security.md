# Track 3: Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (hackathon scope, below) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan Atlantic Meridian's Fujairah → Rotterdam voyage past the danger areas: through the Red Sea and Suez with an armed security team and a war-risk premium, or round the Cape. Show the danger areas by risk level. Read security quotes from email, and require an approved security order before the instruction, as with fuel.

**Architecture:**
- **Domain.** `areaSpans` (entry and exit along a track), `securityPlan` (team, premium, dues, convoy wait) and a per-sub-step speed (full speed inside `guards` areas) in `packages/domain`. The optimiser adds security to each route option.
- **Data.** Seeded `security_areas` from the cited research. Security quotes come from email into `security_quotes`. The voyage, ports and legs come through the seed.
- **AI.** Extraction schema and prompt v3 gain `security_quote`. The agent's `propose_action` gains `security_order`. Both changes follow the eval protocol.
- **Approvals.** A new `security_order` type with its own table and ERP line kind. The voyage instruction depends on it when the route needs security.

**Tech Stack:** as Phase 9 (TypeScript 6, Zod, Vitest, Drizzle/Postgres, Hono, React 19 + MapLibre, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-19-track-3-security-design.md`; sources: `docs/research/2026-11-19-maritime-security-sources.md`.

## Hackathon scope

- **Execution:** native in this session (user's standing preference). 2–4 tests per domain function; API and web only the tests named; one self-review at the end.
- **Cut order** (first to go first):
  1. the convoy wait at Suez;
  2. the full-speed rule inside `guards` areas;
  3. the security story's screenshot set;
  4. the Gulf of Guinea areas on the map (drawn but no voyage uses them).

## Global Constraints

- Branch `feat/track-3-security` off `build/prototype`. Never push. Merge on the user's go-ahead.
- All maths in `packages/domain`, pure and test-first. Every number shown is a cited fact. The UI computes no business number.
- **Held-out answer keys stay byte-identical.** The Q&A and extraction held-out keys are frozen. New security golden cases get their own dev and held-out split. The held-out pass for them runs only on the user's word.
- Eval ground truth is written by code (templates from truth files), never by the model. The user reviews a sample of new golden cases before any paid run.
- **Prompt changes follow `.claude/skills/eval-bench/SKILL.md`:**
  - `extract-quote/v2` → `v3`;
  - `agent-system/v5` → `v6`;
  - a live smoke eval after each change.
- **Paid runs** only within the phase 10 cap in `evals/budget.json`. Proposed cap $1.50, set by the user.
- **Versions:** `DOMAIN_CODE_VERSION` `0.8.0` → `0.9.0`; `SEED_VERSION` `port-call-v1` → `security-v1`.
- **Danger-area values:** boundaries, levels, policies and dates come only from the research file, each with its citation. Rates (war-risk premium, hull value, Suez dues, guard day rates in templates) are illustrative and labelled.
- **Never send anything.** Provider confirmations are drafts.

## Review Focus

1. **A route that touches a `guards` area for a few miles** (an edge of a box): the team is still required, and its days come from the embark and disembark points, not from the miles. → Task 3 test `edge crossing still needs a team`.
2. **No security quote, or only expired ones**: Suez options are infeasible (`security_unavailable`), Cape is recommended, and nothing throws. → Task 3 test `no quote, Cape wins`.
3. **A quote whose embark or disembark point doesn't bracket the areas** (e.g. it disembarks before the Red Sea): it does not cover the route. → Task 3 test `quote must bracket the areas`.
4. **A security email with a guard count or day rate written two ways** ("4/6 guards"): held for review, never guessed. → Task 7 golden hard case.
5. **Approving the instruction before the security order**: refused with `dependency_unmet`, naming the provider. → Task 8 test.

---

### Task 0: Start
- [ ] `git switch -c feat/track-3-security build/prototype`. Once the user sets the cap, set `evals/budget.json` to `{ "phase": 10, "capUsd": <cap> }` and update the budget guard test. Set status phase 10. Commit `chore: phase 10 start (track 3, security)`.

### Task 1: Weather for the new region
- **Files:** `packages/integrations/src/weather/grid-points.ts` (a `REGIONS` list: the old demo region plus the added one), `packages/integrations/src/cli/record-weather.ts` (`--region added`), `fixtures/recorded/weather-snapshot.json` (merged).
- [ ] Record Open-Meteo (free, no key) for the added region's 2° grid points that are sea. Merge them into the snapshot: existing points stay byte-identical, the new points are rebased to the same `startAt`, and `source` notes "added region recorded 2026-11-19".
- [ ] Check: `npx tsx evals/qa/generate.ts --check` reports no drift, the demo-world tests (R1–R9) pass, and the story replays with 0 misses. If any of these fails, drop the new points within one grid step of the old region's edge and re-check.
- [ ] Commit `feat(weather): recorded forecast for the Red Sea, Arabian Sea and Africa`.

### Task 2: Contracts
- **Files:** `packages/shared/src/security.ts` (new), `routing.ts`, `entities.ts`, `extraction/quote.ts`, `providers/erp.ts`, `api.ts`, `tools.ts`, `actions.ts`.
- **Produces:**
  - `SecurityArea { id, name, level: "CRITICAL"|"SEVERE"|"SUBSTANTIAL"|"MODERATE"|"LOW"|"LISTED", policy: "guards"|"premium"|"escort"|"measures"|"avoid", boxes: Box[], asOf: IsoDate, source, note }`. `LISTED` is for an area the insurers list without a JMIC level, e.g. the Gulf of Guinea.
  - `SecurityQuote { id, providerId, vesselImo|null, embarkPort, disembarkPort, teamSize, dayRateUsd, fixedFeesUsd, minDays, validUntil|null, currency, status, extractionId|null, receivedAt }`.
  - `SecurityQuoteExtraction` (`kind: "security_quote"`, the same evidence fields as `QuoteExtraction`), joining the `ExtractionOutput` union.
  - `AreaSpan { areaId, enterNm, exitNm, hoursInside }`.
  - `SecurityPlanResult { spans, needsTeam, quoteId|null, embarkAt|null, disembarkAt|null, teamDays, costLines: CostLine[], extraCostUsd, convoyWaitHours }`. `CostLine` kinds gain `security_team | war_risk_premium | canal_dues`.
  - `RouteOptionResult += security: SecurityPlanResult | null`; route reasons `+= security_unavailable | avoid_area`.
  - `RecommendationType += security_order`; `ProposeActionInput` enum `+= security_order`; `ErpOrderRequest.lines` becomes a union of a fuel line and `{ service: "security_team", days, dayRate }`.
  - `DraftedMessage.kind += security_confirmation`.
- [ ] Parse tests for each new schema; typecheck. Fix construction sites with `null` or `[]`. Commit.

### Task 3: Domain: spans, security plan, speed inside areas
- **Files:** `packages/domain/src/areas.ts` (`areaSpans`), `security.ts` (new), `track.ts` (`walkSteps` takes `speedAt?: (step) => number`), `route-optimiser.ts`, `constants.ts`.
- **Interfaces:**
  - `areaSpans(points, stepNm, areas): AreaSpan[]`. Uses `areaPasses`' rule; `exitNm` is where the last midpoint inside ends.
  - `securityPlan({ spans, areas, quotes, timeAtNm, hullValueUsd, now, canal }): SecurityPlanResult & { reasons }`:
    - a `guards` span needs a team;
    - a quote covers the route when its embark point lies before the first `guards` span and its disembark point after the last (by nearest distance along the track), and it is valid at embarkation;
    - the cheapest covering quote is chosen;
    - `teamDays = max(minDays, ceil((disembarkAt − embarkAt) / 24 h))`;
    - the premium is `WAR_RISK_PREMIUM_PCT` (0.5) % × `hullValueUsd` for each `premium` area crossed;
    - canal dues apply when the track passes the canal box;
    - the convoy wait is the time to the next northbound convoy (Task 1 of the cut order: may be dropped);
    - an `avoid` span gives `avoid_area`.
  - In `evaluateSteps`, sub-steps inside `guards` spans sail at `curve.maxSpeedKn`. Security is evaluated per option, and its cost is added to `totalCostUsd`.
- [ ] Tests, in `security.test.ts` and `areas.test.ts`:
  - `edge crossing still needs a team`;
  - `no quote, Cape wins` (optimiser level: two candidates, one through a `guards` box);
  - `quote must bracket the areas`;
  - `team days from embark to disembark`;
  - `full speed inside guards area` (the hours inside fall, the fuel rises).
- [ ] Commit `feat(domain): security plan, area spans and full speed in guarded areas`.

### Task 4: Data
- **Files:** `packages/db/src/schema.ts` (`security_areas`, `security_quotes`, `security_orders`, the providers' kind), migration, `seed/scenario.ts` (ports, Atlantic Meridian's voyage, providers, `SEED_VERSION`), `seed/security.ts` (areas from the research file, rates), `seed/routes.generated.json` (rebuild with `build-routes`).
- [ ] Seed invariant test: the areas parse, each has a source and a date; Atlantic Meridian's planned route crosses the Gulf of Aden area.
- [ ] Answer keys: `generate.ts --check`. Only dev keys that name Atlantic Meridian may move; show the user every changed value before regenerating (unlock procedure). Held-out must not move: if one does, stop and ask.
- [ ] Commit.

### Task 5: Planner wiring
- **Files:** `packages/db/src/route-plan.ts`, `apps/api/src/routing/plan.ts`.
- [ ] For a fleet voyage:
  - add candidate `"K"` ("Round the Cape"), the shortest path through a waypoint off the Cape (`35°S 20°E`), when the destination lies north of the equator and the start east of 30°E;
  - load the areas, the vessel's valid security quotes, its hull value and the canal box into the input.
- [ ] Demo-world test R10 (Atlantic Meridian):
  - both the Suez and the Cape options need a team;
  - the Suez option carries the premium, the dues and the convoy wait;
  - with no security quotes, both are infeasible (`security_unavailable`);
  - the recommendation follows the numbers; report which route wins and by how much (no fixed winner).
- [ ] Commit.

### Task 6: Extraction v3 (`eval-bench` protocol)
- **Files:** `apps/api/src/ai/prompts/extract-quote.ts` (v3), `apps/api/src/ingest/*` (store a security quote; review rules: an ambiguous team size, day rate or point holds it), `packages/shared/src/extraction/quote.ts`.
- [ ] Unit tests on the stored record and the review rule. Do not run the paid smoke yet (Task 7 provides the cases). Commit.

### Task 7: Golden security emails (by code) and the paid evals
- **Files:**
  - `evals/extraction/templates/security*.ts` (plain, HTML table, PDF);
  - `evals/extraction/generate.ts` (security cases: about 24 dev and 24 held-out, plus 6 hard cases including `4/6 guards` and a day rate in EUR);
  - `fixtures/demo-inbox/04-…, 05-…, 06-…` for the three providers, generated from truth.
- [ ] Oracle ≈ 100 % and empty ≈ 0 % through the graders. **Ask the user to review a sample** of security truths and rendered emails.
- [ ] Paid, within the cap:
  - the live smoke for `extract-quote/v3`;
  - a dev extraction pass (fuel and security);
  - re-record the extraction replays.

  Ledger every run. Held-out security runs only on the user's word. Commit.

### Task 8: Security orders and approvals
- **Files:**
  - `approvals/propose.ts`, `routes.ts`, `existing.ts`, `dependency.ts`;
  - `executor/execute.ts` (a `security_order` branch: store the order, push to ERP with a service line, draft the provider confirmation);
  - `executor/drafts.ts`;
  - `services/erp-sim` (accept the service line);
  - web: `approval-card.tsx`, `decision-dialog.tsx`, `order-summary.tsx`, the `RECOMMENDATION_KIND` map.
- [ ] Tests:
  - executing a security order stores one order, one ERP call and one draft;
  - an instruction through Suez is refused before its security order (`dependency_unmet` names the provider) and approved after it.
- [ ] Commit.

### Task 9: Assistant (`eval-bench` protocol)
- [ ] Changes:
  - `plan_route_speed` facts gain the security rows: spans, team, quote, costs and premium;
  - `list_quotes` lists security quotes;
  - `propose_action` gains `security_order`;
  - the agent prompt gets one line on security and `PROMPT_VERSION` `v6`;
  - add the tool-chip labels;
  - two new dev Q&A questions, truths by code: "Should Atlantic Meridian go through the Red Sea or round the Cape?" and "Which security provider should we use for Atlantic Meridian?".
- [ ] Paid, within the cap: a live smoke eval for v6; re-record the dev Q&A and story replies. Commit.

### Task 10: Console
- [ ] Changes (use `pick-ui-library` first):
  - a danger-areas map layer: boxes shaded by JMIC level from existing tokens (alarm for SEVERE and above, caution for SUBSTANTIAL, plan grey for MODERATE and LISTED), each label naming its level, policy and as-of date, and the source in the fact chip;
  - a "Danger areas" list in the map's side column, ranked by level, each with its policy and the note on why;
  - the route tray's per-option security block (areas crossed with hours, team, quote, premium, dues, convoy wait);
  - the Suez-versus-Cape comparison line;
  - the inbox's security quote view (fields beside their evidence);
  - the approvals card for a security order.
- [ ] Then:
  - update the tests that break, plus one test for the security block;
  - run `npx impeccable detect`;
  - look at the screen in the browser pane.
- [ ] Commit.

### Task 11: Security story, docs, gate
- [ ] `e2e/security.spec.ts`, a second, short story:
  1. deliver the three security emails (one held for review);
  2. plan Atlantic Meridian (danger areas drawn; Suez with security recommended over the Cape);
  3. propose and approve the security order;
  4. the instruction becomes approvable.
- [ ] Docs:
  - DEMO_SCRIPT (security act);
  - README;
  - MASTER_PLAN change log;
  - APPROACH (danger-area sources and limits).
- [ ] `npm run verify`; both stories pass twice in replay with 0 misses. Status gate; commit. Ask before merging.
