# Joint route-and-bunker planner: design

- **Status:** for the user's approval, 2026-11-17.
- **User decisions so far:**
  - retune the demo world;
  - join the two in the route planner (approach 1);
  - re-measure and republish dev.
- **Branch:** `claude/eloquent-kapitsa-2265cb`. Building starts only after the UI round (`docs/superpowers/plans/2026-11-17-ui-round.md`) has passed its Task 17 final gate on `build/prototype`, at the user's instruction ("Wait until the required tasks are done and then execute").

## Why

"Quota" in the user's words means a supplier's quote: "see the quotas", "the approved quota". The conversation has used "quote" throughout without correction.

Today the route answer and the bunker answer are two separate calculations that can contradict each other on the same screen:
- The map raises a low-sulphur fuel alert for Aegean Pioneer.
- The bunker answer recommends a stop at Marsaxlokk.
- The route answer recommends route B without knowing the fuel on board, the stop, or the quotes.

The user asked whether route planning takes the remaining fuel and the quotes into account, and asked for it to (their words, 2026-11-17):
- change the route's ETA by the ports visited and the wait times;
- change the fuel after a port stop by the approved quote;
- "make it so the route recommends a quota for its route to be feasible while also showing the optimal route."

Success: one route answer that shows both the best route ignoring fuel (flagged when it runs short) and the plan the desk should actually sail. That plan is route, speed, bunker stop and quote, and every grade stays above its safety margin. The answer says which quote makes the voyage work and what the stop costs in hours and dollars. The demo shows this end to end.

## Goals

1. **One fuel calculation everywhere.** The map alert, `get_vessel_status`, the bunker planner's reachability check and the route planner all use one domain function. It tracks fuel on board per grade along a track, with the grade burned decided per 20 nm sub-step (LSMGO inside a sulphur emission-control area).
2. **Fuel check on every route option.** Each option reports, per grade:
   - the fuel on board at arrival;
   - whether it stays above the safety margin;
   - if not, where the shortfall starts.

   A route that runs short gets the reason `insufficient_fuel`.
3. **Bunker stops inside the route.** A plan can call at a bunker port. Its ETA includes:
   - the detour;
   - the port's waiting time;
   - the bunkering hours;
   - a weather delay at the stop.

   Fuel on board rises at the stop by the bunkered quantity. Every leg after the stop is checked against the margins.
4. **Two plans in one answer.**
   - (a) The best route and speed ignoring fuel: today's optimiser choice, clearly marked when it runs short.
   - (b) The recommended plan: the lowest total cost (voyage cost + delivered bunker cost) among plans that keep every grade above its margin, meet the berth window and avoid hazards.

   The answer names the quote that makes the plan work, what the stop adds in hours and USD against (a), and how it compares with the next feasible quote.
5. **Linked approvals.** Approving the plan needs a purchase order and a voyage instruction:
   - the instruction names the stop and depends on the order;
   - the approvals queue shows the link.
6. **UI in the Signal hoist world.** The route tray and the map show both plans, the stop, and the fuel-on-board curve per grade. Every labelled number is a cited fact and nothing on the curve animates. The approval detail shows the dependency.
7. **The demo shows it.** The demo world is retuned so the fuel shortage is real under the shared fuel calculation (user decision, 2026-11-17). The six-step story gains assertions for the recommended plan and for the linked approvals, and passes on re-recorded replies.

## Non-goals

- More than one bunker stop per plan, or more than one grade bought at a stop.
- Choosing or splitting the quantity. The quantity is the open requirement's (or an approved order's), as today.
- Changing speed along a plan. One speed setting per plan, as ruling P2 does for routes today.
- Fuel checks for ships seen on AIS: their fuel on board is unknown. Their route answers stay as they are.
- Changing how `plan_bunkering` ranks quotes. Only its reachability check (fuel on board at arrival) moves to the shared fuel calculation.
- A new agent tool.
- Live-mode tuning. Live weather and live AIS may make the live story differ, and that is reported, not tuned.

## Anti-goals (failures even if it "works")

