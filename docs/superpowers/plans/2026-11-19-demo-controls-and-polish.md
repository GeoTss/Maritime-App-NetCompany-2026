# Demo Controls and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (hackathon scope, below) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A presenter can change the demo world live (vessel stats, hazards, weather in an area), see every action a voyage takes (each port call's jobs and the en-route events, with a filter per kind), and the console's three rough edges are gone: the route tray scrolls to its end, the map stops flipping over Portugal, and weather is drawn as soft darts for waves and wind.

**Architecture:**
- **Fixes first.** Tray height follows its snap point (web only). The basemap build splits the one ring that crosses the antimeridian (script and regenerated file only).
- **Darts.** A symbol layer per field (waves, wind), using SDF dart images drawn once at map load. Each layer has its own toggle. The heavy-weather limit comes from the weather view, not from a copy in the web.
- **Timeline.** A pure `voyageTimeline` in `packages/domain` re-walks the recommended option with the optimiser's own walk and emits sorted events. The API attaches `{ events, facts }` to the route-plan response. The web shows the list in the vessel panel and markers on the map, filtered by five groups.
- **Scenario.** Human-only demo controls under `/api/scenario`, on only when `DEMO_CONTROLS=on` on the pinned recorded stack. Vessel and hazard edits write their rows. Weather areas live in their own table and are laid over the latest snapshot when it is read, so snapshot ids do not churn. Reset reseeds exactly as `SEED_ON_BOOT=reset` does and reloads the recorded sources.

**Tech Stack:** TypeScript 6 ESM, Zod (`packages/shared`), Vitest, Drizzle + Postgres (`packages/db`), Hono (`apps/api`), React 19 + Vite + Tailwind 4 + shadcn + vaul + MapLibre via react-map-gl (`apps/web`), Playwright (`e2e/`).

**Spec:** no separate spec. The user's request and answers (2026-11-19) are below; "Req N" means item N.

## Requirements (user, 2026-11-19)

1. **Req 1. Change the demo world:** vessel stats, hazards, weather in a specific area. Answer: *a panel in the console*: Vessels / Hazards / Weather tabs, click the map to place, one Reset button back to the recorded demo.
2. **Req 2. See the actions:** what each needed port stop does (refuel, provisions restock, …) and what happens while under way (e.g. controlled sewage disposal). Answer: show *all* of ECA fuel changeover, sewage discharge windows, danger area and guards, storm detour and notices, **and provisions restock if needed**, with **a toggle per kind** for what the timeline shows.
3. **Req 3.** The route options panel cannot be scrolled to the bottom.
4. **Req 4.** The map over Portugal flips at one zoom level, then rights itself.
5. **Req 5.** Replace the weather dots with soft pointing darts whose intensity follows the weather. Answer: **waves and wind**, each with its own overlay toggle.

## Diagnoses (done while planning; evidence, not guesses)

- **Req 3.** vaul places a `h-full` drawer and translates it down by `(1 − snap) × container height` (`node_modules/vaul/dist/index.mjs:540-561`). The tray's scroll area fills the whole drawer, so at the middle snap its bottom half sits below the canvas edge. Scrolling reaches the end of the content, but the end is off screen.
- **Req 4.** `scripts/build-basemap.ts` keeps any Natural Earth polygon that touches the region, unclipped. The Afro-Eurasia ring spans −180…179.87 and has two 359.87° edges, at 65°N and 69°N, where it crosses the antimeridian round Chukotka. Tiled the way MapLibre does it (geojson-vt + earcut), the fill over Portugal is wrong at tile zoom 2 (deviation 3.31 for Lisbon, Porto and Faro) and at tile zoom 3 for Porto (0.76). It is correct from zoom 4 down. The map's `minZoom` is 2.5, so map zooms 2.5–3.99 show the broken tiles. That is the flip. Unwrapping the ring, then clipping it to lon [−180, 180] three times (shifted by −360, 0 and +360), gives deviation 0 at tile zooms 1–9 and keeps every continent. Scratch checks: `basemap-check.mjs` and `tile-check.mjs` in this session's scratchpad.

## Hackathon scope (memory: light tests, token economy)

- **Execution:** native, in one session. No per-task reviewers. One quick self-review of the branch before the merge.
- **Tests:** domain is test-first with **2–4 tests per function**. API and web get only the tests named below, plus fixing the tests and snapshots that break.
- **No paid calls.** No prompt change, no new agent tool, and **`plan_route_speed`'s output stays byte-identical**: the timeline rides on the HTTP response only and inserts no calculation row. If the replay story shows any miss, stop and ask (the `eval-bench` protocol).
- **Cut order if time runs short** (first to go first): pick-on-map (typed lat/lon stays) → timeline markers on the map (the list stays) → sewage windows and the coastline (the other event kinds stay).

## Global Constraints

