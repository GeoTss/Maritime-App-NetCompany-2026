---
name: Pharos
description: The ops console of a bunker-to-berth desk, flown like a signal hoist. Dark, dense, data-first; every state a code flag beside its word.
colors:
  ink-950: "#0e1114"
  ink-900: "#151a1f"
  ink-850: "#1d232a"
  ink-800: "#1d232a"
  line: "#29313a"
  line-strong: "#3a4450"
  text-1: "#eef1f4"
  text-2: "#a9b2bd"
  text-3: "#8a95a1"
  beacon: "#6f9bff"
  caution: "#ffc72c"
  alarm: "#ff5c6c"
  alarm-fill: "#c8102e"
  plan: "#a9b2bd"
  lamp: "#1f4fb0"
  map-sea: "#121820"
  map-land: "#1c232b"
  map-coast: "#33404d"
  map-traffic: "#5d6b79"
  wave-0: "#121c26"
  wave-1: "#1b2733"
  wave-2: "#2a3a49"
  wave-3: "#3e5367"
  flag-red: "#c8102e"
  flag-yellow: "#ffc72c"
  flag-blue: "#1f4fb0"
  flag-white: "#ffffff"
  flag-black: "#0b0b0b"
typography:
  readout:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "2rem"
    lineHeight: "2.25rem"
    fontWeight: 500
    fontFeature: "'tnum', 'zero'"
  headline:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    lineHeight: "1.75rem"
    fontWeight: 500
  title:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    lineHeight: "1.25rem"
    fontWeight: 500
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    lineHeight: "1.125rem"
    fontWeight: 400
    fontFeature: "'tnum', 'zero'"
  control:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    lineHeight: "1rem"
    fontWeight: 500
  label:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "0.6875rem"
    lineHeight: "1rem"
    fontWeight: 500
  identifier:
    fontFamily: "Atkinson Hyperlegible Mono Variable, ui-monospace, monospace"
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
  top-bar: "48px"
components:
  button-commit:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.flag-white}"
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