- Any number computed outside `packages/domain`: in the API, the web, or by the model.
- A recommended plan that runs a grade below its margin, misses the berth window or crosses a hazard.
- A fuel curve that animates, or a labelled number with no fact behind it.
- Disturbing the UI round: this work starts from its final commit.
- Touching held-out answer keys, or re-running the held-out split.
- Editing an answer key by hand to make a score pass. Keys are regenerated by code and the user reviews every changed value.
- A model-typed quantity, price, speed or ETA in a proposal.

## Constraints

- `CLAUDE.md`:
  - all maths in pure `packages/domain`, test-first;
  - every shown number is a cited fact;
  - the model only proposes;
  - Zod at every boundary;
  - never read `.env`, never push.
- Bump `DOMAIN_CODE_VERSION` (now `0.6.0`).
- Changing `plan_route_speed`, `plan_bunkering`, `get_vessel_status` or `propose_action` output, a tool description, or the agent prompt invalidates every recorded reply.
  - Re-record per the `demo-e2e` and `eval-bench` skills.
  - Bump `PROMPT_VERSION` (now `agent-system/v5`) and run a live smoke eval after the prompt change.
  - Any paid call needs a budget the user sets first in `evals/budget.json`.
- World changes go through the `maritime-data` skill:
  - change scenario inputs, never generated rows;
  - run the seed invariants;
  - regenerate the Q&A answer keys with `npm run eval:qa-golden`, with the user reviewing changed values.
- UI work follows the `CLAUDE.md` UI rules, the `pick-ui-library` skill, and the Signal hoist contract the UI round leaves behind (`docs/UI_REVIEW.md`, `apps/web/.impeccable/surfaces/src-app-tsx.md`).
- Commit only on this branch. Merging into `build/prototype` is the last step and needs the user's go-ahead.

## Approaches considered

1. **Join them in the route planner (picked by the user, 2026-11-17).**
   - One fuel calculation feeds the alert, the bunker planner and the route planner.
   - The route answer gains the fuel check, the stop and the recommended plan.
   - The bunker answer keeps its ranking; only its reachability check moves to the shared fuel calculation.
   - **Why:** it is what the user asked for ("in the route planning"), and all eight bunker-decision answer keys stay valid. They pin best option `MTMLA-kestrel`, its total $233,942.91 and the $16,138.45 saving, and none of these depends on fuel on board.
   - **Trade-off:** the bunker answer judges reachability at the planned speed, while the route plan chooses its own speed. The two can disagree about whether a port is reachable, so each states the speed it used.
2. **One planner behind both answers.** The bunker answer would rank quotes by the full route-plus-bunker total, so the two answers could never disagree. Rejected: every bunker figure changes meaning, and all eight bunker-decision keys would need new values.
3. **A new `plan_voyage` tool.** Rejected: an eleventh tool, plus a prompt change to steer route questions to it, for something the user asked to see in the route planning.

## What we know (measured 2026-11-17 on the pinned world)

All figures are for the demo voyage AP-2611 with 275 t LSMGO on board.

**The alert today** (`projectFuelOnBoard` over port-to-port legs):
- Every leg carries one grade, and Gibraltar→Sines (274 nm) counts entirely as LSMGO.
- Planned route at 12.5 kn: LSMGO needed 236.3 t, margin 56.3 t (2 days at 12.5 kn), shortfall 17.56 t.

**The route optimiser's sub-step sums, with recorded weather:**

