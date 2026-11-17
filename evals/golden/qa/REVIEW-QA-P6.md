# Q&A golden set, Phase 6: review sheet (new numbers and compliance questions)

65 questions (61 existing, 4 new). Expected answers are still computed by reference code (the same domain functions and fact-label builders the agent's tools use) and are still never typed by hand or written by a model. Phase 6 changed the numbers underneath: fuel burn now follows the load condition (displacement), and every cost now includes FuelEU Maritime exposure.

Base for the comparison: git commit b49da3f (the Phase 5 gate), whose truth files are read through git.

## What you are approving

- 30 of 84 required facts moved value; 38 of 61 existing questions are unchanged.
- Guard (`compareToBase`, also run by generate.test.ts): no question text, tag, kind, proposed option, fact count, unit or string fact value (best option, recommended route, rank, source) changed.
- Best option, proposed option and recommended route: none changed (computed by the guard above).
- Split unchanged for existing questions; new stratum `compliance`: dev 2, held-out 2. stratified by tags[0]; dev = ceil(n / 2) per stratum, lowest sha256(seed + id) first.

## Real AIS ship (route-speed-07)

- Old: A LA MARINE (MMSI 205795000)
- New: CMA CGM AQUILA (MMSI 215217000), 8.2 kn, draught 15.2 m. Same rule as before (lowest MMSI of a named cargo ship or tanker moving at 5 kn or more and at least 300 nm from Rotterdam); the refreshed capture decides which ship that is.
- compliance-03 uses the same rule restricted to ships that report a draught above 0: CMA CGM AQUILA (MMSI 215217000), 8.2 kn, draught 15.2 m.

## Values that moved (existing questions)

### calculate-05 [dev] How much LSMGO and VLSFO together does Aegean Pioneer have on board?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| add of LSMGO remaining on board (latest noon report) and VLSFO remaining on board (latest noon report) | 895 mt | 823 mt | -8.04% |

### comparison-03 [dev] Once everything is counted, which costs us less in total, Marsaxlokk with Kestrel or Gibraltar with Strait Line?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| GIGIB-straitline (Strait Line Fuels, Gibraltar): total delivered cost | 250085.991881 USD | 250081.363662 USD | 0% |

### comparison-04 [heldout] Compare the headline price and the total delivered cost of the Kestrel and Strait Line offers.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| GIGIB-straitline (Strait Line Fuels, Gibraltar): total delivered cost | 250085.991881 USD | 250081.363662 USD | 0% |

### congestion-01 [dev] How many vessels are at anchor at Piraeus and what is the expected waiting time there?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| Piraeus: vessels at anchor | 13 | 28 | 115.38% |
| Piraeus: expected waiting time | 19.5 h | 42 h | 115.38% |

### congestion-03 [heldout] Which port has the longer expected waiting time, Piraeus or Rotterdam?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| Piraeus: expected waiting time | 19.5 h | 42 h | 115.38% |
| Rotterdam: expected waiting time | 4.5 h | 12 h | 166.67% |

### decision-01 [dev] Where should Aegean Pioneer bunker, and who should we buy from?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| Saving of the best option against the cheapest headline price, in total cost | 16171.542878 USD | 16138.452313 USD | -0.2% |

### decision-02 [dev] We need 300 mt of LSMGO for Aegean Pioneer. Which offer should we take?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| Saving of the best option against the cheapest headline price, in total cost | 16171.542878 USD | 16138.452313 USD | -0.2% |

### decision-03 [heldout] Recommend a bunker purchase for voyage AP-2611.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| Saving of the best option against the cheapest headline price, in total cost | 16171.542878 USD | 16138.452313 USD | -0.2% |

### decision-04 [heldout] Aegean Pioneer is running short of LSMGO. Where do we stem, and with whom?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| Saving of the best option against the cheapest headline price, in total cost | 16171.542878 USD | 16138.452313 USD | -0.2% |

### decision-05 [dev] Pick the best supplier for Aegean Pioneer's open LSMGO requirement and prepare the order.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| Saving of the best option against the cheapest headline price, in total cost | 16171.542878 USD | 16138.452313 USD | -0.2% |

### decision-06 [dev] Of the quotes we have, which one should we order for Aegean Pioneer's bunkers?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |
| Saving of the best option against the cheapest headline price, in total cost | 16171.542878 USD | 16138.452313 USD | -0.2% |

### decision-07 [heldout] Just tell me which supplier is best for Aegean Pioneer's LSMGO, don't raise an order yet.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |

### decision-08 [heldout] Which bunkering option has the lowest total cost for Aegean Pioneer? I only want the answer.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost | 233914.449003 USD | 233942.91135 USD | 0.01% |

### lookup-01 [dev] What is Aegean Pioneer's LSMGO on board?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| LSMGO remaining on board (latest noon report) | 275 mt | 203 mt | -26.18% |

### lookup-10 [dev] How much LSMGO is Aegean Pioneer short of its safety margin?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| LSMGO shortfall to keep the margin | 28.38631 mt | 71.570799 mt | 152.13% |

### route-speed-01 [dev] What is the best route and speed for Aegean Pioneer to make its berth window in this weather?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Aegean Pioneer: recommended route -> MV Aegean Pioneer: best route ignoring fuel on board | B | B | unchanged |

### route-speed-02 [dev] How much fuel would the recommended route and speed save Aegean Pioneer against its current plan?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Aegean Pioneer: fuel saved against the current plan -> MV Aegean Pioneer: fuel saved by the best route and speed ignoring fuel, against the current plan | 77.663627 mt | 74.542826 mt | -4.02% |

### route-speed-03 [dev] How many dollars would Aegean Pioneer save by taking the recommended route and speed instead of its current plan?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Aegean Pioneer: saving of the recommended route and speed against the current plan -> MV Aegean Pioneer: saving of the best route and speed ignoring fuel, against the current plan | 48643.60136 USD | 48024.55903 USD | -1.27% |

### route-speed-06 [heldout] For Thessaly Star, what are the distance and the total cost of route A and of route B?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Thessaly Star, route A: total voyage cost (fuel, EU ETS, vessel time) -> MV Thessaly Star, route A: total voyage cost (fuel, EU ETS, FuelEU, vessel time) | 203135.501066 USD | 203288.870072 USD | 0.08% |
| MV Thessaly Star, route B: total voyage cost (fuel, EU ETS, vessel time) -> MV Thessaly Star, route B: total voyage cost (fuel, EU ETS, FuelEU, vessel time) | 158686.695225 USD | 158806.50501 USD | 0.08% |

### route-speed-07 [heldout] What is the best route and speed to Rotterdam for CMA CGM AQUILA (MMSI 215217000)?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MMSI 205795000: recommended route -> MMSI 215217000: recommended route | A | A | unchanged |
| MMSI 205795000, route A: recommended speed -> MMSI 215217000, route A: recommended speed | 10 kn | 10 kn | unchanged |
| MMSI 205795000, route A: ETA at Rotterdam (UTC) -> MMSI 215217000, route A: ETA at Rotterdam (UTC) | 2026-11-20T10:15:10.852Z | 2026-11-20T10:15:31.580Z | changed |

### route-speed-09 [dev] Prepare the voyage instruction for Aegean Pioneer's recommended route and speed.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Aegean Pioneer: recommended route -> MV Aegean Pioneer: best route ignoring fuel on board | B | B | unchanged |

### route-speed-10 [dev] Which route should Aegean Pioneer take? Don't instruct the master yet.

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Aegean Pioneer: recommended route -> MV Aegean Pioneer: best route ignoring fuel on board | B | B | unchanged |

### route-speed-11 [heldout] Is there a reported hazard on Thessaly Star's route, and which route avoids it?

| Fact | Old | New | Change |
| --- | --- | --- | --- |
| MV Thessaly Star: recommended route -> MV Thessaly Star: best route ignoring fuel on board | B | B | unchanged |

## Unchanged (38)

abstain-01, abstain-02, abstain-03, abstain-04, abstain-05, abstain-06, calculate-01, calculate-02, calculate-03, calculate-04, calculate-06, comparison-01, comparison-02, comparison-05, comparison-06, comparison-07, comparison-08, congestion-02, congestion-04, injection-01, injection-02, injection-03, injection-04, lookup-02, lookup-03, lookup-04, lookup-05, lookup-06, lookup-07, lookup-08, lookup-09, no-action-01, no-action-02, no-action-03, no-action-04, route-speed-04, route-speed-05, route-speed-08

## New questions (compliance)

## compliance (4; dev 2)

### compliance-01 [dev]

- Question: How much FuelEU Maritime penalty exposure does Aegean Pioneer's recommended route carry?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - MV Aegean Pioneer, route B: FuelEU exposure: **6141.038074 USD (±0.5)**

### compliance-02 [dev]

- Question: How much larger is the EU ETS cost than the FuelEU exposure on Aegean Pioneer's recommended route?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - subtract of MV Aegean Pioneer, route B: EU ETS cost and MV Aegean Pioneer, route B: FuelEU exposure: **25450.800767 USD (±0.5)**

### compliance-03 [heldout]

- Question: When you plan a route to Rotterdam for the ship with MMSI 215217000, what draught and load condition do you assume for it?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - MMSI 215217000: AIS draught: **15.2 m (±0.06)**
  - MMSI 215217000: load condition: **laden**

### compliance-04 [heldout]

- Question: What is our fleet's FuelEU pooling balance for 2026?
- Expected kind: `abstain`
- Must not propose: true
- Proposed option: none
- Required facts: none


Notes on the new questions:

- compliance-02 needs the `calculate` tool: the EU ETS cost and the FuelEU exposure are both facts of the recommended route from `plan_route_speed`, and the difference is computed by `calculate`.
- compliance-04 must abstain: the data holds no pooling, banking or borrowing positions.
