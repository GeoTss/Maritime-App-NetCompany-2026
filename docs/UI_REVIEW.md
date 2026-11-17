# UI review of the ops console (2026-11-17)

The spec for the UI round. It holds the impeccable critique of `apps/web` (dual-agent: a design review that walked the six-step story, and the detector), the user's decisions on it, and an index of the six redesign boards. The boards' sources are in `docs/design/ui-round/` (`.dc.html`: plain HTML with inline styles, readable as a visual spec; the live canvas is the user's private artifact "Pharos console redesign"). The plan that implements this is `docs/superpowers/plans/2026-11-17-ui-round.md`.

## Decisions (user, 2026-11-17)

1. **Build first:** the answer drawn on the map, the purchase-order decision and the confirm that restates it (boards 4, 2, 6).
2. **Scope:** all six boards, in waves.
3. **DESIGN.md:** amend it where the boards change its rules: recorded mode becomes neutral, times move from B612 Mono to Archivo with tabular figures, and plain-text email bodies render in a system monospace so their columns line up.
4. **New visual world (later the same day):** asked for real alternatives in type, colour and tab management, the user compared four directions drawn across the whole app.
   - The four directions: Signal hoist, Chart paper, Terminal wayfinding, and the current night-watch desk.
   - The user chose **Signal hoist** (International Code of Signals), "dark themed and without the extra tabs".
   - This supersedes decision 3: the night-watch desk is replaced, not amended.
   - Its sketches are `docs/design/signal-hoist/{map,inbox,approvals,evaluation}.html`. Its direction contract is `apps/web/.impeccable/surfaces/src-app-tsx.md`.
   - The boards below remain the spec for layout, content and behaviour; the Signal hoist sketches are the spec for the look.

### The Signal hoist world (dark, screen tabs only)

- **Ground:** #0e1114, panels and top bar #151a1f, raised and hover #1d232a, hairlines #29313a, strong lines #3a4450.
- **Text:** #eef1f4, secondary #a9b2bd, hint #8a95a1. Every pair is at least 4.5:1.
- **Colour jobs.** There is no green anywhere.
  - Light signal blue #6f9bff: act, recommended, fact-chip underline, selection, focus. Dark text #0e1114 sits on it.
  - True signal blue #1f4fb0 with white text: the one solid primary (Approve, Review and decide).
  - Yellow #ffc72c with black text: needs you, awaiting a decision. As a small status word it may also be yellow on dark.
  - Red #ff5c6c for text and lines, true red #c8102e for fills: blocked, hazard, reject.
- **State flags.** ICS flag glyphs in their true pigments, with a 1px rgba(238,241,244,.55) outline, always beside their word:
  - K: needs you, awaiting a decision;
  - V: a vessel alert;
  - U: a hazard;
  - C: approved;
  - N: rejected.
- **Type:** Atkinson Hyperlegible Next for everything, with tabular figures and the slashed zero it is designed with. Atkinson Hyperlegible Mono is for identifiers and verbatim email bodies only. Both are bundled through `@fontsource-variable`.
- **Navigation:**
  - a 48 px top bar holds the wordmark, the four screen tabs (Map, Inbox, Approvals, Evaluation) with K-flag count badges, the source modes, the sim clock and "Go to ⌘K";
  - there are no subject tabs and no nav rail.
- **Map:** sea #121820, land #1c232b, coast #33404d; AIS traffic #5d6b79; the planned track dashed #a9b2bd; the hazard dashed #ff5c6c; rank 1 is #6f9bff.

## Boards (`docs/design/ui-round/`)

| Board | File | What it changes |
|---|---|---|
| 1 Map as the watch desk | `Main.dc.html` | A "Needs you" column ordered by what blocks the next decision; "N need you" in the status strip; a dated sim clock; neutral source modes; a labelled 64 px rail with count badges and no design kit; layer toggles with a visible pressed state; waves as a neutral lightness ramp (never a hue); a dated forecast timeline; port queues with units ("28 at anchor · 42.0 h wait"); the managed fleet as a table; dark zoom controls. |
| 2 Approvals | `Decision.dc.html` | A queue (awaiting, then decided) beside one decision; the order as four facts (grade and quantity, headline price, total delivered cost, delay); a headline-price vs total-delivered-cost slope chart of every option in the plan; the margin against the runner-up; facts, drafts and audit behind disclosures; a sticky action bar saying in words what approving does. |
| 3 Inbox | `Inbox.dc.html` | The email pinned beside the record, verbatim (sender's spacing kept), evidence spans marked; "Needs you · 2" as choices (300 mt / 350 mt / Other…; "Yes, per tonne" / "No, correct it…"); "Matches the email · 5"; "Not in the email · 2"; Accept disabled until settled; list items show "N to settle". |
| 4 The answer draws itself on the map | `Answer.dc.html` | The cited bunker plan drawn on the map: the three ports lit by rank with their totals, a "Showing bunker plan 1 · 3 options · from your question" chip with Clear, a legend; the dock shows the lead sentence, a real list, an options table built from the plan's facts, a visible "every number above is a tool fact" line and an inline proposal card. |
| 5 Evaluation | `Evaluation.dc.html` | Four held-out claims first (32 of 32 grounded, 23 of 24 correct, 0 of 156 unsafe auto-accepts, 1,170 of 1,182 critical fields); per suite, held-out and dev side by side with interval bars on group axes (accuracy 50–100 %, should-be-zero 0–25 %, workload 0–50 %); extra metrics folded. |
| 6 Confirm | `Confirm.dc.html` | The approve dialog restates the order: title "Order 300 mt LSMGO from Kestrel Marine Fuels at Marsaxlokk?", then for, total delivered cost with effective price, margin against the runner-up, delay, and what happens; "Keep it pending" holds the focus. |

Board numbers are illustrative of the recorded demo; every number in the built UI comes from an API fact. One number on boards 2 and 6 is new: the runner-up margin (USD 5,310.37 = 239,253.28 − 233,942.91), which the plan adds as a derived fact computed by `packages/domain`.

## Critique

Method: dual-agent (A: design review, opus · B: detector + browser, sonnet)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | After accepting a correction the quote panel still shows "300/350 mt" and red checks; replay answers land with the trace already folded; a reload drops the conversation and route plan |
| 2 | Match system / real world | 2 | Machine speak leaks: `unit_known`, "line 0", "planBunkers / options[0].qtyMt", a boolean "false" in a popover, "gate passed", "MTMLA-kestrel" |
| 3 | User control and freedom | 3 | Commits sit behind dialogs with safe default focus; "Try again" on a deterministic replay miss always fails; no undo after accepting a correction |
| 4 | Consistency and standards | 2 | Same saving as "$48,024.56" and "USD 48,025"; "EUR 3,000" vs "EUR 3000"; tray says Route A "Infeasible", answer says it "meets the window" |
| 5 | Error prevention | 3 | Accept stays disabled until fixed; the PO confirm does not restate supplier, quantity or total |
| 6 | Recognition rather than recall | 2 | Port labels "28 / 42.0 h" have no units; the fix form scrolls the email away; the card hides the runner-up |
| 7 | Flexibility and efficiency | 2 | ⌘K with MMSI search is good; no skip link, ~20 tab stops to the composer, no approve/next keys, answer to map takes two clicks |
| 8 | Aesthetic and minimalist design | 3 | Disciplined tokens; up to five floating surfaces on the map; the option prefix repeats on every fact row |
| 9 | Error recovery | 2 | Clear replay-miss copy with a futile button; the "/ mt" price check contradicts the email |
| 10 | Help and documentation | 2 | Helper lines and badge tooltips are good; no map legend, no glossary (FuelEU, EU ETS, load factor) |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict
Specific in materials, generic in composition. The night-ink tokens, hairlines, B612 identifiers, chart-magenta hazards, the lamp-white commit and the fact chip with provenance are authored for this product. The layout is not: a map with floating panels, a three-pane mail client, a chat column, a card queue and a metrics list. The product's core idea, a spatial decision backed by evidence, never reaches the composition: the bunker answer is typed bullets in a 360 px column while the map idles. Hue discipline slips where it matters: about 150 weather glyphs are painted in beacon (`features/map/weather-layer.tsx`), and amber means recorded, needs review and awaiting approval at once, so recorded mode is permanently amber.

Deterministic scan: CLI `detect apps/web/src` returned 3 findings, all `design-system-font-size` (0.625rem, below the 11 px ramp) in shadcn primitives `components/ui/input-group.tsx:26`, `kbd.tsx:8`, `toggle.tsx:17`: real, one-line fixes. Per-URL headless scans: `/` 3 `tiny-text` + 1 `flat-type-hierarchy` (h2 12 px vs body 13 px, real); `/evaluation` 9 `tiny-text` (11 px is the designed label step, false positive, but text-3 on ink-800 measures about 4.2:1, under AA); `/inbox` and `/approvals` clean. Browser overlay: not available, the page's CSP (`script-src 'self'`) blocked injection.

## Priority Issues
- [P1] The map and the answer don't talk. Fix: a cited calculation draws itself on the map by its stored id (ranked bunker ports, routes A/B/C), framed clear of every panel; collapse the vessel panel while the tray is open; toasts bottom-left. Command: /impeccable layout (map), /impeccable onboard for the empty dock.
- [P1] The purchase-order decision isn't summarised at the moment of commitment. Generic confirm, no quantity or total on the card, saving measured against the cheapest headline rather than the runner-up (USD 5,310.37), focus drops to body after the dialog. Fix: decision summary + confirm that restates the order; runner-up margin as a view-only fact; AlertDialogTrigger for focus return. Command: /impeccable clarify, /impeccable harden.
- [P1] Hue discipline breaks: beacon weather glyphs, amber for recorded mode, green for "Extracted" and "executed". Fix: weather as a neutral lightness ramp; recorded = hollow dot in neutral; amber only for "needs you"; extracted/executed neutral with a check. Command: /impeccable colorize (in reverse: restore the one-job rule).
- [P1] Contradictions and machine speak in the evidence layer (route A infeasible vs meets window; "Current plan" vs "Planned route"; booleans; raw provenance ids; 0-based checks). Fix: one vocabulary from the API, operator-first popovers with ids under a technical fold, checks phrased as reasons. Command: /impeccable clarify.
- [P2] The held-quote fix works against the reviewer: email scrolls away, 11 equal fields, no aria-invalid, no corrected record after save. Fix: email pinned beside the record, flagged fields first as choices, the rest folded, corrected record after save. Command: /impeccable distill.

## Persona Red Flags
- Alex (keyboard): focus drops to body after ⌘K selection and after the approval dialog; no skip link; no key to focus Ask; no approve/next keys; empty ⌘K lists 1,100 ships under "Map".
- Sam (screen reader): with the route tray open, the strip, map, vessel panel and dock become aria-hidden while visible and focusable; two identical "Approve" names; forecast slider thumb unnamed ("0 of 79"); port labels read without units.
- Bunker-desk operator deciding a PO: gets no quantity or total in the title, six equal fact rows with long prefixes, a straw-man saving, no runner-up margin, no draft preview, a generic confirm; no pending badge in the rail.
- Hackathon juror: first frame shows "1,100 ships" on a near-empty Med covered in blue wave dots; "Show on map" then "Plan route" is dead air; Route A contradiction; the story ends on a dense evaluation wall.

## Minor Observations
- B612 Mono gives a colon or period a full cell: "08:05Z" reads "08: 05Z", "33.139" reads "33. 139".
- Evaluation: "1170 of 1182" wraps at 1280 px and lacks separators; run date in ISO.
- Sim clock lacks its date while ETAs are 10 days out.
- Inbox list sorted by delivery reads 05:00Z, 07:00Z, 03:00Z.
- "Nordwind Bunker Services's"; native dd/mm/yyyy date inputs; Design kit in the operator rail.
- Layer toggles: on/off differ only by border tint; on mobile the layer panel takes a quarter of the map.
- Replay-miss state should offer "New conversation", not "Try again".

## Questions to Consider
- If the map is the signature, why does "Where should we bunker?" never touch it?
- In recorded mode amber is always on. If everything is caution, where does the operator look first?
- The PO saves USD 16,138 against a headline price nobody would buy. Isn't the honest margin the runner-up's USD 5,310?

## Redesign boards
Canvas "Pharos console redesign": 1 map as the watch desk, 2 approvals decision with the price-vs-delivered slope, 3 inbox settle-only-what-needs-you, 4 the answer draws itself on the map, 5 evaluation opens with four claims, 6 confirm restates the order.
