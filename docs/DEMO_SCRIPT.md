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
- [ ] `npm run demo:reset` is the one switch back to the recorded demo, in under a minute, at any point.

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

### 1. Map

Click nothing yet. Say: ships moving on AIS with a wave and wind overlay; the badges say whether each source is live or recorded.
The fleet is highlighted. MV Aegean Pioneer (Port Said to Rotterdam) has an alert. A labelled synthetic hazard
is on the map; it is demo data, not an observation. Click the Aegean Pioneer alert to show why: the low-sulphur fuel on board will not cover the remaining emission-control legs with the safety margin.

### 2. Inbox

Go to Inbox. Click "Deliver next email" three times: Kestrel (Marsaxlokk, plain text), Straitline (Gibraltar, PDF attached), Nordwind (Algeciras, HTML table).
Open the Kestrel and Straitline emails and hover a price: the sentence it came from is highlighted. Say: every value points at its source text.
Open the Nordwind email: it is held for review. The quantity reads "300/350 mt", which is ambiguous, so Pharos does not guess.
Enter quantity 300 and price 690, click Accept, then "Save corrected quote". Say: one click from a person, not a model guess.

### 3. Ask: where to bunker

Go back to the map and ask question 1. Wait for the answer; the gate line reads "all numbers sourced". Click a fact chip to show its source
(a database record, a calculation, a supplier email). Say: the cheapest headline price is not the best option once barge fee, deviation, delay and carbon are counted.
A proposal appears: "Proposal waiting for your decision".

### 4. Route and speed

Ask question 2. Click the Aegean Pioneer marker, then "Plan route". Three candidate routes appear with fuel, CO2, cost and ETA; route B is recommended against the baseline in the recorded demo (live weather decides the winner in live mode, so name the recommended row, not "B").
Say: the recommended route avoids the labelled synthetic hazard. Point at the load factor and the FuelEU column; each number has a fact chip.
Then open the command palette (Ctrl+K or Cmd+K), pick a public ship, choose Rotterdam as destination and plan its route: the same question works for any ship on the map.
Ask question 3 to draft the voyage instruction.

### 5. Approvals

Go to Approvals. Approve the purchase order and confirm: it returns a PO number from the ERP simulator. Open "Facts, drafted messages and audit trail":
the drafts read "draft, not sent" and the audit trail lists every step. Approve the voyage instruction and confirm: "Instruction recorded".
Say: the model only proposes; a person approves; nothing leaves the building.

### 6. Evaluation

Go to Evaluation. Say: measured accuracy with the counts (k of N) and 95% intervals, dev split beside the held-out split, which ran once.
The approach and numbers are in `docs/APPROACH.md`.

## Fallbacks

| Problem | What the console shows | What to do |
| --- | --- | --- |
| AIS feed down or key missing | AIS badge reads "recorded"; the map still shows the recorded traffic | Carry on; say the feed fell back to the recorded capture. Or `npm run demo:reset` |
| Weather service down | Weather badge reads "recorded" | Carry on on the stored snapshot. Or `npm run demo:reset` |
| Model slow or `ANTHROPIC_API_KEY` missing | Answer is slow, or the API refuses to start in live mode and names the variable | `npm run demo:reset`: recorded replies answer the three scripted questions at once |
| A question outside the three, in recorded mode | "This question has no recorded reply. Start a new conversation and pick a suggested question." | Start a new conversation and click a suggested question |
| Anything else (stuck container, odd state) | Varies | `npm run demo:reset` recreates api, erp, worker and web, reseeds, and waits for readiness; no image build |

Do not run `docker compose build` or `docker compose up --build` on stage.
