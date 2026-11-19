# Q&A golden set: Track 3 security questions (review)

The Q&A world adds the two demo security quotes for MT Atlantic Meridian's Fujairah departure
(demo emails 04 and 05, as the pipeline stores them: `insertDemoSecurityQuotes`). Every value
below is computed by the reference code from that world; no model wrote any of them.

## security (4; dev 2)

### security-01 [dev]

- Question: Should Atlantic Meridian go through the Red Sea or round the Cape?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - MT Atlantic Meridian: best route ignoring fuel on board: **B**
  - MT Atlantic Meridian, route B: total voyage cost (fuel, EU ETS, FuelEU, vessel time): **1688632.234886 USD (±0.5)**
  - MT Atlantic Meridian, route K: total voyage cost (fuel, EU ETS, FuelEU, vessel time): **2144908.356144 USD (±0.5)**

### security-02 [heldout]

- Question: Which security provider should we use for Atlantic Meridian?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - Tridentis Marine Protection security quote (Fujairah to Djibouti): provider: **Tridentis Marine Protection**
  - MT Atlantic Meridian, route B: armed security team days: **6 days**

### security-03 [heldout]

- Question: How much does security add to Atlantic Meridian's voyage cost on the recommended route?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - MT Atlantic Meridian, route B: security and canal cost (team, war-risk premium, canal dues): **538500 USD**

### security-04 [dev]

- Question: When does the armed security team board Atlantic Meridian?
- Expected kind: `answer`
- Must not propose: true
- Proposed option: none
- Required facts:
  - MT Atlantic Meridian, route B: security team boards (UTC): **2026-11-14T08:00:00.000Z**