- **Branch.** `feat/demo-controls` off `build/prototype`. Never push. Merge only in Task 10, on the user's go-ahead.
- **Maths and facts.** Every computed number comes from `packages/domain` (pure, test-first; the purity hook enforces it). Every number the UI shows is a fact chip. The UI derives no business number and animates no fact.
- **Versions.** `DOMAIN_CODE_VERSION` `"0.8.0"` → `"0.9.0"`. `SEED_VERSION` stays `"security-v1"`. The seed data is untouched; the migration only adds a table and a column.
- **New constants** (exact values; `packages/domain/src/constants.ts`):

  | Constant | Value | Note |
  | --- | --- | --- |
  | `SEWAGE_DISCHARGE_MIN_LAND_NM` | `12` | holding-tank sewage, MARPOL Annex IV reg. 11.1.1 |
  | `SEWAGE_DISCHARGE_MIN_SOG_KN` | `4` | en route, same regulation |
  | `SEWAGE_MIN_WINDOW_HOURS` | `1` | shorter windows are not shown |
  | `ECA_CHANGEOVER_LEAD_HOURS` | `1` | start of the changeover before the ECA line (illustrative) |
  | `COAST_CELL_DEG` | `1` | bucket size of the coastline index |

- **Scenario bounds** (Zod in `packages/shared/src/scenario.ts`; the server rejects with 422 and writes nothing):

  | Field | Bounds |
  | --- | --- |
  | `robMt[grade]` | `0 ≤ v ≤ tankCapacityMt[grade]` (after the patch) |
  | `tankCapacityMt[grade]` | `0–10000` |
  | `consumption.refSpeedKn`, `minSpeedKn`, `maxSpeedKn` | `5–25`, `3–20`, `8–25`, with `min ≤ ref ≤ max` |
  | `consumption.refMtPerDay`, `auxMtPerDay` | `1–200`, `0–20` |
  | `dailyCostUsd`, `hullValueUsd` | `0–200000`, `0–500000000` |
  | `stores.crew`, `provisionsPersonDays` | `1–60` (integer), `0–10000` |
  | `stores.sludgeM3`, `sewageM3` | `0` to the vessel's own capacity |
  | hazard `label`, `radiusNm` | 1–80 characters, `1–200` |
  | weather area `radiusNm`, `waveHeightM`, `windSpeedKn` | `30–600`, `0–15`, `0–100` |
  | weather area `waveDirDeg`, `windDirDeg` | integer `0–359`, the direction it comes **from** |

- **Scenario gating.** `/api/scenario` mutations work only when `config.demoControls` is true, the clock is pinned **and** the weather source is recorded. Otherwise `GET` returns `{ enabled: false, reason }` and every mutation returns 403. `scripts/demo-reset.ts` `composeEnv` adds `DEMO_CONTROLS: "on"`, and `docker-compose.yml` passes it to `api`.
- **Rule 3 holds.** The model never reaches `/api/scenario`: no agent tool, and no proposal kind. These are a presenter's direct edits to demo data, never orders or voyages.
- **Secrets.** Never read, print or link `.env`.
- **Dependencies.** None. vaul, shadcn `tabs`, `toggle-group`, `input`, `select`, `alert-dialog`, `popover`, `collapsible` and sonner are all installed.
- **UI.** Run the `pick-ui-library` skill before each web task. Tokens only, no raw hex in components. Untrusted text (hazard labels, AIS names) renders through `UntrustedText`. Before Tasks 3, 7 and 9 are done: `npx impeccable detect apps/web/src`, and look at the screen in the browser pane.

## Review Focus

1. **Timeline drift.** The timeline's arrival must equal the recommended option's `eta`, and a stop's arrival and departure must equal its `StopTimeline`. → Task 5 test `arrival matches eta`, and Task 4 keeps the optimiser on the extracted walk (its existing tests and snapshots pass unchanged).
2. **Replay unchanged.** With no scenario edits, `plan_route_speed` returns the same bytes and the same calculation ids. → Task 6 test `tool output unchanged`; Task 10 runs both stories twice in replay with 0 misses.
3. **Bad scenario input.** ROB above capacity, min speed above max, a weather area that holds no grid point, editing an AIS-only ship: a 422 or 404 that names the field, and nothing written. → Task 8 tests `rejects rob over capacity`, `rejects empty area`, `ais ship not editable`.
4. **Controls off where they must be.** On an unpinned or live-weather stack: `enabled: false`, mutations 403, and no panel button in the web. → Task 8 test `off unless pinned and recorded`; Task 9 test `no button when disabled`.
5. **A voyage that starts inside an ECA (the whole Med), and a coast-hugging route.** One `eca_entry` with `atDeparture: true`, no false entry, and no sewage window shorter than 1 h. → Task 5 tests `starts inside eca` and `short windows dropped`.

---

### Task 0: Start point

- [ ] **Step 1:** `git status --short` shows only `?? .superpowers/`. Leave it alone. Run `git switch -c feat/demo-controls build/prototype`.
- [ ] **Step 2:** In `.claude/state/status.json`, set `phase` to 11 and `phaseName` to "Demo controls and polish". Leave `evals/budget.json` alone (no paid calls). Commit `chore: phase 11 start (demo controls and polish)`.

