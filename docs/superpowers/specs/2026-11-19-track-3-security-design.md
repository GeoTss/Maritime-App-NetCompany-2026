# Track 3, security: design

- **Status:** for the user's approval, 2026-11-19.
- **User decisions (2026-11-19):**
  - "Now expand the map and start planning track 3 for the security. Also point out the dangerous areas and where they will be needed the most. Also make it so an approval from a quote is needed just like with fuel."
  - The security voyage is **MT Atlantic Meridian** (a tanker no held-out question names), given a new voyage **Fujairah → Rotterdam**. It sails from Fujairah at the anchor, so the security team boards before the first danger area.
  - Security quotes arrive as **emails read by the AI**, like fuel quotes (so they need golden test emails and a paid extraction eval).
  - The map covers **Africa and the Arabian Sea** (done: commit 17f29ed).
  - Danger areas and their risk levels come from **real, cited sources** (researched 2026-11-19: `docs/research/2026-11-19-maritime-security-sources.md`); costs stay illustrative and labelled.
- **Earlier decisions that still hold:** light tests (2–4 per domain function), held-out answer keys never move, paid runs only within a cap the user sets, nothing is sent.

## Why

The prototype plans fuel, the port call and the weather. A desk routing a tanker from the Gulf to Europe also has to decide **how to get past the dangerous waters**: through the Gulf of Aden, Bab-el-Mandeb and the Red Sea to Suez, with an armed security team and a war-risk premium, or round the Cape of Good Hope, thousands of miles longer. Security teams are bought like fuel: providers send quotes, a person approves one, and the ship can't sail the risky route without it.

Message for the judges: **the planner prices the danger, not just the distance**, and a human still approves every order.

## Goals

1. **The map shows the danger areas**, shaded by risk level, each labelled with what the sources say (status, recent incidents, what protection is used there). The areas a voyage crosses are highlighted with the miles and hours inside each.
2. **Where protection is needed most.** Each area carries the JMIC threat level the sources give for November 2026 (CRITICAL, SEVERE, SUBSTANTIAL, MODERATE or LOW) and a planning policy that follows from it. The table is ranked most-needed first:

   | Area | Level (Nov 2026) | Policy | Why (sources) |
   | --- | --- | --- | --- |
   | Strait of Hormuz | SEVERE | `avoid` | US/Israel–Iran conflict since 28 Feb 2026; blockade enforcement; 177 confirmed incidents since 1 Mar |
   | Gulf of Aden | SUBSTANTIAL | `guards` | Houthi campaign against Saudi-linked shipping since 20 Jul 2026, and the piracy route |
   | Southern Red Sea and Bab-el-Mandeb (JWC: Red Sea south of 25.5°N) | SUBSTANTIAL | `premium` | Missile and drone attacks: guards "cannot stop missile attacks", so the risk is priced (war-risk premium 0.5 % of hull value for a Bab-el-Mandeb transit, Jul 2026) |
   | Arabian Sea and Somali Basin | MODERATE | `guards` | 8 Somali hijackings Jan–Sep 2026; an armed skiff 430 nm east of Socotra on 16 Nov; at least three guards advised |
   | Gulf of Oman | MODERATE | `measures` | Attacks after 1 Oct; reporting and protective measures |
   | Gulf of Guinea (JWC polygon) | listed by insurers; low activity | `escort` | 2 incidents Jan–Sep 2026; private armed guards not allowed in Nigerian waters, navy escort vessels instead |

   Policies:
   - `guards`: the route needs an armed security team;
   - `premium`: the route pays the war-risk premium;
   - `measures`: reporting and protective measures only, no cost;
   - `escort`: shown on the map only (no voyage uses it yet);
   - `avoid`: no transit.

   November levels are from secondary reports citing JMIC; the research file lists the gaps.
