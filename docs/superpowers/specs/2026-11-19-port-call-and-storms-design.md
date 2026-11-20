# Port call and storm avoidance: design (Tracks 1 and 2)

- **Status:** for the user's approval, 2026-11-19.
- **User decisions so far (2026-11-19):**
  - build Tracks 1 and 2 now; Track 3 ("Suez or the Cape": canal dues, convoy slots, piracy areas, security escort) may follow if time allows, so leave room for it;
  - hackathon testing: a few tests per function, no production-grade suites, spend tokens sparingly.
- **Inputs:** the user's list of nine ideas and two supplier documents: the M&O "Full publications index" and the "Monthly publications check list Med-Black-Red", both dated 16 Nov 2026.

## Why

Today a bunker stop is only fuel: waiting, workable weather, bunkering, barge fee. A real call does more, and the desk plans all of it together. The user named:

1. approvals, charts and publications needed at the stop;
2. an extra check at the stop that moves the ETA;
3. port charges (the user said "tolls, e.g. Gibraltar": the strait itself is free, but calling at the port costs dues, agency and pilotage);
4. severe weather that changes the route;
5. sewage on board and its disposal;
6. crew provisions and resupply ("fuel and supplies, or only supplies");
7. sludge from cleaning the fuel purifiers, and its disposal.

The message for the judges: **the cheapest fuel is not the cheapest call**, and **a storm changes the route, not just the fuel bill**. Every number stays deterministic and cited; nothing is sent.

## Goals

### Track 1: the port call

1. **What the ship needs.** For each managed vessel, a pure projection of:
   - provisions: days left at each point of the voyage (crew × one person-day per day);
   - purifier sludge: m³ on board, growing with the fuel burned per grade;
   - sewage holding tank: m³ on board, growing only while in port or at anchor (at sea the treatment plant discharges);
   - charts and publications: which ones the route needs, which are out of date or missing, and when each is first needed (the time the route enters its area).
2. **The call does the jobs.** Each stop plan says which needed jobs the port can do: fuel, provisions, charts and publications, sludge and sewage delivery. A needed job the stop cannot do makes the plan infeasible with a reason, so the recommended plan is the cheapest one that covers everything the voyage needs.
3. **The whole call is costed and timed.** Stay = waiting + weather delay + clearance hours + the longest of (bunkering, storing, waste delivery), since these run alongside each other. Cost adds port dues, provisions, charts and publications, waste fees and, at EU ports, the waste fee every ship pays. The ETA moves with the stay.
4. **Deadlines before arrival.** Each stop plan lists the notices due before arrival, each with its due time worked out from the ETA: agent appointment, security pre-arrival information, and, at EU ports, the advance waste notification. A notice already overdue at `now` makes the plan infeasible.
5. **Approvals.** No new approval type. The voyage instruction already names the stop and waits for its fuel order; its approval card now shows the call's jobs, costs and notices. On approval, the executor drafts, beside the master's instruction, **the port agent's request** (provisions, charts and publications, waste delivery, with quantities and costs from the stored plan) and **the pre-arrival notices**. Nothing is sent.
6. **Stores-only calls.** When a voyage needs provisions or waste delivery but no fuel, stores-only stop plans (no quote, no bunkering) are offered at ports with stores. Cut first if time runs short.

### Track 2: storm avoidance

7. **Heavy weather is a limit, not just a cost.** A route option or stop plan whose sampled significant wave height exceeds `HEAVY_WEATHER_MAX_WAVE_M` at the time the ship is there is infeasible (`heavy_weather`). This depends on speed, so the optimiser can pick a speed that passes before or after the storm.
8. **A route around the storm.** The cells over the limit at the time the baseline would pass them (± a window) become keep-out zones. The route search adds one candidate that goes round them, when the zones exist.
9. **On the map.** The storm cells show as a layer with their wave height and time window; route options show the `heavy_weather` reason.

### Both

10. **The demo shows it.** The six-step story gains a check on the port call breakdown and, where the recorded data allow, one storm-avoidance check. Replies are re-recorded once at the end.

## Non-goals

