# Product

<!-- impeccable:product-schema 1 -->

Source: the user-approved master plan (`docs/MASTER_PLAN.md`, approved 2026-11-14) and the Phase 6 plan (`docs/superpowers/plans/2026-11-16-phase-6-ops-console.md`, approved 2026-11-16). No separate interview was run; every fact below is taken from those two documents.

## Platform

web

## Users

The operator at a shipping company's bunker-to-berth desk: the person who decides where and from whom a vessel buys fuel, and which route and speed it sails to make its berth window. They work from supplier quote emails, noon reports, live ship positions and the weather, and today re-key quotes by hand. The secondary audience is a hackathon jury watching a six-minute live demo.

## Product Purpose

Pharos is a GenAI assistant for that desk. It reads supplier quote emails into structured records with the sentence each value came from, answers plain-language questions over the fleet's data with the facts behind every number, optimises route and speed with live weather, and drafts purchase orders and voyage instructions for a human to approve. Success: the operator reaches the cheapest decision once barge fee, deviation, delay, weather, carbon and FuelEU cost are counted (not the cheapest headline price), and can see why.

## Positioning

Every number is computed by deterministic code and shown as a cited fact; the model only explains and proposes. Nothing is sent to an external party, and nothing changes until a person approves.

## Operating Context

The demo story, in order: (1) the map with real ships on live or recorded AIS and a wave and wind overlay, with the managed vessel MV Aegean Pioneer flagged for low-sulphur fuel; (2) the inbox, where three supplier emails become quotes beside their source, one held for a human fix; (3) a question about where to bunker, answered with clickable facts; (4) a route and speed question, with three candidate routes on the map; (5) approval of the purchase order (pushed to the ERP simulator) and of the voyage instruction (drafted for the master, never sent); (6) the evaluation page with measured accuracy. The demo must run fully offline in recorded mode.

## Capabilities and Constraints

- The console never computes a business number; it shows what the API returns, and every number in an answer is a fact chip with its source.
- Approve and Reject are the only actions that commit anything, each confirmed first. Drafted messages are read-only.
- AIS ship names and destinations, hazard labels and email bodies are untrusted text: shown as text, never as markup or instructions.
- Honesty signals are part of the product: each data source's mode (live or recorded), the simulation clock, "simulated data" on private company data, "synthetic" on the demo hazard.
- No CDN, tile server or map token: fonts and the Natural Earth basemap are bundled.
- Routes are planning-grade, not for navigation; the weather and FuelEU models are simplified and documented.

## Brand Commitments

- The name is Pharos (a lighthouse).
- The user likes the Palantir Foundry ship-tracking look as inspiration (dark, dense, data-first). Do not copy Palantir's name, logo or assets.

## Evidence on Hand

- Measured accuracy lives in `evals/` and is published for the console by `npm run eval:publish`; show only published live-run numbers, as "k of N" with intervals, labelled dev split.
- Real public data: AIS capture `fixtures/recorded/ais-capture.jsonl`, weather snapshot `fixtures/recorded/weather-snapshot.json`. Fleet, quotes and orders are synthetic and must be labelled as simulated.
- There are no customers, testimonials or production users; do not invent any.

## Product Principles

1. Show the facts behind every number.
2. A person decides; the assistant proposes.
3. Say plainly what is live, recorded, simulated or synthetic.
4. The demo works with the network unplugged.

## Accessibility & Inclusion

Keyboard operable throughout (including the Cmd+K menu and the approval dialogs), visible focus, reduced motion respected, WCAG AA contrast on the dark theme.
