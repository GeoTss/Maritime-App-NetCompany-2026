# Demo script

About six minutes. The console is at http://localhost:5173. Nothing in the demo is sent to an external
party: drafted messages are marked "draft, not sent" and the ERP is a local simulator.

## Preflight checklist

The day before:

- [ ] Build the images once, on good network: `docker compose build`. Never rebuild on stage.
- [ ] Both keys are in `.env` (`ANTHROPIC_API_KEY`, `AISSTREAM_API_KEY`). `npm run demo:live` names a missing variable, never a value.
- [ ] AIS feed answers: `npm run smoke:ais -- --seconds 20`
- [ ] Weather answers: `npm run smoke:weather`
- [ ] The recorded story passes: `npm run demo:reset && npx playwright test`

On the day:

- [ ] Start the stack: `docker compose up -d`
- [ ] Pick the mode. Recorded (free, deterministic): `npm run demo:reset`. Live: `npm run demo:live` (waits until the model, unpinned clock, live AIS and live weather are all confirmed).
- [ ] Open the console. The map strip shows AIS and Weather badges: "recorded" or "live". In recorded mode the clock shows 08:05Z and "pinned".
- [ ] `npm run demo:reset` is the one switch back to the recorded demo, normally ready in about 15 seconds (it waits up to 3 minutes), at any point.

In live mode each question costs about $0.001 and each delivered email about $0.0007. Free rehearsal of the live
data sources with a replayed model: `LLM_MODE=replay npm run demo:live`.

## The three scripted questions

Type or click these exactly. The recorded replies cover only these three; the dock's suggested questions are the same three.

1. `Where should Aegean Pioneer bunker, and who should we buy from?`
2. `What is the best route and speed for Aegean Pioneer to make its berth window?`
3. `Instruct the master of Aegean Pioneer to sail the recommended route at the recommended speed.`

In recorded mode any other question shows "This question has no recorded reply. Start a new conversation and pick a suggested question."

## The six steps

Do them in this order; the recorded replies depend on the same actions in the same order.

In recorded mode the replies depend on the exact sequence of actions, route plans included. Click "Plan route" exactly once for
Aegean Pioneer and once for the public ship FRANKA DEYMANN (MMSI 211121690, the first named ship in the recorded traffic), only
after question 2. An extra or failed plan makes the next recorded reply miss: run `npm run demo:reset` and restart from step 1.

### 1. Map

Click nothing yet. Say: ships moving on AIS with a wave and wind overlay; the badges say whether each source is live or recorded.
The fleet is highlighted. MV Aegean Pioneer (Port Said to Rotterdam) has an alert. A labelled synthetic hazard
is on the map; it is demo data, not an observation. Click the Aegean Pioneer alert to show why: at the planned speed its low-sulphur fuel (LSMGO) runs out before Rotterdam. The alert reads "LSMGO runs out before arrival at the planned speed".

### 2. Inbox

Go to Inbox. Click "Deliver next email" three times: Kestrel (Marsaxlokk, plain text), Straitline (Gibraltar; plain text: the subject says "PDF attached" but there is no attachment, so do not say "open the PDF"), Nordwind (Algeciras, HTML table).
Open the Kestrel and Straitline emails and hover a price: the sentence it came from is highlighted. Say: every value points at its source text.
Open the Nordwind email: it is held for review. The quantity reads "300/350 mt", which is ambiguous, so Pharos does not guess.
Enter quantity 300 and price 690, click "Accept correction", then "Save corrected quote". Say: one click from a person, not a model guess.

### 3. Ask: where to bunker