| Route and speed | LSMGO burned | LSMGO left at Rotterdam | Margin | Note |
| --- | --- | --- | --- | --- |
| B at 11 kn (today's recommendation) | 171.4 t | 103.6 t | 39.9 t | |
| A at 12.5 kn | 218.3 t | 56.7 t | 56.3 t | |
| C at 11.5 kn | 193.3 t | | 44.9 t | |

- 11 kn is the slowest speed on the 0.5 kn grid that meets the berth window on routes A and B.

**Retune limits:**
- "Every route runs short at every speed that meets the berth window" needs under about 211 t on board.
- "The planned route dips below the margin but does not run dry" needs over about 218 t.
- Both cannot hold. After the retune the alert reads "runs out before Rotterdam at the planned speed".

**A stop through the port on the sea network:**

| Stop | Sea route via the port | Detour vs route B | LSMGO burned to the port at 11 kn |
| --- | --- | --- | --- |
| Marsaxlokk | 3,188 nm | +59 nm | 56.7 t |
| Gibraltar or Algeciras | 3,160 nm | +32 nm | 137.3 t |

- At 12.5 kn the burn to Gibraltar or Algeciras is 171.8 t.

**Seeded port waits:** Marsaxlokk 4 h, Algeciras 8 h, Gibraltar 30 h. The recorded AIS capture gives Algeciras and Gibraltar 19.5 h each.

**Bunker-stop slack:** route B at 11 kn reaches Rotterdam about 15 h before the berth window closes.

**The demo quote emails carry no delivery window.**

## Design

### 1. One fuel calculation (domain)

**New pure function in `packages/domain`:** fuel on board along a track. Inputs:
- a polyline;
- a start time;
- one speed;
- the weather grid (nullable);
- the loaded consumption curve;
- fuel on board per grade;
- safety-margin days;
- an optional stop.

It walks the same sub-steps as `route-optimiser.ts`, and the two must share that walk, not copy it. For each sub-step:
- the grade comes from `gradeAt(midpoint)`;
- the hours come from the weather-adjusted speed over ground;
- the burn is `dailyConsumptionMt(curve, speed) × hours / 24`.

**Margin per grade:** `safetyMarginDays × daily consumption at the plan's speed`, for every grade the track burns. This is the convention `projectFuelOnBoard` uses today.

**Output:**
- fuel on board per grade at each breakpoint: start, every grade change, stop arrival, stop departure, destination;
- the lowest fuel on board per grade;
- per grade: the fuel needed, the shortfall (`max(0, needed + margin − on board)`, as today), and the first point where it drops below the margin (position, distance from start, time);
- where a grade runs dry, if it does.

**Who moves to it:**
- **The alert and `get_vessel_status`.** They become the fuel check of the current plan: the planned route's remaining polyline (`remainingRoutePoints`), at the planned speed, with the latest weather snapshot when there is one.
  - `get_vessel_status` keeps its fact paths (`requiredMt.*`, `safetyMarginMt.*`, `shortfallMt.*`, `gradesBelowMargin`).
  - It adds where LSMGO first drops below the margin and, if it does, where it runs out.
  - The map's vessel views (`apps/api/src/read/world-views.ts`) use the same builder, so the alert and the tool cannot differ.
- **`plan_bunkering`'s reachability check.** Each option's fuel on board at arrival comes from this projection along the planned route at the planned speed: at the track point nearest the port; for an off-route port such as Algeciras, the nearest point plus the spur. `minQtyMt` (the shortfall) comes from it too.
  - Ranking and totals are unchanged.
  - The facts say the check is at the planned speed.

`projectFuelOnBoard` stays only if something still needs it. Otherwise it is removed with its tests and contracts.

### 2. A bunker stop in a route (domain + db)

**Stop plans.** For each still-valid received quote of the voyage's open requirement, the builder in `packages/db` makes one stop plan:
- **Route:** the shortest sea route from the current position to the quote's port, then from the port to the destination, avoiding active hazards.
- **Distance:** the port's approach is counted in and out exactly once, from `approachNm` where the graph does not already reach the port.

Several quotes at the same port share the route. The plan's id is the bunker option id (`MTMLA-kestrel`), so it cannot collide with route ids (`A`, `B`, `C`).

**The stop's timeline**, all computed in domain:

| Phase | Duration |
| --- | --- |
| Arrival | after the in-approach |
| Waiting | the port's congestion wait |
| Weather delay | until workable weather |
| Bunkering | `DEFAULT_BUNKERING_HOURS` (6 h) |
| Departure | then the out-approach |

- **Waiting** follows one rule, used by both `plan_bunkering` and the route plan:
  - when the clock is pinned (the recorded demo), the latest seeded congestion row;
  - otherwise, the latest AIS-derived row, or the seeded row when there is none.
- **Weather delay:** bunkering cannot start while the forecast significant wave height at the port is above **2.0 m**, a new planning constant in `packages/domain/src/constants.ts`.
  - The delay is the time from the end of waiting to the first forecast step with workable weather.
  - Past the end of the forecast counts as workable. The plan says so, as the optimiser already treats missing weather as calm.
- **Fuel during the stay:** the stay burns `portStayFuelMt` (auxiliaries) in the port's grade (`portGrade`).

**The plan's ETA** = start + steaming hours (weather-adjusted, sampled at the times the vessel is actually there, so legs after the stop are shifted by the stay) + stay hours.

**The berth window** is checked on that ETA. Arriving before the window opens saves no vessel time, as today.

### 3. Fuel after the stop

At departure, fuel on board of the bought grade rises by the bunkered quantity. The quantity is:
- the approved (or executing or executed) purchase order's quantity, when the voyage's requirement has one;
- otherwise the open requirement's quantity, which is the recommended option's quantity, as in the bunker planner today.

**An approved order fixes the stop.** The route plan then evaluates only that order's port and quote.

**Checks against the stop plan:**

| Check | Reason when it fails |
| --- | --- |
| Every grade stays at or above its margin at every sub-step, including arrival at the stop | `insufficient_fuel` |
| Fuel on board at the stop plus the quantity fits the tank | `exceeds_tank_capacity` |
| The quote offers at least the required quantity | `insufficient_quantity` |
| Arrival at the stop falls inside the quote's delivery window, when the quote has one | `outside_delivery_window` |
| The ETA meets the berth window (existing check) | `misses_arrive_by` |
| The route avoids reported hazards (existing check) | `crosses_hazard` |

**Speed.** Each stop plan is searched over the same speed grid as the routes: the cheapest feasible speed, or, if none is feasible, ranked as the optimiser ranks infeasible options today.

### 4. Recommendation: both plans

**Costs** (domain):
- **Voyage cost** = steaming fuel at reference prices + stay fuel at reference prices + vessel time (to at least the window opening) + ETS + FuelEU on all fuel burned.
  - ETS and FuelEU coverage of steaming follows the voyage, because a bunkering-only stop is not a port of call under EU MRV.
  - The stay at an EU port is covered in full, as the bunker planner already does.
- **Delivered bunker cost** = quantity × price × FX + barge fee. The detour and delay are already inside the voyage cost and are never counted twice.
- **Plan total** = voyage cost + delivered bunker cost.

**(a) Best route ignoring fuel on board.**
- Today's `optimiseRouteSpeed` choice, selected exactly as now: fuel ignored when ranking.
- Each no-stop option still carries its fuel check. A route that runs short has `insufficient_fuel` in its reasons and `feasible: false`, so it cannot be proposed.
- `bestCandidateId`, `savingVsBaselineUsd` and `fuelSavingVsBaselineMt` keep their meaning. Fleet-vessel labels change to say "ignoring fuel on board".

**(b) Recommended plan.**
- When the voyage has an open requirement with valid quotes: the feasible stop plan with the lowest plan total. The purchase is happening this voyage, so the plan must call where the fuel is bought.
- When there is no open requirement or no valid quote: the cheapest fuel-feasible no-stop option.
- If nothing is feasible, there is no recommended plan, and the answer says why per option.

**The answer states:**
- which quote makes the voyage work;
- **hours added** = plan hours − (a)'s hours;
- **USD added** = plan voyage cost + barge fee − (a)'s voyage cost. The fuel purchase is excluded because it buys stock, not time.
- the next feasible stop plan (quote, port, total) and the margin by which the recommended plan beats it, or that there is none.

**Contract.** `RouteSpeedResult` gains, additively:
- a fuel check per option;
- `stopPlans[]`, one per quote, at its best speed;
- `plan`: the recommended plan's id, its route polyline, speed, stop timeline, fuel breakpoints per grade, costs, hours and USD added, next feasible plan and margin.

Existing fields stay. For AIS ships, `fuel`, `stopPlans` and `plan` are null or empty, and their labels and facts are unchanged.

**Facts.** All of these come from the shared builder in `apps/api/src/routing/facts.ts`, used by the tool and by `GET /api/route-plans/:id`:
- the recommended plan's route, speed, ETA, stop arrival and departure, waiting, bunkering, weather delay, quantity, fuel on board at stop arrival, after bunkering and at Rotterdam;
- margins, hours added, USD added, next feasible plan and margin;
- for (a): "runs short of LSMGO" with where and by how much.

New units go into the release gate.

### 5. Approvals: two linked proposals

- **A tool call never creates a proposal nobody asked for.**
  - `evals/qa/grade.ts` counts a proposal of a type the question did not ask for as unauthorised. That metric is published.
  - So a `voyage_instruction` never creates its purchase order as a side effect.
  - The instruction records its stop; the order is proposed only when the operator asks to buy (step 3 of the story does).
- **The link is derived, not stored.** An instruction for a stop plan depends on "a purchase order of the same voyage for the stop's quote".
  - The stop's quote id is in the stored calculation the instruction points at, so no new column is needed.
  - `propose_action` returns the matching order's id when one exists, and says when none exists yet.
  - The approval views and the executor resolve the link the same way, through one shared function in `apps/api/src/approvals/`.
  - The matching order is the latest non-rejected one. The audit trail records which order satisfied the dependency when the instruction was approved.
- **A purchase order can come from a route plan.** `propose_action` accepts `purchase_order` from a `route_speed` calculation whose stop plan is feasible:
  - the quantity comes from the stored stop plan;
  - price, currency and barge fee come from its quote, as the executor already reads them.

  This is needed because the bunker plan, which checks reachability at the planned speed, can mark the route plan's quote unreachable. Proposing from a `bunker_plan` is unchanged.
- **No-stop instructions.** A `voyage_instruction` on a no-stop route must be fully feasible, fuel included.
- **Competing orders.** When a different order for the same requirement is pending, the approvals detail says the two compete. Executing one order for a requirement makes the other un-approvable, with a plain reason.
- **Decision rules:**
  - The instruction cannot be approved until a matching order is approved (or executing or executed). It can always be rejected.
  - With no matching order, the detail reads "Needs a purchase order for Kestrel at Marsaxlokk; none proposed yet".
  - If the matching order is rejected, the instruction shows "Blocked: its purchase order (proposal N) was rejected" and can only be rejected.
  - The executor checks the same rule, not just the UI.
- **Executing.** The instruction records the stop in `voyage_instructions` (new nullable columns: port, quote, stop arrival, stop departure, quantity), and the drafted master's instruction names the stop. Nothing is sent, as today.
- **Queue order.** The approvals queue lists the order before the instruction that depends on it.

### 6. UI (Signal hoist)

Built on whatever components the UI round leaves (today `route-tray.tsx`, `route-layer.tsx`, `approval-card.tsx`, approvals page). Libraries chosen with the `pick-ui-library` skill.

- **Route tray:**
  - **"Recommended plan" first.** It shows:
    - the route via the port and its speed;
    - a stop card: port, supplier, price, quantity, arrival, waiting, weather delay, bunkering, departure;
    - ETA and margin to the berth window;
    - plan total;
    - "adds N h and $X against the best route ignoring fuel";
    - the next feasible quote and the margin.
  - **"Best route ignoring fuel" second.** It is marked with the red "blocked" meaning when it runs short ("runs short of LSMGO 210 nm before Rotterdam", for example).
  - **Fuel-on-board curve per grade.** Lines over distance, with:
    - the margin as a reference line;
    - the jump at the stop;
    - the first point below the margin on (a) marked.

    It is a static chart, never animated, drawn from the stored breakpoints served with the plan view. Labelled values are fact chips.
- **Map.**
  - The recommended plan's track in the act/recommended colour, with a stop marker at the port.
  - Route (a) as a secondary line, with its shortfall start marked.
  - The UI round's "Show on map" path draws the stored plan.
- **Approvals.** The instruction's detail shows "Depends on proposal N: purchase order, Kestrel at Marsaxlokk, 300 t" with its state flag. When the order is not yet approved, the approve control is disabled with the reason beside it. Competing orders are flagged.
- **Copy** follows the UI round's vocabulary rules: sentence case, times as "16 Nov 15:45Z", flags beside words.

### 7. Demo world retune (`maritime-data`)

Change one scenario input: Aegean Pioneer's current LSMGO on board (`currentRobMt.LSMGO` in `packages/db/src/seed/scenario.ts`), from 275 t to about 205 t. The exact value is chosen in the build as the one that satisfies all of these, written as seed invariant tests:

- **R1, alert:** on the current plan (planned route, planned speed, recorded weather), LSMGO falls below its margin before Rotterdam. It is expected to run out.
- **R2, need:** at every grid speed that meets the berth window, every no-stop route ends below the LSMGO margin.
- **R3, rescue:** the Marsaxlokk stop with Kestrel's quote gives a feasible plan, and it is the recommended plan.
- **R4, comparison:** at least one other quote gives a feasible plan, so the "next feasible quote" line shows. Algeciras at about 11.5 kn is expected; Gibraltar's wait is expected to miss the window.
- **R5, bunker answer intact:** Kestrel at Marsaxlokk stays `plan_bunkering`'s best option, and the existing trap invariant (cheapest headline is not the best total) still holds.
- **R6, tank:** fuel on board at the Marsaxlokk stop plus 300 t fits the 600 t LSMGO tank.

If no value satisfies all six, stop and bring the conflict to the user. Do not loosen an invariant.

**Known consequence, accepted by the user with approach 1.** R2 needs about 211 t or less on board. At the planned 12.5 kn the burn to Gibraltar or Algeciras is 171.8 t, against a 56.3 t margin. So in `plan_bunkering`, which checks reachability at the planned speed, `GIGIB-straitline` and `ESALG-nordwind` become `unreachable_with_margin`, while the route plan reaches Algeciras at about 11.5 kn.
- `packages/db/src/seed/demo-plan.test.ts`, which pins all three options as feasible, is re-pinned to the new verdicts.
- Step 3's narrative becomes: "the cheapest headline price can't be reached with the margin at the planned speed, and costs more in total anyway". The trap invariant (R5) still holds.
- Each answer states the speed its reachability check used.

### 8. Evals, recordings and budget

- **Answer keys.** Update the code that computes them (`evals/qa/reference.ts`) to the new fuel calculation and route facts, then run `npm run eval:qa-golden` for the **dev** split only.
  - Held-out keys stay as they are. They document what the closed held-out run measured.
  - The user reviews every changed value before it is committed.
  - Expected changes in dev:
    - `lookup-01` (fuel on board);
    - `lookup-10` (shortfall);
    - `route-speed-01` and `route-speed-10` (labels);
    - `route-speed-09`, whose proposal becomes the stop plan `MTMLA-kestrel` (the question asks only for an instruction, so it expects no order; see section 5).
  - `route-speed-04` is held-out and stays stale.
  - The generator (`evals/qa/generate.ts`) must leave held-out keys byte-identical, and its test (`evals/qa/generate.test.ts`) is extended to check that.
  - Bunker-decision keys should not change. If they do, stop and report.
- **Re-measure and republish dev (user decision, 2026-11-17: "Yes, re-measure dev").**
  - **New question.** At least one, about the recommended plan: "Which quote makes Aegean Pioneer's route feasible, and what does the stop add?" Its truth is computed by code.
  - **Where it goes.** The Q&A split (`npm run eval:qa-split`) ranks questions by hash per category, which would put this one in the closed held-out set, where it would never be measured.
    - A written rule is added instead: questions added after the held-out run closed go to dev, and the held-out list is frozen.
    - The rule is recorded in `evals/golden/qa/split.json`'s `rule` text, enforced by `evals/qa/split.ts`, and covered by its test.
    - This is a rule for every new question, not a choice made for this one.
  - **Measuring.** After the recordings are refreshed, one paid live dev pass (`npm run eval -- --suite qa --split dev --mode live`). Record-mode reports cannot be published, so the record pass and the measuring pass are separate runs.
  - **Publishing.** `npm run eval:publish` replaces only the dev Q&A entry. The Evaluation page labels it "measured on <date>, after the joint route-and-bunker planner". The held-out entry keeps its 16 Nov figures and gains the label "measured once, 16 Nov, before this change".
  - **Extraction.** Extraction results are untouched: no extraction prompt or schema changes.
- **Recordings.** Tool descriptions, tool outputs and the prompt all change, so every recorded reply is re-recorded:
  - the story in record mode;
  - the dev Q&A replays in record mode;
  - then a live smoke after the prompt change.
- **Budget.** Estimated about $0.25 on Claude Haiku 5.5:

  | Run | Estimate |
  | --- | --- |
  | Story record | about $0.03 |
  | Dev Q&A record pass | $0.05 to $0.10 |
  | Dev Q&A live measuring pass | $0.05 to $0.10 |
  | Live smoke | a few cents |

  The proposed cap of **$0.50** must be set by the user in `evals/budget.json` before any paid call. Every paid run is entered in the spend ledger.
- **Documentation.** `docs/APPROACH.md` and `docs/EVAL_LOG.md` note that the world and tools changed after the held-out run.

### 9. The six-step story

- **Step 1:** the alert now reads "runs out", and the story asserts that wording.
- **Steps 2 and 3:** unchanged, except for the re-recorded reply.
- **Step 4 (route and speed), new assertions:**
  - the tray shows the recommended plan via Marsaxlokk with Kestrel and the stop card;
  - the best route ignoring fuel is marked as running short;
  - the fuel curve is present;
  - the map shows the stop marker.
- **Step 4, question 3:** instructing the master creates an instruction that depends on the step 3 purchase order (same quote).
- **Step 5:** asserts the dependency line. The instruction's approve control is disabled until the order is approved; then the order is approved, then the instruction.
- **Docs.** `docs/DEMO_SCRIPT.md` is updated (alert wording, step 4 narrative, step 5 dependency). Committed screenshots are refreshed deliberately at the end.

### 10. Sequence

1. **Wait** for the UI round's Task 17 commit on `build/prototype`, then fast-forward this branch to it.
2. **Domain:** the fuel projection along a track (test-first).
3. **Domain:** stop timeline, stop plans and the recommendation; bump `DOMAIN_CODE_VERSION`.
4. **World retune** with R1–R6 as tests.
5. **db and API wiring:** route plan builder, alert, `get_vessel_status`, `plan_bunkering` reachability, congestion rule.
6. **Facts and read views:** shared builders, release-gate units.
7. **Approvals:** migration, `propose_action`, decision rules, executor, drafts.
8. **Prompt and tool descriptions:** `PROMPT_VERSION` bump.
9. **UI:** tray, map, approvals.
10. **Answer keys:** dev regenerated; user review.
11. **Paid steps (budget first):** re-record the story and dev replays; live smoke; live dev measuring pass; republish dev.
12. **Story:** passes twice in replay with no misses (step 6 shows the new dev label); demo script and docs updated.
13. **Merge** into `build/prototype` on the user's go-ahead.

## Calls made without the user (check these)

1. A voyage with an open requirement and valid quotes always gets a stop in its recommended plan. No-stop routes are the "ignoring fuel" comparison.
2. One stop, one grade, the requirement's quantity, one speed per plan.
3. A stop is the shortest sea route through the port, with the approach counted in and out once.
4. Bunkering waits for significant wave height ≤ 2.0 m at the port; weather beyond the forecast counts as workable.
5. Waiting: seeded congestion when the clock is pinned, the latest AIS reading otherwise, for both the route and bunker answers.
6. The alert and `get_vessel_status` use the latest weather snapshot.
7. An approved purchase order fixes the stop to its port, quote and quantity.
8. Two linked proposals, with the link derived from the stop's quote:
   - asking to instruct the master never creates a purchase order;
   - the instruction is approvable only after a matching order is approved;
   - a rejected order blocks it.
9. "USD added" excludes the fuel purchase itself; the comparison with the next quote is total against total.
10. A bunkering-only stop does not change ETS or FuelEU coverage of the voyage; an EU port stay is covered in full (as the bunker planner does today).
11. Held-out answer keys are left untouched; dev keys are regenerated and reviewed.
12. Ships seen on AIS get no fuel check, and their labels are unchanged.
13. The retune changes only Aegean Pioneer's LSMGO on board.
14. A quote's delivery window, when present, must contain the stop arrival.

## Left to the builder

- How the projection's breakpoints are sampled for the curve, and the curve's storage size.
- The exact fact ids and label wording, within the existing patterns and the UI round's vocabulary rules.
- How the approach distance is added without double counting against the graph's own port snapping.
- Migration naming and the read-view shapes.
- The chart component (via `pick-ui-library`) and the tray layout details, within the Signal hoist contract.
- Splitting the work into plan tasks and test files.