### Task 1: The route tray scrolls to its end (Req 3)

**Files:** Modify `apps/web/src/features/map/route-tray.tsx` (`RouteTray`). Test: `apps/web/src/features/map/route-tray.test.tsx`.

- [ ] **Step 1: Failing test** `tray body fits the visible snap`. Render `RouteTray` at `snap={0.5}`: `getByTestId("route-tray-body")` has `style.height === "50%"`. At `snap={0.88}` it is `"88%"`. At `snap={null}` it is `"50%"`, the middle snap.
- [ ] **Step 2:** Wrap the header row and the scroll area in `<div data-testid="route-tray-body" className="flex min-h-0 flex-col" style={{ height: \`${visible * 100}%\` }}>`, with `visible = typeof snap === "number" ? snap : TRAY_SNAPS[1]`. The scroll area keeps `min-h-0 flex-1 overflow-auto`.
- [ ] **Step 3:** Run `npx vitest run apps/web/src/features/map/route-tray.test.tsx`: PASS. In the browser pane, plan a route for Aegean Pioneer, scroll the tray to the end at the middle and top snaps, and confirm the `Current plan` row is fully visible. Commit `fix(web): the route tray's scroll area ends where the tray is visible`.

### Task 2: The basemap no longer crosses the antimeridian (Req 4), and the coastline is exported

**Files:** Create `scripts/basemap-geometry.ts` and `scripts/basemap-geometry.test.ts`. Modify `scripts/build-basemap.ts`. Regenerate `apps/web/public/basemap.generated.geojson`. Create `packages/integrations/src/routes/coastline.generated.json` (written by the same script).

**Interfaces (produces):** `splitAtAntimeridian(polygon: Ring[]): Ring[][]`, where `Ring = [number, number][]` (lon, lat). The coastline file is `{ source: string, rings: [number, number][][] }`: every ring, outer and hole, of every polygon kept, after the split. Task 4 reads it.

- [ ] **Step 1: Failing tests.**
  - `polygon without a jump is returned as is`: one square ring gives `[[square]]`.
  - `ring over the antimeridian splits in two`: a ring `(170,60) (179,60) (-179,60) (-170,60) (-170,70) (-179,70) (179,70) (170,70) (170,60)` splits into two polygons. All longitudes lie in [−180, 180], no edge has |Δlon| > 180, and one polygon's max lon is 180 while the other's min lon is −180.
  - `generated basemap has no antimeridian edge`: read `apps/web/public/basemap.generated.geojson`; no ring has consecutive points with |Δlon| > 180, and every ring has ≥ 4 points and is closed.
- [ ] **Step 2:** Implement `splitAtAntimeridian`. Leave a polygon whose rings have no |Δlon| > 180 edge alone. Otherwise unwrap each ring (add ∓360 at each jump so the ring is continuous). For each shift k ∈ {−360, 0, +360}, shift every ring by k, Sutherland–Hodgman clip it to lon ≥ −180 and lon ≤ 180, and keep the result if the outer ring survives with ≥ 3 points. Drop holes that do not survive. Close each ring.
- [ ] **Step 3:** In `build-basemap.ts`, apply it to each polygon before `simplifyRing` and the bbox filter. Write the coastline file next to `sea-network.generated.json`. Run `npm run map:basemap`, then the tests: PASS.
- [ ] **Step 4:** In the browser pane, centre on Lisbon at map zoom 2.6, 3.0, 3.5 and 4.2. Iberia draws as land at each, with no flip. Screenshot zoom 3.0. Commit `fix(map): split the basemap at the antimeridian (Portugal no longer flips at zoom 2.5–4); export the coastline`.

### Task 3: Weather as soft darts for waves and wind (Req 5)

**Files:**
- Create `apps/web/src/features/map/weather-darts.ts` and `weather-darts.test.ts`.
- Modify `apps/web/src/features/map/weather-layer.tsx`, `layer-toggles.tsx`, `map-view.tsx` (register the images on load), `basemap-style.ts` (`MapColors`, `TOKEN`), `apps/web/src/styles/globals.css`, `packages/shared/src/api.ts` (`WeatherView`), the API's weather view (`GET /weather` in `apps/api/src/live/routes.ts:197`), and the `e2e/demo.spec.ts` selectors if they break.

**Interfaces (produces):**
- `WeatherView.heavyWeatherWaveM: number`, set from the domain's `HEAVY_WEATHER_MAX_WAVE_M`.
- `dartFeatures(weather: WeatherView, field: "waves" | "wind"): FeatureCollection<Point, { v: number; dir: number }>`. `v` is the wave height in m or the wind speed in kn. `dir = (fromDeg + 180) mod 360`, the way the field travels. Points whose value or direction is null are skipped.
- `drawDart(kind: "wave" | "wind", px: number): ImageData | null`, or null where there is no canvas (jsdom).
- `LayerKey` loses `weather` and gains `waves` and `wind`. `DEFAULT_LAYERS.waves = true` and `DEFAULT_LAYERS.wind = false`.