Go back to the map and ask question 1. Wait for the answer; the gate line reads "all numbers sourced". Click a fact chip to show its source
(a database record, a calculation, a supplier email). Say: the cheapest headline price (Gibraltar) can't be reached with the safety margin at the planned speed, and it costs more in total anyway once barge fee, deviation, delay and carbon are counted.
A proposal appears: "Proposal N waiting for your decision" (N is the proposal's number).

### 4. Route and speed

Ask question 2. Click the button "Aegean Pioneer, has an alert" (the vessel's marker on the map), then "Plan route". The tray shows two answers.
The best route ignoring fuel on board avoids the labelled synthetic hazard, but runs short of LSMGO before Rotterdam: the tray says where.
The recommended plan calls at Marsaxlokk for Kestrel's 300 t: the stop's arrival, waiting, weather and bunkering times, what it adds in hours and dollars, and how it compares with the next quote (Algeciras). The fuel curve shows LSMGO jumping at the stop and staying above the margin; the map marks the stop.
Under the stop card, "Port call, alongside the bunkering" shows everything the call does: provisions (the crew would end the voyage under its 7-day reserve), the out-of-date charts and publications the route needs (the new editions of chart 142 Strait of Gibraltar and 773 from the supplier checklist of 16 Nov, each with when it is first needed), the sludge delivered ashore (the tank would pass 90 % before Rotterdam), the port dues and the EU waste fee, and the notices due 24 h before arrival. Clearance and the time alongside are in the stop card, so the ETA includes them.
Say: the route and the bunker quote are planned together, so the ETA includes the port stop, and the cheapest fuel is not the cheapest call: the whole call is costed. Point at the load factor and the FuelEU column; each number has a fact chip.
Then open the command palette (Ctrl+K or Cmd+K), pick a public ship (in recorded mode FRANKA DEYMANN: type 211121690), choose Rotterdam as destination and plan its route: the same question works for any ship on the map.
Storm: pick FAUN (type 314886000, a cargo ship off Gibraltar at 9.1 kn) and plan its route to Rotterdam. At its own speed it would cross the Bay of Biscay as the recorded storm peaks (waves over 6 m, 17 to 19 Nov): route A at 9 kn is blocked by heavy weather, the map draws the storm cells, and a route "Around the storm" is added. The recommended plan sails route A at 12.5 kn and passes before the storm. Say: heavy weather is a limit, not just a cost, and the plan checks it at the time the ship is there.
Ask question 3 to draft the voyage instruction: it sails the recommended plan, stop included.

### 5. Approvals

Go to Approvals. Select the voyage instruction first: it waits for the purchase order for Kestrel at Marsaxlokk, and Approve is disabled until that order is approved.
Select the purchase order, approve and confirm: it returns a PO number from the ERP simulator. Open "Facts, drafted messages and audit trail":
the drafts read "draft, not sent" and the audit trail lists every step. Select the voyage instruction again, approve and confirm: "Instruction recorded". The master's draft names the bunker stop; beside it, the port agent's request (provisions, the charts by number and edition, the sludge to deliver) and the pre-arrival notices with their due times, all drafts.
Say: the model only proposes; a person approves; nothing leaves the building.

### 6. Evaluation

Go to Evaluation. Say: measured accuracy with the counts (k of N) and 95% intervals, dev split beside the held-out split, which ran once.
The approach and numbers are in `docs/APPROACH.md`.

## Fallbacks

| Problem | What the console shows | What to do |
| --- | --- | --- |
| AIS feed down or key missing | AIS badge reads "recorded"; the map still shows the recorded traffic | Carry on; say the feed fell back to the recorded capture. Or `npm run demo:reset` |
| Weather service down | Weather badge reads "recorded" | Carry on on the stored snapshot. Or `npm run demo:reset` |
| Model slow or `ANTHROPIC_API_KEY` missing | Answer is slow, or the API refuses to start in live mode and names the variable | `npm run demo:reset`, then redo steps 1 and 2 (a reset empties the inbox) before the questions; the recorded replies then answer the three scripted questions at once |
| A recorded reply misses after an extra or failed "Plan route" | "This question has no recorded reply. …" on a scripted question | `npm run demo:reset` and restart from step 1 |
| A question outside the three, in recorded mode | "This question has no recorded reply. Start a new conversation and pick a suggested question." | Start a new conversation and click a suggested question |
| Anything else (stuck container, odd state) | Varies | `npm run demo:reset` recreates api, erp, worker and web, reseeds, and waits for readiness; no image build |

Do not run `docker compose build` or `docker compose up --build` on stage.
