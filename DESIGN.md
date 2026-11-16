---
name: Pharos
description: The ops console of a bunker-to-berth desk. Dark, dense, data-first; colour only for meaning.
colors:
  ink-950: "#0c1218"
  ink-900: "#121a22"
  ink-850: "#18222c"
  ink-800: "#1f2b37"
  line: "#263442"
  line-strong: "#364757"
  text-1: "#e4eaf0"
  text-2: "#9fb0c0"
  text-3: "#7b8d9f"
  beacon: "#5cc8f2"
  go: "#3ddc97"
  caution: "#f2b84b"
  alarm: "#ff5d5d"
  chart-magenta: "#e86bd6"
  plan: "#8fa3b8"
  lamp: "#f4f1e6"
  sea: "#0e1822"
  land: "#1b2630"
  coast: "#2e3e4d"
  traffic: "#5b7186"
typography:
  readout:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "2rem"
    lineHeight: "2.25rem"
    fontWeight: 400
    fontVariation: "'wdth' 75"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    lineHeight: "1.75rem"
    fontWeight: 500
    fontVariation: "'wdth' 88"
  title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    lineHeight: "1.25rem"
    fontWeight: 500
    fontVariation: "'wdth' 88"
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    lineHeight: "1.125rem"
    fontWeight: 400
    fontFeature: "'tnum'"
  control:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    lineHeight: "1rem"
    fontWeight: 500
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.6875rem"
    lineHeight: "1rem"
    fontWeight: 500
    fontVariation: "'wdth' 80"
  identifier:
    fontFamily: "B612 Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    lineHeight: "1rem"
    fontWeight: 400
rounded:
  sm: "1px"
  md: "2px"
  lg: "2px"
  xl: "3px"
spacing:
  hairline: "1px"
  gutter: "8px"
  panel: "12px"
  control: "28px"
  control-compact: "24px"
  row: "28px"
  status-strip: "36px"
  nav-rail: "44px"
components:
  button-commit:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.ink-950}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "0 8px"
  button-default:
    backgroundColor: "{colors.ink-800}"
    textColor: "{colors.text-1}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "0 8px"
  button-outline:
    backgroundColor: "{colors.ink-900}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
  button-link:
    textColor: "{colors.beacon}"
  input:
    backgroundColor: "{colors.ink-900}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "2px 8px"
  table-row:
    height: "{spacing.row}"
    padding: "0 8px"
  data-tag:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "20px"
    padding: "0 6px"
  popover:
    backgroundColor: "{colors.ink-850}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.lg}"
    padding: "{spacing.panel}"
  tooltip:
    backgroundColor: "{colors.ink-800}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
---

# Design System: Pharos

