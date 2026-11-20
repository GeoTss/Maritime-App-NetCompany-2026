---
name: pick-ui-library
description: Map a UI need in the Pharos ops console (apps/web) to the one approved library or installed component before any feature code is written, and install missing pieces through the shadcn CLI. Use this whenever you are about to build or change anything in apps/web, a screen, panel, card, list, form, toast, drawer, sheet, dialog, menu, command palette, tooltip, tabs, chart, map layer, number readout, agent progress, approval card or diff view, even if the request does not mention a library, and whenever you are tempted to write a UI primitive by hand.
---

# Pick the UI library first

The console is built from components that already exist in the repo or in an approved registry.
Hand-rolled toasts, drawers, command menus, dialogs, dropdowns and number tickers are where
accessibility, focus handling and animation break, so they are never written from scratch here.
Settle the library for every need **before** writing feature code, then compose.

## 1. Look up each need

| UI need | Use | Lives in |
| --- | --- | --- |
| Button, input, textarea, select, tabs, tooltip, badge, table, separator, scroll area, skeleton, kbd, toggle, toggle group, slider, collapsible | shadcn (`radix-mira`) | `apps/web/src/components/ui/` |
| Dialog; a confirmation before a state change | shadcn `dialog`, `alert-dialog` | `components/ui/` |
| Dropdown or context menu | shadcn `dropdown-menu` | `components/ui/` |
| Popover (e.g. a fact chip's source) | shadcn `popover` | `components/ui/` |
| Resizable docked panels | shadcn `resizable` (react-resizable-panels) | `components/ui/` |
| Any notification or toast | **sonner** via `components/ui/sonner.tsx`; `<Toaster />` is mounted once in `src/app.tsx`, call `toast(...)` from `sonner` | `components/ui/` |
| Bottom sheet, draggable drawer, mobile panel | **vaul** via shadcn `drawer` | `components/ui/` |
| Cmd+K palette, searchable command list | **cmdk** via shadcn `command` | `components/ui/` |
| A number that changes state (counts, waits, fuel on board) | **@number-flow/react** through the `MetricNumber` wrapper | `src/components/metric-number.tsx` |
| Agent progress (thinking, tool calls) | `ThinkingState`, `ToolChips`: composed from shadcn primitives in `components/primitives` (Beautiful UI pattern) | `src/components/primitives/` |
| An agent proposal awaiting approval | `ApprovalCard` + `DecisionButtons`: composed from shadcn primitives in `components/primitives` (Beautiful UI pattern) | `components/primitives/` |
| Before/after or written/corrected comparison | `DiffTable`: composed from shadcn `table` in `components/primitives` (Beautiful UI pattern) | `components/primitives/` |
| Charts | shadcn `chart` (Recharts) | `components/ui/` |
| Map, layers, markers | MapLibre GL via `react-map-gl/maplibre`, basemap `public/basemap.generated.geojson`; no tiles, glyphs or sprites; labels are HTML markers | `src/features/map/` |
| Icons | `@hugeicons/react` + `@hugeicons/core-free-icons` | — |
| Server state, routing | TanStack Query, react-router | `src/lib/`, `src/routes.tsx` |
| One animated focal effect | Magic UI `ripple` (map: the flagged vessel) or `border-beam` (approvals: the top pending card) | `components/ui/` |

If a need is not in the table, take the first that fits, in this order: an installed shadcn
item → a shadcn registry item → compose from installed primitives. Say which you chose and why
in your report. Aceternity UI and 21st.dev are not used (licence
terms could not be verified as open), and nothing loads from a CDN: the demo runs offline.

## 2. Install what is missing (lead only)

Builder agents cannot install: a hook blocks `npx shadcn`, `npm install` and friends for them.
If the component is not in `apps/web/src/components/`, stop and ask the lead with the exact
command. The lead runs, from the repo root, with the repo-local npm cache:

```bash
npm_config_cache=$PWD/.npm-cache npx shadcn@4.23.0 add <item> -y -c apps/web
npm_config_cache=$PWD/.npm-cache npx shadcn@4.23.0 add @magicui/<item> -y -c apps/web
```

Installed code lives in the repo and is meant to be read and edited there. Restyle it to the
tokens in `src/styles/globals.css`; never fork a second copy.

## 3. Rules that hold for every component

- **Tokens, not hex.** Colours, radius, type scale and fonts come from `globals.css`. Each hue
  has one job: beacon = interactive, go = recommended/positive/live, caution = review/awaiting/
  recorded, alarm = shortfall/failed, chart magenta = hazards and "synthetic", plan = baseline,
  lamp = the commit button only.
- **No business maths in the UI.** Show what the API returns; formatting is the only arithmetic.
  Every number in an answer is a fact chip with its source. `MetricNumber` animates only between
  values the API returned and is never used inside a fact chip.
- **Untrusted text stays text.** AIS names and destinations, hazard labels and email bodies are
  rendered as React text; `dangerouslySetInnerHTML` is banned outside `components/ui/chart.tsx`.
- **One focal animation per page**, from the table above; respect `prefers-reduced-motion`.
- **Only Approve and Reject commit a business action**, each behind a dialog that says what
  will happen. A POST fires only on an explicit user action.
- **Contracts:** call the API only through `src/lib/api.ts` with schemas from `@pharos/shared`;
  never import backend code.

## 4. Check before calling it done

Run `npx impeccable detect apps/web/src` (and against the running page,
`npx impeccable detect http://localhost:5173/<route>`), then look at the screen in the browser
pane. Fix or explain every finding.