- [ ] **Step 1: Failing tests** (`weather-darts.test.ts`).
  - `dart points where waves travel`: a point with `waveDirDeg: 270` gives `dir: 90`.
  - `null direction draws no dart`.
  - `wind uses wind fields`: `windSpeedKn: 34, windDirDeg: 10` gives `{ v: 34, dir: 190 }`.
- [ ] **Step 2:** Implement `dartFeatures`, and `drawDart` with a 2D canvas, filled white on transparent so it works as an SDF. `wave` is a broad chevron dart with rounded tips. `wind` is a slim kite dart. In `map-view.tsx`'s load handler, register `dart-wave` and `dart-wind` with `{ sdf: true, pixelRatio: 2 }`, and again after any style reload.
- [ ] **Step 3:** Rewrite `WeatherLayer({ weather, colors, show: { waves: boolean; wind: boolean } })` as two `symbol` layers, `weather-waves` and `weather-wind` (wind above waves). Both use `icon-rotate: ["get","dir"]`, `icon-rotation-alignment: "map"`, `icon-allow-overlap: true` and `icon-ignore-placement: true`. For softness, set `icon-halo-color` to the same colour, `icon-halo-width: 1` and `icon-halo-blur: 1.5`.
  - Waves, by `v`: `icon-size` 0→0.35, 2→0.6, 4→0.85, `heavyWeatherWaveM`→1.1. `icon-opacity` 0→0.35, 2→0.6, 4→0.85, limit→1. `icon-color` steps through `--wave-dart-0…3` at 0, 1, 2.5 and 4, then `--storm` at ≥ `heavyWeatherWaveM`.
  - Wind, by `v`: `icon-size` 0→0.3, 10→0.5, 20→0.7, 34→0.95, 48→1.15. `icon-opacity` 0.35→1 over 0→34. `icon-color` steps through `--wind-0…3` at 0, 10, 20 and 34.
  - These stops are a drawing scale, not results.
- [ ] **Step 4:** Add the tokens `--wave-dart-0…3` and `--wind-0…3` (with `--color-*` mappings) to `globals.css`. They must read clearly on `--map-sea`; the existing `--wave-*` are too dark for that. Add them to `MapColors` and `TOKEN`.
- [ ] **Step 5:** In `layer-toggles.tsx`, replace the Weather switch with two switches, Waves and Wind. The forecast strip shows while either is on, and keeps a visible "Weather" heading, which `e2e/demo.spec.ts:155` expects. The Legend shows dart samples for waves (0, 2, 4, ≥ limit m) and wind (0, 10, 20, ≥ 34 kn).
- [ ] **Step 6:** `npx vitest run apps/web/src/features/map`, plus fix the tests that break: PASS. Run impeccable detect and look at the map with waves on, then with both on. Screenshot. Commit `feat(map): weather as soft darts for waves and wind, each with its own switch`.

### Task 4: Contracts, the shared walk, and the coastline index

**Files:**
- Create `packages/shared/src/timeline.ts` (export it from the index) and `packages/domain/src/coast.ts` + `coast.test.ts`.
- Modify `packages/shared/src/api.ts` (`RoutePlanResponse.timeline`), `packages/domain/src/route-optimiser.ts`, `stop-plan.ts`, `constants.ts` and `index.ts` (version).
- Create `packages/integrations/src/routes/coastline.ts`.
- Test: `packages/shared/src/contracts.test.ts` (one parse test per new schema).