- Fresh water, garbage (MARPOL Annex V), ballast water, hull cleaning, maintenance.
- More than one stop per plan; choosing the provisions quantity beyond "top up to the target".
- A full weather-routing solver; time-dependent graph search. The storm detour is planned from the baseline's pass times; each option is then checked at its own times.
- Reading the publications PDFs with the AI extractor (a second extracted document type stays out of scope).
- A new agent tool or a prompt change. Port call facts reach the agent through existing tools' outputs.
- Track 3 items: canal dues, convoy slots, piracy areas, war-risk insurance, security escort.

## Constraints

- All maths in `packages/domain`, pure and test-first (a few tests per function). Every number shown is a cited fact. The UI computes nothing.
- Vessel stores, port charges, prices and fill rates are **synthetic, labelled planning parameters**; sources are noted in `constants.ts` where real rules exist (EU Directive 2019/883 on port reception facilities; MARPOL Annex I sludge, Annex IV sewage; SOLAS V/27 charts and publications "adequate and up to date").
- The current editions come from the user's supplier checklist (16 Nov 2026) and are seeded by hand with that source. The demo's stores supplier is fictional; the real supplier's name and address are not used.
- Held-out answer keys stay byte-identical. Dev answer keys are regenerated by code; the user sees changed values before commit.
- Paid calls need a budget in `evals/budget.json`; proposed: phase 9, $0.50.
- Never push. Work on a branch off `build/prototype`.

## Approaches considered

| Decision | Options | Pick and why |
| --- | --- | --- |
| Where port call jobs live | (A) a separate "port call planner" beside the stop planner · (B) inside each stop plan | **B.** The stop plan already owns the timeline, the ETA and the cost; jobs change all three. A separate planner would contradict it on the same screen, the problem the joint planner fixed. |
| A job the stop can't do | (A) a penalty cost for "a second call" · (B) infeasible with a reason | **B.** Explainable and testable; a penalty needs an invented price. |
| Charts and publications data | (A) AI extraction of the supplier PDFs · (B) seeded reference table from them | **B.** Deterministic, no new golden set; extraction of a second document type is out of scope in the master plan. |
| Storm handling | (A) static keep-out of every cell ever over the limit · (B) time-aware: a reason on each option at its own times, plus one detour candidate from the baseline's pass times · (C) a time-dependent graph search | **B.** (A) blocks seas the storm has left; (C) is a weather-routing solver, too much for now. (B) reuses the optimiser's existing walk, which already samples waves at each sub-step's time. |
| Agent surface | (A) a new `plan_port_call` tool · (B) extend existing tool outputs | **B.** A new tool changes every request and needs a prompt change and a paid smoke eval; extended outputs only need the story replies re-recorded. |
| Approving the non-fuel jobs | (A) a new `port_call_order` approval type pushed to the ERP · (B) ride on the voyage instruction; drafts for the agent and the notices | **B.** (A) touches four enum copies, the proposal tool, the executor, the ERP contract and five approval screens. The port agent, not an ERP order, arranges stores and waste in practice, and drafts keep "nothing is sent". |
| Storm cells' home | (A) rows in `nav_hazards` · (B) part of the stored route plan | **B.** Hazard rows have no time window and would make every later plan avoid them; storm cells belong to the forecast a plan was made with. |

## Room for Track 3

- **Areas.** The charts work adds a pure `areaPasses(track, areas)` (enter and exit time and miles per area). Track 3's piracy areas and canals reuse it.
- **Cost lines.** The stop plan's extra costs are a list of labelled lines (`{ kind, usd }`), so canal dues or war-risk premiums are new kinds, not new fields.
- **Reasons** stay one enum per result; Track 3 appends.

## Left to the builder

Exact area boxes (drawn from each publication's title region, labelled illustrative); the wording of the drafts; UI layout within the Signal hoist world and the approved libraries.

## My calls (open to correction)

- The demo's recommended call stays **Marsaxlokk with Kestrel**: port-call values are set so the whole-call ranking agrees, and the story and approvals don't move. The port call shows *why* it is still the right call (it does every job, before the charts are needed).
- Out-of-date charts delivered after the route enters their area are a **warning**, not infeasible: in practice the agent can also deliver them at the next port, and Port State Control treats it as a deficiency, not a stop.
- Notice lead times are all 24 h (security information: SOLAS XI-2/9; EU waste notification: Directive 2019/883 Art. 6; agent appointment: desk practice).
- Sludge and sewage are in m³; the release gate learns "m³".