<!-- Written by /impeccable document (scan mode) from the code shipped in Phase 6 Task 9:
     apps/web/src/styles/globals.css, components/ui/*, components/*, features/dev/kit-page.tsx.
     The qualitative language comes from the approved design deliverables (2026-11-16); no
     separate interview was run. Updated in the Phase 6 fix wave (Task 15) from the shipped code.

     Direction seed: none (pinned). No catalog world was rolled: the user pinned the direction in
     their own words, a "Palantir Foundry ship-tracking look", "dark, dense, data-first"
     (PRODUCT.md, Brand Commitments), and approved these tokens and fonts on 2026-11-16. -->

## Overview

**Creative North Star: "The night-watch desk"**

Pharos is a lighthouse, and its console is the desk a watch officer works at night: dark, quiet,
dense with readings, and lit only where something needs attention. Colour is never decoration.
It follows nautical-chart convention: hazards in chart magenta as on paper charts and ECDIS, the
recommended route in starboard green, the planned route in a quiet slate. The single warm element
on any screen is the lamp-white commit button, because the only control that can change the world
should look like nothing else.

The density is that of an instrument panel, not a dashboard: 28 px controls and rows, 12 px panel
padding, hairline borders, tabular numerals everywhere a number appears. Every cited number is a
fact chip that opens to its source, so the interface is built around evidence rather than
emphasis. Inspiration is the dark, data-first look of commercial ship-tracking tools; none of any
product's name, logo or assets. The direction is pinned by the user ("Palantir Foundry
ship-tracking look", "dark, dense, data-first"); it is not open to a redesign roll.

**Key Characteristics:**
- Dark only; one token set on `:root`, `color-scheme: dark`.
- Each hue has one job, and a hue never appears without that meaning.
- One family (Archivo) in two voices by width; B612 Mono for identifiers only.
- Sharp geometry (1 to 3 px corners); circles only for status dots and vessel markers.
- Flat surfaces separated by hairlines; the popover is the only thing with a shadow.
- Left-aligned content, sentence case, no all-caps labels, no pill buttons, no card grids.

## Colors

A cool, near-black blue-grey ground with five signal hues, each tied to one meaning, and one warm
lamp reserved for commitment.

### Primary
- **Beacon blue** (beacon): everything interactive. Focus rings, links, fact-chip underlines,
  selection, the active rail marker. If it is beacon, you can act on it.

### Secondary
- **Starboard green** (go): the recommended route, a positive saving, a live data source.
- **Watch amber** (caution): needs review, awaiting approval, a recorded data source.
- **Alarm red** (alarm): shortfall, infeasible, failed, reject.
- **Chart magenta** (chart-magenta): hazard zones, and the "synthetic" tag on made-up data.
- **Slate plan** (plan): the planned or baseline route and the other candidates.

### Tertiary
- **Lamp white** (lamp): the commit button. Nothing else, ever.

### Neutral
- **Night ink** (ink-950): the page.
- **Panel ink** (ink-900): panels, the nav rail, the status strip, the assistant dock.
- **Raised ink** (ink-850): popovers and raised rows.
- **Hover ink** (ink-800): hover, the active rail item, the selected command, tooltips.
- **Hairline** (line): borders between rows and panels.
- **Strong hairline** (line-strong): control borders and column-head rules.
- **Chart text** (text-1): values and primary text.
- **Label text** (text-2): labels and secondary text.
- **Hint text** (text-3): hints, ids, timestamps; one step lighter than first proposed so it passes
  AA at 11 px.
- **Map**: sea, land, coast and traffic carry the bundled basemap and public AIS traffic.

### Named Rules
**The One Job Rule.** A hue appears only with its meaning. Green is never "nice", amber is never a
highlight, magenta is never brand.

**The Lamp Rule.** Lamp white is the commit button (Approve, and the confirm inside its dialog).
The default button is neutral ink so nobody reaches the lamp by accident; tooltips are dark plates
for the same reason.

## Typography

**Display Font:** Archivo Variable (with system-ui), at 75 % width for readouts
**Body Font:** Archivo Variable (with system-ui)
**Label/Mono Font:** B612 Mono, designed for cockpit displays, for identifiers only

**Character:** one family, two voices: Archivo condensed for labels and titles reads like the
legend of a chart; at full width it carries prose. B612 Mono marks things you would copy or look
up (MMSI, IMO, UN/LOCODE, fact ids, coordinates, the simulation clock).

### Hierarchy
- **Readout** (400, 32 px, 36 px, 75 % width): large metric readouts on a panel; the "k of N"
  counts on the evaluation page ("of" at 13 px in label text).
- **Headline** (500, 24 px, 28 px, 88 %): screen titles.
- **Title** (500, 15 to 18 px, 88 %): panel and section titles, an answer's lead.
- **Body** (400, 13 px, 18 px): answers, emails, summaries; prose is held to 60 to 72 ch.
- **Control** (500, 12 px): buttons, inputs, table cells.
- **Label** (500, 11 px, 80 % width): column heads, field labels; sentence case.
- **Identifier** (B612 Mono 400, 11 px): ids, codes, timestamps.

### Named Rules
**The Tabular Rule.** Every number sets in tabular figures (`font-variant-numeric: tabular-nums`
on the body), so columns of figures align and changing values do not jitter.

**The Mono-Means-Identifier Rule.** B612 Mono never sets prose, labels or decoration. If you would
not copy it into a search box, it is not mono. Measurements (counts, rates, intervals, latency,
cost) are Archivo with tabular figures; mono is for model ids, prompt versions and timestamps.

**One time and percent style.** Times read "16 Nov 15:45Z" everywhere (a fact's popover keeps the
full ISO value it was returned with); percentages sit tight to the number ("95%", "99.2%").

## Layout

Every screen shares one frame: a 36 px status strip (wordmark, per-source mode badges, the
simulation clock, the ⌘K trigger, the dock toggle), a 44 px nav rail (four screens, the design
kit at the foot), the screen canvas, and the assistant dock on the right. From 768 px the dock is
a resizable, collapsible panel (default 360 px, 280 px minimum, at most half the width); below
768 px it becomes a bottom drawer. Content is left-aligned; reading measure is capped. Spacing
keeps Tailwind's 4 px base: 8 px gutters, 12 px panel padding, tight groups and wider gaps between
sections. Lists are bordered rows, never card grids; the page scrolls inside the canvas, not the
window, so the strip and rail stay put.

## Elevation & Depth

Flat. Depth comes from tonal steps of ink (950 page, 900 panel, 850 raised, 800 hover) and 1 px
hairlines, not from shadows. The single exception is the floating layer: popovers, menus and
selects carry the stock `shadow-md` so a fact-chip source reads as lifted above the answer.
Overlays dim the page with ink at 80 % and no blur.

### Named Rules
**The Hairline Rule.** Separation is a 1 px line in `line` or `line-strong`. No coloured side
borders thicker than 1 px, no zero-offset glows, no glass.

## Shapes

Sharp. Radius tokens are 1 px (small), 2 px (default, large) and 3 px (dialogs, drawers).
Badges and tags are 1 px rectangles, not pills. Full circles are reserved for status dots (the
live or recorded mark beside a source) and vessel markers on the map.

## Components

### Buttons
- **Shape:** 2 px corners; 28 px high, 24 px compact; 8 px side padding; 12 px medium text.
- **Commit:** lamp ground, night-ink text, semibold. Approve only, and the confirm inside its
  dialog.
- **Default:** hover-ink ground with a strong hairline; the everyday action ("Plan route").
- **Outline / Ghost:** hairline or bare; operator inputs and toolbar actions.
- **Destructive:** alarm text on an alarm tint; Reject's confirm.
- **Link:** beacon text, underline on hover.
- **Focus:** 2 px beacon ring at 30 %; disabled at 50 % opacity.

### Chips
- **Fact chip:** the number exactly as the answer wrote it, in chart text, with a dotted beacon
  underline (3 px offset). Hover tints beacon at 12 %; open goes solid. Never animated. A citation
  with no written number gets a small beacon link mark. The popover shows label, value and unit as
  returned, the provenance by kind (database row, calculation, email sentence with a link to the
  inbox, AIS MMSI and time, weather snapshot, derived operands as nested chips) and the fact id.
- **Data tag:** 20 px, 1 px corners, 11 px text: "simulated data" (neutral), "synthetic"
  (magenta), "unverified" (amber), "dev split", "draft, not sent", "live run" (neutral, an
  evaluation measured with live calls), "model: recorded" (amber) or "model: live" (green) in the
  assistant's header, from the API's health.
- **Source badge:** a status dot, the source name in label text, the mode in its hue (live green,
  recorded amber); a tooltip explains the mode and when it last updated. Below 768 px the strip
  keeps one dot and mode word per distinct mode ("recorded"), naming every source in its tooltip
  and to assistive technology, so no source's mode leaves the screen.
- **Status tag:** an inbox status in its hue; "Accepted after fix" (a quote a person corrected)
  keeps the review hue with a caution border, never the green of a clean extraction.

### Cards / Containers
- **Corner Style:** 0 to 2 px.
- **Background:** panel ink on night ink.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1 px hairline; header and footer separated by hairlines.
- **Internal Padding:** 12 px.
- **Approval card:** kind in label text and status in its hue in the header, a balanced title,
  the summary as fact text, then Approve (commit) and Reject (outline). The top pending card may
  carry the page's one focal effect, a caution border beam, which stops under reduced motion.
  The queue is split under two headings, "Awaiting your decision" and "Decided"; a decided card
  folds to header, title, saving and outcome, with its facts, drafts and audit trail behind one
  disclosure. Audit details read as labelled pairs; an option id ("B", "MTMLA-kestrel") carries
  its human name beside the chip.
- **Callouts:** a 1 px hairline box or a leading status icon in its hue; never a coloured side
  stripe.

### Map labels
- HTML markers (the basemap has no glyphs). A vessel's dot is its marker, centred on the position;
  its name sits beside it, clear of an alerted vessel's ripple. Labels flip left at the right edge
  of the visible map (the canvas, or the panel drawn over it), and the hazard callout sits above
  its point (below near the top). Where labels would overlap, the lower one hides until zoomed
  apart, in this order: hazard callout (always shown), flagged or selected vessel, vessel, port.
- On a narrow canvas the first view frames the flagged vessel and the hazard; selecting a vessel
  or ship that the panel, the tray or the edge would hide pans it into the clear part of the map.

### Inputs / Fields
- **Style:** 28 px, strong-hairline border, panel-ink ground, 2 px corners; caret in beacon.
- **Focus:** border shifts to beacon with a 2 px ring at 30 %.
- **Error / Disabled:** alarm border and ring; disabled at 50 %.

### Navigation
- **Rail:** 36 px icon targets in hint text; hover lifts to hover ink and chart text; the active
  screen sits on hover ink with a 1 px beacon mark at the rail edge. Tooltips name each screen.
- **⌘K menu:** cmdk in a dialog; the screens group is always there, screens register their own
  groups (vessels, ports, ships by name or MMSI, desk actions). Selected row on hover ink.

### Tables
- **Rows:** 28 px with hairlines; column heads at 11 px, 80 % width, label text, over a strong
  hairline; numbers right-aligned and tabular.

### Agent trace
- **Thinking state:** a collapsible header (spinner while working, a muted check when done, alarm
  when stopped) over a hairline-indented trace; it folds itself when work settles.
- **Tool chips:** one 28 px row per tool call: the tool in words, its id in a mono chip, the time
  the API reported.
- **Diff table:** before and after side by side; a changed row strikes the old value in hint text
  and shows the new one in chart text (or green for a recommended route).

### Metric number
- Numbers that change state (ships at anchor, waiting hours, fuel on board) animate between API
  values through NumberFlow, with the same display format as static text; static under reduced
  motion; never used for a cited fact.

## Do's and Don'ts

### Do:
- **Do** take every colour, radius and font from the tokens in `apps/web/src/styles/globals.css`.
- **Do** keep controls and rows at 28 px (24 px compact) and panels at 12 px padding.
- **Do** set ids, codes and the clock in B612 Mono, and everything else in Archivo.
- **Do** label data honestly: source mode per source, the simulation clock with "pinned", and
  "simulated data", "synthetic", "unverified", "dev split" or "draft, not sent" where they apply.
- **Do** put Approve and Reject behind a dialog that says what will happen, in words.
- **Do** theme the browser surfaces: selection in beacon, the caret in beacon, thin dark scrollbars.

### Don't:
- **Don't** use lamp white for anything but the commit button.
- **Don't** use a signal hue without its meaning, or add a new accent.
- **Don't** animate a cited fact, or more than one focal effect per page (ripple on the map,
  border beam on approvals).
- **Don't** use all-caps labels, tracked-out eyebrows, pill buttons, gradient text, glass, or card
  grids for lists.
- **Don't** add shadows outside popovers, menus and selects.
- **Don't** load fonts, tiles or scripts from another origin; the console runs offline.