**Interfaces (produces):**
- `TimelineGroup = "port" | "eca" | "sewage" | "security" | "storms_notices"`.
- `PortAction = "bunkering" | "provisions" | "charts" | "sludge" | "sewage" | "clearance" | "port_dues"`.
- `VoyageEvent`: a `z.discriminatedUnion("kind", …)`. Every member is `.strict()` and carries `at: IsoDateTime`, `position: LatLon` and `alongNm: NonNeg`, plus:

  | kind | group | extra fields |
  | --- | --- | --- |
  | `departure` | port | none |
  | `port_arrival` | port | `stopIndex: int`, `unlocode`, `actions: PortAction[]` (bunkering always; the rest from the port call's jobs that are `done`, and from its cost lines) |
  | `port_departure` | port | `stopIndex`, `unlocode` |
  | `arrival` | port | `provisionsDaysLeft: number \| null`, `restockNeeded: boolean` (`< PROVISIONS_RESERVE_DAYS`) |
  | `eca_entry` | eca | `atDeparture: boolean`, `changeoverStartAt: IsoDateTime \| null` (null when `atDeparture`), `grade: "LSMGO"` |
  | `eca_exit` | eca | `grade: "VLSFO"` |
  | `sewage_window_open` | sewage | `windowHours: NonNeg` |
  | `sewage_window_close` | sewage | none |
  | `danger_area_entry` | security | `areaId`, `hoursInside`, `guarded: boolean` |
  | `danger_area_exit` | security | `areaId` |
  | `guards_embark`, `guards_disembark` | security | `portId: Id` |
  | `storm_passed` | storms_notices | `stormId`, `clearanceNm: number` (< 0 means it goes through), `maxWaveHeightM`, `synthetic: boolean` |
  | `notice_due` | storms_notices | `stopIndex`, `notice: PreArrivalNoticeKind`, `overdue: boolean` |

- `TIMELINE_GROUP: Record<VoyageEvent["kind"], TimelineGroup>` and `VoyageTimeline = { events: VoyageEvent[]; facts: Fact[] }`.
- `RoutePlanResponse.timeline: VoyageTimeline.nullable().optional()`. `RoutePlanView` inherits it.
- `walkRouteOption(input: RouteSpeedInput, candidateId: string, speedKn: number): { points: LatLon[]; steps: WalkedStep[] }`, in `route-optimiser.ts`.
- `walkStopPlan(input: RouteSpeedInput, optionId: string, speedKn: number): { points: LatLon[]; steps: WalkedStep[]; stopPointIndex: number }`, in `stop-plan.ts`.
- `CoastIndex`, `buildCoastIndex(rings: LatLon[][], cellDeg = COAST_CELL_DEG): CoastIndex` and `withinNmOfLand(p: LatLon, index: CoastIndex, nm: number): boolean`, in `coast.ts`.
- `loadCoastline(): LatLon[][]` (Zod-parsed and memoised), in `packages/integrations/src/routes/coastline.ts`.

- [ ] **Step 1:** Write the contracts and their parse tests: PASS.
- [ ] **Step 2: Extract the walks.** Move the walk that `evaluateRoute` and `evaluateStopPlan` already do into `walkRouteOption` and `walkStopPlan`, unchanged, and make both evaluators call them. Run `npx vitest run packages/domain apps/api/src/routing`: every existing test and snapshot passes **unchanged**. That is the guarantee against drift.
- [ ] **Step 3: Failing tests** (`coast.test.ts`).
  - `point 5 nm off a coast is within 12`: a straight coastline along lat 40 from lon 0 to 2, and a point at (40.0833, 1); 5 nm is 0.0833°.
  - `point 20 nm off is not`.
  - `segment in a neighbouring cell counts`: a point 6 nm from a segment that lies in the next 1° cell.
- [ ] **Step 4:** Implement the index. Bucket each segment into every cell its bbox touches. Query the cells within `ceil(nm / 60 / cos(lat)) + 1` of the point. Use point-to-segment distance in a local equirectangular projection (nm = 60 × degrees of latitude, and longitude scaled by cos(lat)). Then implement `loadCoastline`. Bump `DOMAIN_CODE_VERSION`. Run the tests: PASS. Commit `feat(domain): timeline contracts, the optimiser's walk shared, coastline index`.

### Task 5: `voyageTimeline` (Req 2, the maths)

**Files:** Create `packages/domain/src/timeline.ts` and `timeline.test.ts`. Modify `packages/domain/src/index.ts`.

**Interfaces:**
- **Consumes** (from Task 4): the walks, `withinNmOfLand`, and `TIMELINE_GROUP`. Also the existing `inSulphurEca`, `nearestAlongNm` and `pointAlongPolyline` (`geo.ts`), and `provisionsDaysLeft` (`port-call.ts`).
- **Produces:** `voyageTimeline(a: { input: RouteSpeedInput; result: RouteSpeedResult; stormCells: StormCell[]; coast: CoastIndex | null }): VoyageEvent[]`.
  - It follows `result.plan` when set. Otherwise it follows `result.bestCandidateId`, as a route. With a stop plan it uses `walkStopPlan`, and `walkRouteOption` otherwise, at the option's `speedKn`.
  - Events are sorted by `at`, then by the table order in Task 4.

- [ ] **Step 1: Failing tests.** Build fixtures with a small `RouteSpeedInput` and run `optimiseRouteSpeed` for the result; never hand-write a result.
  - `arrival matches eta`: the last event is `arrival` and its `at` equals the option's `eta`. For a stop plan, `port_arrival.at` and `port_departure.at` equal `stop.arriveAt` and `stop.departAt`.
  - `starts inside eca`: a Med-only route gives exactly one `eca_entry`, with `atDeparture: true` and `changeoverStartAt: null`. A route that leaves the Med at 5.6°W gives one `eca_exit` there.
  - `entry has a changeover lead`: a route from 2°W, 47°N (outside the ECA) into the Channel gives `eca_entry` with `changeoverStartAt` = `at` − 1 h.
  - `short windows dropped`: with a coastline that leaves a 0.5 h stretch of the walk beyond 12 nm, there are no sewage events. With a 3 h stretch there is one open/close pair, and `windowHours` = the summed hours of those sub-steps. With `coast: null` there are no sewage events.
  - `stop actions listed`: a stop plan whose port call has provisions and sewage `done` gives `port_arrival.actions` that include `bunkering`, `provisions`, `sewage` and `port_dues`. A route plan whose provisions run below 7 days gives `arrival.restockNeeded: true`.
  - `storm passed`: with one storm cell 30 nm off the track, `storm_passed.clearanceNm` ≈ 30 − `radiusNm` (within 1 nm).
- [ ] **Step 2: Implement.** Walk once. Accumulate `alongNm` and the time per sub-step, and take positions from the sub-step's `start`/`end`.
  - **ECA:** an event wherever `inSulphurEca(step.mid)` changes value.
  - **Sewage:** windows of consecutive sub-steps with `!withinNmOfLand(mid, coast, 12)` and `sogKn ≥ 4`. Keep those of at least 1 h.
  - **Security** (route options only; stop plans carry no security plan): entry and exit from the option's `security.spans` (`enterNm`/`exitNm`), converted to time and position with the walk, and `hoursInside` copied. Guards come from `security.embarkAt` and `disembarkAt` at the embark and disembark port positions in `input.security`. `guarded` is `security.needsTeam && quoteId !== null`.
  - **Storms:** each cell gives one `storm_passed` at the walk time of `nearestAlongNm(points, center).nm`, with `clearanceNm = offNm − radiusNm`.
  - **Notices:** from `stopPlans[i].portCall.notices`, positioned at the walk position at `dueAt`, clamped to the start.
- [ ] **Step 3:** `npx vitest run packages/domain/src/timeline.test.ts`: PASS. Commit `feat(domain): voyage timeline (port calls, ECA changeover, sewage windows, danger areas, storms, notices)`.

### Task 6: The timeline in the route-plan response, with facts

**Files:** Create `apps/api/src/routing/timeline.ts` and `timeline.test.ts`. Modify `apps/api/src/routing/plan.ts` (`planRouteSpeed`) and the stored-plan read in `apps/api/src/read/db-source.ts`.

**Interfaces:**
- **Consumes:** `voyageTimeline`, `buildCoastIndex`, `loadCoastline` and `calcFact` (`apps/api/src/facts/core.ts`).
- **Produces:** `planTimeline(a: { input: RouteSpeedInput; result: RouteSpeedResult; stormCells: StormCell[]; calculationId: Id }): VoyageTimeline`, plus `TIMELINE_TOOL = "voyage_timeline"`.
  - It builds the coast index once per process.
  - Facts are `calcFact(TIMELINE_TOOL, { id: calculationId, calculator: "voyageTimeline" }, \`timeline.events[${i}].${field}\`, label, value, unit)`.
  - Fields are `at` and `changeoverStartAt` (times, unit null, as the ETA facts are), `windowHours` and `hoursInside` (`"h"`), `clearanceNm` (`"nm"`), `maxWaveHeightM` (`"m"`) and `provisionsDaysLeft` (`"days"`).
  - Port-call numbers are **not** repeated; the web reads them from `plan.facts` (`stopPlans[i].portCall.*`).

- [ ] **Step 1: Failing tests.**
  - `facts cover every timed event`: each event has an `at` fact whose value equals `event.at`.
  - `tool output unchanged`: for the demo world's Aegean Pioneer plan, `routePlanFacts(planned)` deep-equals the facts from before this task (snapshot it first), and the calculations table gains exactly one row per plan.
- [ ] **Step 2:** Set `response.timeline = planTimeline({ …, stormCells: plan.stormCells ?? [] })` in `planRouteSpeed` **after** the calculation row is stored. No new row, and `routePlanFacts` is untouched. In the stored-plan read, build it from the stored optimiser input (`inputs.optimiser`) and output.
- [ ] **Step 3:** `npx vitest run apps/api/src/routing apps/api/src/ai/tools/route-speed.test.ts`: PASS. Commit `feat(api): voyage timeline on the route plan, cited, outside the tool's output`.

### Task 7: Timeline in the vessel panel and on the map (Req 2, the screen)

**Files:**
- Create `apps/web/src/features/map/voyage-timeline.tsx`, `voyage-timeline.test.tsx` and `timeline-markers.tsx`.
- Modify `vessel-panel.tsx` (new `Section` "Voyage timeline" after the fuel-along-plan section) and `map-page.tsx` (group state; the selected event).

**Interfaces:**
- **Consumes:** `RoutePlanView.timeline` and `TIMELINE_GROUP`; the existing `PortCallBlock`, `FactCell` and `factAtPath`.
- **Produces:**
  - `VoyageTimelineSection({ plan, groups, onGroupsChange, selected, onSelect })`. The name avoids the shared `VoyageTimeline` type.
  - `TimelineMarkers({ plan, groups, selected, onSelect })`.
  - `groups: TimelineGroup[]`, defaulting to all five and kept in map-page state.
  - `selected: number | null`, the event index.

- [ ] **Step 1: Failing tests** (`voyage-timeline.test.tsx`, with a fixture plan from `map-fixtures.ts`).
  - `toggle hides a group`: switching off "Sewage" removes every `sewage_window_*` row, and the other groups stay.
  - `port arrival lists its actions and expands`: the row names "Bunkers, provisions, sewage ashore, port dues". Expanding it shows `PortCallBlock` and a bunkering line with the stop's `qtyMt` fact.
  - `no number without a fact`: an event whose `at` fact is missing shows "—".
- [ ] **Step 2:** Build the section.
  - The filter is a shadcn `ToggleGroup type="multiple"` with the labels Port calls, ECA fuel changeover, Sewage discharge, Danger areas and guards, Storms and notices.
  - The list has one row per visible event, each with a time chip and plain words per kind: "Start changeover to LSMGO", "Sewage discharge permitted (more than 12 nm off, 4 kn or more)", "Armed team embarks", "Passes the storm {clearance} off its edge", and so on. Provisions restock appears only when needed, through the port call's `done` jobs or `arrival.restockNeeded`.
  - Port arrivals expand with shadcn `Collapsible`.
  - Markers are react-map-gl `Marker`s at `event.position`, for visible groups only. A small glyph per group, and clicking a marker selects its row and scrolls the row into view.
  - A plan with no timeline (old stored plans) shows "No timeline for this plan."
- [ ] **Step 3:** Run the web tests: PASS. Run impeccable detect, and check Aegean Pioneer and Atlantic Meridian in the browser pane: port call, ECA exit at Gibraltar, the guards, the storm. Screenshot. Commit `feat(web): voyage timeline with a switch per kind, and its markers on the map`.

### Task 8: Scenario controls, the API (Req 1)

**Files:**
- Create `packages/shared/src/scenario.ts` and `packages/db/drizzle/0015_*.sql` (via `drizzle-kit generate`).
- Modify `packages/db/src/schema.ts` (table `scenarioWeatherAreas`; `worldMeta.scenarioEditedAt: ts()` nullable). Add the new table to `ALL_TABLES`, which `packages/db/src/seed/seed.ts:95` truncates on reset.
- Modify `packages/integrations/src/recorded.ts` (`withWeatherAreas`) and `packages/integrations/src/weather/store.ts` (`latestWeatherSnapshot` lays the areas over the grid).
- Create `apps/api/src/scenario/service.ts`, `routes.ts` and `service.test.ts`.
- Modify `apps/api/src/config.ts` (`DEMO_CONTROLS`), `app.ts` and `server.ts` (wiring), `scripts/demo-reset.ts` (`composeEnv`), `docker-compose.yml` and `docs/API.md`.

**Interfaces (produces):**
- `ScenarioVesselPatch`, `ScenarioHazardInput`, `ScenarioWeatherAreaInput`, and `ScenarioWeatherArea` (`= input + id`), with the Global Constraints bounds.
- `ScenarioView = { enabled: boolean; reason: string | null; edited: boolean; vessels: { id; name; values }[]; hazards: NavHazardView[]; weatherAreas: ScenarioWeatherArea[] }`, where `values` is the current editable fields in the patch's shape.
- `withWeatherAreas(grid: WeatherGrid, areas: ScenarioWeatherArea[]): WeatherGrid`.
  - Every grid point within `radiusNm` (domain `greatCircleNm`) takes the area's four values at every step and `synthetic: true`. Later areas win.
  - An area that holds no grid point is the caller's error; the service checks this before inserting.
  - When any area is active, the weather view's `source` gains `" + scenario areas"`.
- Routes on `/api/scenario` (`requireContentType("application/json")` on POST and PATCH). Each mutation sets `world_meta.scenario_edited_at` and returns the new `ScenarioView`.
  - `GET /`
  - `PATCH /vessels/:id` writes the vessel row's fields and the latest noon report's `robMt`.
  - `POST /hazards` creates `id = synthetic:<max+1>`, `kind`/`source` `"synthetic"`, `observedAt` = clock now.
  - `DELETE /hazards/:id` deletes synthetic hazards only; anything else is a 404.
  - `POST /weather-areas` and `DELETE /weather-areas/:id`.
  - `POST /reset` does exactly what boot does with `SEED_ON_BOOT=reset` (`seedDatabase` with the configured seed and the anchor), then `ensurePinnedSources` (recorded weather, the storm, the fixture hazards). Ids restart, so the scripted stories replay again.

- [ ] **Step 1: Failing tests** (`service.test.ts`, Postgres-gated like the other DB tests).
  - `patch then plan sees it`: lowering Aegean Pioneer's VLSFO ROB to 300 mt makes the next `planRouteSpeed` read 300 mt.
  - `rejects rob over capacity`: 422 naming `robMt.VLSFO`, and the row is unchanged.
  - `rejects empty area`: a 30 nm area between grid points gives 422 "No forecast point lies inside this area; make it larger".
  - `ais ship not editable`: 404.
  - `weather area reaches the plan`: an 8 m area on Aegean Pioneer's track gives a `heavy_weather` reason or a storm cell in the next plan.
  - `reset restores the demo`: after edits, reset → `GET /` gives `edited: false`, no areas, the fixture hazards, and seed ROB values.
  - `off unless pinned and recorded`: with an unpinned clock, `GET` gives `enabled: false` and `PATCH` gives 403.
- [ ] **Step 2:** Implement the schema and migration, `withWeatherAreas`, the overlay in `latestWeatherSnapshot`, the service and routes, the config (`DEMO_CONTROLS: z.enum(["on","off"]).default("off")`), and the compose wiring. Run `npm run verify`: green. Commit `feat(api): demo scenario controls (vessels, hazards, weather areas, reset), pinned demo only`.

### Task 9: Scenario panel (Req 1, the screen)

**Files:**
- Create `apps/web/src/features/scenario/scenario-panel.tsx`, `vessel-form.tsx`, `hazard-form.tsx`, `weather-form.tsx`, `scenario-data.ts` and `scenario-panel.test.tsx`.
- Modify `apps/web/src/features/map/map-page.tsx` (the panel button, pick-on-map mode, the dashed preview circle), `route-tray.tsx` (a stale-plan flag), `apps/web/src/components/top-bar.tsx` (the "Scenario edited" `StateFlag`) and `apps/web/src/lib/queries.ts` (`queryKeys.scenario`).

**Interfaces:**
- **Consumes:** the Task 8 routes and schemas.
- **Produces:**
  - `useScenario()`, and `useScenarioMutation(kind)`, which on success invalidates `vessels`, `vessel(*)`, `voyage(*)`, `hazards`, `weather(*)`, `routePlan(*)` and `scenario`.
  - `pickOnMap: { purpose: "hazard" | "weather"; resolve(p: LatLon): void } | null` in map-page state.

- [ ] **Step 1: Failing tests** (`scenario-panel.test.tsx`, with a mocked fetch).
  - `no button when disabled`: `enabled: false` renders no Scenario button.
  - `invalid value blocks save`: min speed 15 with max 10 shows the Zod message and does not POST.
  - `pick fills lat lon`: "Pick on map", then a simulated map click at (34, 20), fills both fields.
- [ ] **Step 2:** Build the panel.
  - **Frame:** vaul `Drawer direction="right" modal={false}` scoped to the map canvas, so the map stays clickable, with shadcn `Tabs` for Vessels, Hazards and Weather.
  - **Vessels:** a `Select` of fleet vessels, then grouped number `Input`s for fuel on board, tanks, consumption, costs and stores. Zod-check on submit with the shared schema; sonner toasts on save and on error.
  - **Hazards:** the list, with delete on synthetic rows only and labels through `UntrustedText`, plus the add form.
  - **Weather:** the list of areas, and the add form (label, centre, radius, wave height and direction, wind speed and direction).
  - **Pick on map:** a crosshair cursor and a `StateFlag` "Click the map to place it" (Esc cancels), with a dashed preview circle of the radius.
  - **Reset:** shadcn `AlertDialog`: "Reset the demo world? Edits, chats, approvals and the inbox go back to the recorded demo."
  - **Panel note:** "The console recalculates from the edited world. The assistant's recorded replies cover the unedited demo only. To ask about an edited world, run `LLM_MODE=live npm run demo:reset` (paid model calls)."
  - **Stale plan:** when the scenario changed after the open plan was computed, the tray shows a `StateFlag` "Scenario changed since this plan" with a **Plan again** button. Planning stays a button press (map-page's rule for `POST /api/route-plan`).
- [ ] **Step 3:** Run the web tests: PASS. Run impeccable detect. Then, in the browser pane, edit live:
  1. Drop Aegean Pioneer's ROB, so the plan adds a bunker stop.
  2. Add a hazard on her track, so the route bends.
  3. Add an 8 m area, so storm darts and a detour appear.
  4. Reset.

  Screenshot each step. Commit `feat(web): demo scenario panel (vessels, hazards, weather areas, pick on map, reset)`.

### Task 10: Gate and merge

- [ ] **Step 1:** Run `npm run verify`: green. Run `npm run demo:reset`, then `npx playwright test` **twice**: both stories PASS with 0 replay misses. A miss means the tool output changed: stop and ask.
- [ ] **Step 2:** Update `docs/DEMO_SCRIPT.md` (an optional "change the world" beat, and the reset), `docs/USER_GUIDE.md` (the scenario panel, the timeline and its switches, waves and wind) and the change log. Refresh `docs/screenshots` with `STORY_SCREENSHOTS=docs npx playwright test` if the darts changed them.
- [ ] **Step 3:** Set the phase 11 gate in `status.json` (PASS, a one-line note with the counts). Commit `docs: phase 11 gate (demo controls and polish)`. **Ask the user** before merging `feat/demo-controls` into `build/prototype` (no push).