<!-- Written by /impeccable document from the code shipped in the UI round (Signal hoist):
     apps/web/src/styles/globals.css, components/top-bar.tsx, components/primitives/state-flag.tsx,
     components/fact-chip.tsx, components/source-badge.tsx, components/ui/*, features/*.
     The frontmatter equals globals.css; where the build and the sketches in docs/design/signal-hoist
     differ, the build is recorded and the gap noted. -->

## Overview

**Creative North Star: "Signal hoist"**

Every state on the desk flies as a code flag, colour and pattern together, so nothing has to be
read twice. The palette is the International Code of Signals' five pigments (red, yellow, blue,
white, black) on a dark ground, and the interface treats a status the way a ship treats a hoist: a
small flag, always beside the word it stands for. Pharos is a lighthouse; its console is the desk a
watch officer works at, dark, dense with readings, and lit only where something needs them.

The density is that of an instrument panel, not a dashboard: 28 px controls and rows, 12 px panel
padding, hairline borders, tabular figures with slashed zeros everywhere a number appears. Every
cited number is a fact chip that opens to its source, so the interface is built around evidence
rather than emphasis. The product holds a few rules the visuals must never break: there is no green
anywhere; colour never carries meaning alone; every number shown is a cited tool fact and is never
animated; untrusted text (email, AIS names and destinations, hazard labels) renders as text only;
fonts are bundled, so the console runs offline.

**Key Characteristics:**
- Dark only: one token set on `:root`, `color-scheme: dark`. No light theme.
- One family, Atkinson Hyperlegible Next, with its Mono for identifiers and verbatim email only.
- Each hue has one job; light signal blue acts, yellow asks, red blocks, and there is no green.
- Navigation is four screen tabs in a 48 px top bar. No subject tabs, no nav rail.
- Sharp geometry (1 to 3 px corners); circles only for status dots and vessel markers.
- Flat surfaces separated by hairlines; the popover is the only thing that floats.

## Colors

A cool near-black blue-grey ground with the five code-flag pigments, each tied to one job.

### Primary
- **Light signal blue** (beacon, #6f9bff): act and select. Focus rings, links, the active screen
  tab's 2 px underline, the fact-chip underline, selection, the recommended route and option. Dark
  text (ink-950) sits on it.
- **True signal blue** (lamp, #1f4fb0): the one solid primary, with white text. Approve and Review
  and decide, and the confirm inside its dialog. Nothing else is solid blue.

### Secondary
- **Needs-you yellow** (caution, #ffc72c): awaiting a decision. As a fill it takes black text; as a
  small status word it may sit on dark.
- **Alarm red** (alarm, #ff5c6c for text and lines; alarm-fill, #c8102e for fills): blocked,
  hazard, ruled out, reject.
- **Plan slate** (plan, #a9b2bd): the current plan or baseline route, other candidates, the VLSFO
  trace.

### Flag pigments (flag-red, flag-yellow, flag-blue, flag-white, flag-black)
The ICS flags in their true values (#c8102e, #ffc72c, #1f4fb0, #ffffff, #0b0b0b), used only inside
`StateFlag` glyphs, with a 1 px outline at 55 % of text-1 (`--flag-outline`) so the dark pigments
hold against the ground. Lamp and flag-blue are the same value; flag-white is also the commit text.

### Neutral
- **Ground** (ink-950, #0e1114): the page.
- **Panel** (ink-900, #151a1f): panels, the top bar, the assistant dock.
- **Raised** (ink-850 and ink-800, both #1d232a): popovers, hover, selected rows, tooltips, the
  default button. Two tokens, one value; use ink-850 for raised surfaces and ink-800 for controls.
- **Hairline** (line, #29313a) and **strong hairline** (line-strong, #3a4450): row and panel
  borders; control borders and column-head rules.
- **Text** (text-1 #eef1f4, text-2 #a9b2bd, text-3 #8a95a1): values and prose; labels; hints, ids
  and times. Every pair meets 4.5:1 on ink-900 and ink-950 (guarded by `styles/contrast.test.ts`).
- **Map** (map-sea #121820, map-land #1c232b, map-coast #33404d, map-traffic #5d6b79): the bundled
  basemap and public AIS traffic. **Waves** (wave-0 to wave-3, #121c26 to #3e5367) are a neutral
  lightness ramp, never a hue.

### Named Rules
**The No-Green Rule.** There is no green anywhere: not for success, not for live, not for a saving.
A completed or recommended state is blue or a neutral check, and a live source is a filled neutral
dot.

**The One Job Rule.** A hue appears only with its meaning. Yellow is never a highlight, red is
never decoration, light blue is never a status.

**The Never-Alone Rule.** Colour never carries meaning alone. A state flag always sits beside its
word, is `aria-hidden`, and pairs pattern with colour. Routes pair colour with dash (recommended
solid beacon, current plan dashed slate, ruled out dotted alarm).

**The Lamp Rule.** Solid true signal blue is the commit action. The default button is neutral
ink so nobody reaches the lamp by accident.

## Typography

**Display, Body and Label Font:** Atkinson Hyperlegible Next Variable (with system-ui, sans-serif)
**Mono Font:** Atkinson Hyperlegible Mono Variable (with ui-monospace), exposed as `font-verbatim`

**Character:** a typeface drawn so that look-alike characters cannot be confused, which suits
tonnage, MMSI and prices read at a glance. There is no width axis: hierarchy comes from size and a
medium weight, with a little tracking (0.01em) on labels. Mono marks what you would copy or look up
(MMSI, IMO, UN/LOCODE, fact ids, prompt versions, coordinates) and the verbatim text of a supplier
email, where the sender's spacing and columns must survive.

### Hierarchy
The steps are the tokens `text-2xs` to `text-2xl`; 11, 12, 13 (body), 15, 18, 24 and 32 px.
- **Readout** (500, 32 px, 36 px): large metric readouts and the "k of N" counts on evaluation.
- **Headline** (500, 24 px, 28 px): screen titles.
- **Title** (500, 15 px, 20 px; 18 px, 24 px where an answer leads): panel and section titles.
- **Body** (400, 13 px, 18 px): answers, summaries, tables; prose held to 60 to 72 ch.
- **Control** (500, 12 px, 16 px): buttons, inputs, tabs, table cells.
- **Label** (500, 11 px, 16 px, +0.01em): column heads, field labels; sentence case.
- **Identifier** (Mono 400, 11 px, 16 px): ids, codes, timestamps, verbatim email at 13 px.

### Named Rules
**The Tabular Rule.** The body sets `tabular-nums slashed-zero`, so columns of figures align and a
zero is never an O.

**The Mono-Means-Identifier Rule.** Mono never sets prose, labels or decoration. If you would not
copy it into a search box, it is not mono. The one prose exception is a verbatim email body.

**The Bundled-Fonts Rule.** Fonts load through `@fontsource-variable`; no CDN, no remote stylesheet.

## Layout

Every screen shares one frame: a 48 px top bar (wordmark, four screen tabs, the AIS and Weather
source modes, the simulation clock, "Go to" with ⌘K, and the assistant toggle), the screen canvas,
and the assistant dock. From 768 px the dock is a resizable, collapsible panel (default 360 px, 280
px minimum, at most half the width); below 768 px it is a bottom drawer (vaul). A skip link and the
`/` key reach the question box. Content is left-aligned and the canvas scrolls inside the frame, so
the bar stays put. Spacing keeps Tailwind's 4 px base (8 px gutters, 12 px panel padding).

The four screens: **Map** has a Needs-you column on the left (everything that waits on the
operator, ordered by what blocks the next decision, with the flag key), the map in the centre with
the cited plan drawn on it, and a 332 px vessel or route panel floating top right; **Inbox** pins the
email verbatim beside the extracted record, with only what needs settling shown as choices;
**Approvals** is a queue (awaiting, then decided) beside one decision with a sticky action bar;
**Evaluation** opens with its four claims, then held-out and dev side by side per suite.

## Elevation & Depth

Flat. Depth comes from tonal steps of ink (950 ground, 900 panel, 850 raised) and 1 px hairlines.
Only the floating layer (popovers, menus, selects, dialogs) lifts, and overlays dim the page
without blur. Map controls (the zoom group) are restyled to ink-900 with a hairline and no shadow.

### Named Rules
**The Hairline Rule.** Separation is a 1 px line in `line` or `line-strong`. No coloured side
stripes, no zero-offset glows, no glass, no hard offset shadows.

## Shapes

Sharp. Radius tokens are 1 px (sm), 2 px (md, lg; the base `--radius`), and 3 px (xl, 2xl), 4 px
at the largest. Tags and badges are rectangles, not pills. Full circles are reserved for status
dots (live is a filled dot, recorded a hollow one, both neutral) and vessel markers. State flags
are 14 by 10 px rectangles, the proportion of a signal flag.

## Components

### Buttons
- **Shape:** 2 px corners; 28 px high (24 px small, 20 px extra small); 8 px side padding; 12 px
  medium text.
- **Commit:** lamp ground, white text, semibold. Approve, Review and decide, and the confirm inside
  the approval dialog.
- **Default:** raised ink with a strong hairline; the everyday action ("Plan route").
- **Outline, Ghost, Secondary:** hairline or bare; toolbar and top-bar actions.
- **Destructive:** alarm text on an alarm tint; the reject confirm.
- **Link:** beacon text, underline on hover.
- **Focus:** 2 px beacon ring at 30 %; disabled at 50 % opacity.

### State flag
The signature component. ICS flags as 14 by 10 px SVG glyphs in their true pigments, always beside
their word and `aria-hidden`: **K** (yellow hoist, blue fly) needs you, awaiting a decision; **V**
(red saltire on white) vessel alert; **U** (red and white quarters) hazard; **C** (blue, white, red,
white, blue bands) approved; **N** (blue and white chequer) rejected. The Needs-you column carries a
key spelling each with its ICS phrase.

### Screen tabs and count badges
- Text tabs at 13 px in text-2; hover lifts to text-1; the active tab is text-1 with a 2 px beacon
  underline. A tab with work waiting shows the K flag, a semibold count and "need you" (screen
  reader text). Inbox counts quotes to review, Approvals counts proposals.

### Chips and tags
- **Fact chip:** the number exactly as written, in text-1, with a dotted beacon underline (3 px
  offset). Hover tints beacon at 12 %. Never animated. The popover shows label, value and unit as
  returned, the provenance by kind (database record, calculation, supplier email, AIS report,
  weather snapshot, derived operands as nested chips, to three levels) and the fact id in Mono.
- **Source badge:** a 6 px dot (hollow recorded, filled live), the source name in text-2, the mode
  in text-1; the tooltip explains the mode and when it last updated. Below `lg` the badges fold to
  one summary naming every source to assistive technology.
- **Data tag:** 20 px, 1 px corners, 11 px text, neutral: "simulated data", "synthetic", "dev split",
  "draft, not sent".

### Cards / Containers
- **Corner Style:** 0 to 2 px. **Background:** ink-900 on ink-950. **Border:** 1 px hairline.
  **Internal Padding:** 12 px. **Shadow:** none.
- **Approval card:** kind and status in the header with a flag, a balanced title, the summary as
  fact text, then Approve (commit) and Reject (outline), both behind a dialog that restates the
  order in words. The top pending card carries the Approvals page's one focal effect, a border beam
  that stops under reduced motion. A decided card folds to header, title and outcome, with facts,
  drafts and the audit trail behind a disclosure.
- **Needs-you item:** a flag, its status word, an optional kind tag at the right, one sentence, and
  the action that goes where the operator acts.

### Inputs / Fields
- **Style:** 28 px, strong-hairline border, ink-900 ground, 2 px corners; caret in beacon.
- **Focus:** border shifts to beacon with a 2 px ring at 30 %. **Error:** alarm border and ring.
  **Disabled:** 50 %.

### Tables
- **Rows:** 28 px with hairlines; column heads at 11 px label text over a strong hairline; numbers
  right-aligned and tabular. The options table is built from the plan's facts.

### Map
- Sea, land and coast from the bundled basemap; AIS traffic in map-traffic; the current plan dashed
  plan slate, the recommended route solid beacon, a ruled-out route dotted alarm, hazards in alarm
  red. Waves are a neutral lightness ramp. HTML markers carry labels; a vessel's dot is its marker,
  and an alerted vessel carries the Magic UI ripple, the map's one self-running effect, static under
  reduced motion. Layer toggles show a pressed state; the cited plan appears as a chip ("Showing
  bunker plan 1") with Clear and a legend.

### Navigation and menus
- **⌘K menu:** cmdk in a dialog; screens always, screens add their own groups (vessels, ports, ships
  by name or MMSI, desk actions). Selected row on raised ink. Toasts are sonner, drawers vaul.

### Agent trace and metric number
- **Trace:** a collapsible header (spinner, then a muted check; alarm when stopped) over a
  hairline-indented list of tool chips, one 28 px row per call. It folds when work settles.
- **Metric number:** state numbers (ships at anchor, waiting hours, fuel on board) animate through
  `MetricNumber`; static under reduced motion; never used for a cited fact.

### Untrusted text
- Email bodies, evidence sentences, AIS names and destinations and hazard labels render as a React
  text node inside `<bdi>` (`UntrustedText`), never as markup. Email bodies and evidence set in
  `font-verbatim` with the sender's spacing preserved.

## Do's and Don'ts

### Do:
- **Do** take every colour, radius and font from the tokens in `apps/web/src/styles/globals.css`;
  no raw hex in components.
- **Do** put a state flag beside its word, every time, and give routes a dash pattern as well as a hue.
- **Do** keep every shown number a cited tool fact, opening to its source; use `MetricNumber` only
  for uncited state numbers.
- **Do** keep controls and rows at 28 px (24 px compact) and panels at 12 px padding.
- **Do** set ids, codes and verbatim email in Mono, everything else in Atkinson Hyperlegible Next.
- **Do** label data honestly: source mode per source, the simulation clock, "simulated data",
  "synthetic", "dev split", "draft, not sent".
- **Do** say in words what an approval will do, and hold focus on the safe choice.
- **Do** theme browser surfaces: selection and caret in beacon, thin dark scrollbars, dark zoom control.

### Don't:
- **Don't** use green, anywhere, for any meaning.
- **Don't** let colour carry meaning alone, or add a hue or a flag without a job and a word.
- **Don't** use solid true signal blue for anything but the commit action.
- **Don't** animate a cited fact, or more than one focal effect per page (ripple on the map, border
  beam on approvals).
- **Don't** render email, AIS or hazard text as markup.
- **Don't** use all-caps labels, tracked-out eyebrows, pill buttons, gradient text, glass or card
  grids for lists; no shadows outside popovers, menus, selects and dialogs.
- **Don't** load fonts, tiles or scripts from another origin; the console runs offline.