3. **The voyage**: Atlantic Meridian, laden, Fujairah → Rotterdam. Route options include the planned route via the Red Sea and Suez, the sea alternatives, and **round the Cape** (an explicit candidate: the graph search alone would never offer a route 1.7× longer).
4. **Security is planned and costed per route option.** Both routes cross the Arabian Sea and Somali Basin, so **both need a team**. What differs:
   - **Via Suez:** a shorter team contract (disembarking at a Red Sea floating armoury or at Suez with the Canal Authority's weapons letter), the Bab-el-Mandeb premium, canal dues and the wait for the next northbound convoy (05:30–11:00).
   - **Via the Cape:** a longer team contract (until the ship leaves the Somali Basin area), no premium, no dues, and 4,100–4,900 nm and 10–16 days more sailing (fuel, time, EU ETS).

   Each option is costed from:
   - the areas crossed (entry and exit, miles, hours);
   - the team: from the embark point before the first `guards` area to the disembark point after the last, at the quote's day rate, plus its fixed fees (embarkation, arms storage);
   - the premium: a share of the hull value for each `premium` area crossed;
   - Suez: the canal dues (illustrative, labelled; no authoritative dollar toll was found) and the convoy wait;
   - full sea speed inside `guards` areas (protective-measures guidance), so speed and fuel differ inside and outside.

   A route through a `guards` area without a covering, valid security quote is infeasible (`security_unavailable`); through an `avoid` area, infeasible (`avoid_area`).
5. **The recommended plan** is the cheapest feasible route with security included; the answer shows what the Suez route saves or costs against the Cape once security, premium, dues and waiting are counted.
6. **Security quotes from email**: three provider emails in the demo inbox (different day rates, team sizes, embark and disembark points; one held for review because it is ambiguous). The extractor reads them like fuel quotes, every value linked to the sentence it came from.
7. **Approval like fuel**: from the plan, a person (or the assistant) proposes a **security order** for the chosen quote; a person approves it; the ERP simulator returns a PO number; the provider confirmation is drafted, never sent. The voyage instruction for a route that needs security **waits for that order**, as it waits for the fuel order today.

## Non-goals

- A real threat feed (UKMTO, MDAT-GoG) in live mode: the areas are seeded reference data with a date.
- Insurance quotes (the premium is a seeded rate, not a quote).
- More than one security team or provider per voyage; changing team between areas.
- Bunkering for Atlantic Meridian (its fuel is sufficient; its decision is the route).
- Changing the six-step demo story: security gets its own short story test.

## Approaches considered

| Decision | Options | Pick and why |
| --- | --- | --- |
| How security quotes become data | (A) structured offers seeded in the inbox · (B) emails read by the AI | **B** (user decision). Same pipeline as fuel, with evidence and a review queue; needs golden emails and a paid eval. |
| Extraction schema | (A) a second prompt for security emails, chosen by a classifier · (B) one prompt, the output union gains `security_quote` | **B.** The output is already a union on `kind` (`quote`, `not_a_quote`); one call stays one call, and the fuel path is unchanged in shape. The prompt version moves to `extract-quote/v3`, under the eval protocol. |
| Approving a security quote | (A) generalise the purchase order to any service · (B) a new `security_order` type with its own table and ERP line kind | **B.** Fuel orders carry grades, quantities and barge fees the security order doesn't have; a separate type keeps both honest. It touches the four enum copies, the proposal tool, the executor and the approvals screen, the cost Track 1 avoided, now asked for. |
| Where security lives in a plan | (A) a separate security planner · (B) inside each route option, like the port call inside a stop plan | **B.** Security changes cost, time and speed of the route itself; one answer, no contradiction on the same screen. |
| Speed inside a risk area | (A) one speed per option (as today) · (B) full sea speed inside `guards` areas, the chosen speed elsewhere | **B.** That is what the guidance asks for and what makes the security route cost fuel; the track walk already goes sub-step by sub-step. |
| Danger areas | (A) drawn by hand · (B) seeded from the cited sources, with level, policy and date | **B** (user decision: real sources). |
| Assistant tools | (A) a new tool · (B) extend `plan_route_speed`, `list_quotes` and `propose_action` | **B**, but the `propose_action` enum gains `security_order`, which changes every request: all recorded replies are re-recorded and the agent prompt is bumped under the eval protocol (live smoke). |

## Data (seeded, synthetic unless cited)

- **Ports** added: Fujairah (AEFJR), Suez (EGSUZ, canal entry), Djibouti (DJJIB), Salalah (OMSLL), Cape Town (ZACPT), Las Palmas (ESLPA). Legs from the same sea-route builder.
- **Atlantic Meridian's voyage**: AEFJR → EGSUZ → NLRTM, laden, sailing from Fujairah at the anchor, planned speed 12.5 kn.
- **Security areas** (`security_areas`): id, name, JMIC level, policy, boundary, as-of date, source citation and incident note, from the table above and the research file. Boundaries are lat/lon boxes following the published limits (JWC listed areas, the 2021 HRA polygon) or the sources' descriptions, labelled approximate.
- **Rates**, each labelled with its basis:

  | Rate | Value | Basis |
  | --- | --- | --- |
  | Bab-el-Mandeb premium | 0.5 % of hull value per transit | cited, S&P/Marsh via Al Jazeera, Jul 2026 |
  | Hull value | USD 45 M | illustrative |
  | Suez dues, 74,000 dwt laden tanker | USD 300,000 | illustrative; order of magnitude from an unconfirmed Platts LR1 figure; the 37 % laden-crude surcharge noted |
  | Guard team | about USD 1,000 a day for a 3-person team | about $30k a month, Lloyd's List 2024 |
  | Floating-armoury fees | USD 500 per guard to embark or disembark; USD 3,000–4,000 arms storage | 2014 |
  | Suez weapons storage | USD 500 | — |
  | Northbound convoy | 05:30–11:00; transit 12–16 h | — |

  The provider emails' prices sit in these ranges.
- **Security providers**: three fictional companies, each with an email domain and ERP code; their quote emails are generated from truth files by code (never written by the model) for the demo inbox and the golden set.

## Room left

- Live threat feeds; the Gulf of Guinea voyage (the areas are drawn, no voyage uses them yet); insurance as quotes; convoys other than Suez.

## Left to the builder

Exact box boundaries (following the sources), wording, map styling within the Signal hoist world (a hue per level from the existing tokens, plus a new one only if none fits), and the security story's exact assertions.
