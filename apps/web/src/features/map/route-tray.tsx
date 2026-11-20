/**
 * The route comparison: one row per candidate route, every number a fact chip from
 * `RoutePlanView.facts`. A number with no fact shows a dash; nothing is read from
 * `result.options` for display. The tray is a non-modal vaul drawer with snap points, scoped to
 * the map canvas, so the map stays usable behind it.
 *
 * For a fleet vessel (the plan knows the fuel on board) the tray leads with both answers: the
 * recommended plan (route, bunker stop and quote) and the best route ignoring fuel on board, with
 * where it runs short, then the fuel on board along both, then every route compared.
 */
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RoutePlanView, TimelineGroup } from "@pharos/shared";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UntrustedText } from "@/components/untrusted-text";
import { cn } from "@/lib/utils";
import { FactCell, factText } from "./fact-cell";
import { FuelCurve } from "./fuel-curve";
import { FuelBlindBest, PlanSummary } from "./plan-summary";
import {
  baselineFact,
  fuelSavingFact,
  knowsFuel,
  loadFacts,
  type OptionMetric,
  optionFact,
  reasonText,
  type StopNames,
  savingFact,
} from "./route-facts";
import { ROLE_SWATCH, ROLE_TEXT, routeRole } from "./route-style";
import { SecurityBlock, type SecurityNames, SuezOrCape } from "./security-block";
import { VoyageTimelineSection } from "./voyage-timeline";

export { FactCell } from "./fact-cell";

const COLUMNS: { metric: OptionMetric; label: string; kind?: "time" }[] = [
  { metric: "distanceNm", label: "Distance" },
  { metric: "speedKn", label: "Speed" },
  { metric: "eta", label: "ETA", kind: "time" },
  { metric: "totalFuelMt", label: "Fuel" },
  { metric: "co2T", label: "CO₂" },
  { metric: "etsCostUsd", label: "EU ETS" },
  { metric: "fuelEuCostUsd", label: "FuelEU" },
  { metric: "totalCostUsd", label: "Total" },
];

const numeric = "text-right tabular-nums whitespace-nowrap";

/** The page's timeline controls, shared with the map's pins. */
export interface TimelineControls {
  groups: TimelineGroup[];
  onGroupsChange: (groups: TimelineGroup[]) => void;
  selected: number | null;
  onSelect: (index: number) => void;
}

export function RouteComparison({
  plan,
  names,
  security,
  timeline,
}: {
  plan: RoutePlanView;
  names?: StopNames;
  security?: SecurityNames;
  timeline?: TimelineControls;
}) {
  const { facts, result } = plan;
  const load = loadFacts(facts);
  const baselineSpeed = baselineFact(facts, "speedKn");
  const fuelAware = knowsFuel(plan);
  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      {fuelAware ? (
        <div className="grid gap-x-6 gap-y-4 border-b border-line pb-4 @4xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <PlanSummary plan={plan} names={names} />
            <FuelBlindBest plan={plan} />
          </div>
          <FuelCurve plan={plan} />
        </div>
      ) : null}
      {plan.timeline !== undefined ? (
        <div className="border-b border-line pb-4">
          <VoyageTimelineSection
            plan={plan}
            names={names}
            security={security}
            groups={timeline?.groups}
            onGroupsChange={timeline?.onGroupsChange}
            selected={timeline?.selected}
            onSelect={timeline?.onSelect}
          />
        </div>
      ) : null}
      {fuelAware ? (
        <h3 className="text-base font-medium text-text-1 font-title">
          Every route, without a stop
        </h3>
      ) : null}
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
        <div className="flex items-baseline gap-2">
          <dt className="text-text-3 font-label">
            {fuelAware
              ? "Saving of the best route ignoring fuel, against the current plan"
              : "Saving against the current plan"}
          </dt>
          <dd data-testid="plan-saving">
            <FactCell fact={savingFact(facts)} />
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-text-3 font-label">Fuel saved</dt>
          <dd>
            <FactCell fact={fuelSavingFact(facts)} />
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="plan-load">
          <div className="flex items-baseline gap-2">
            <dt className="text-text-3 font-label">Displacement</dt>
            <dd>
              <FactCell fact={load.displacement} />
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-text-3 font-label">Load factor</dt>
            <dd>
              <FactCell fact={load.loadFactor} />
            </dd>
          </div>
        </div>
      </dl>
      <SuezOrCape plan={plan} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-44">Route</TableHead>
            {COLUMNS.map((c) => (
              <TableHead key={c.metric} className={numeric}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.options.map((option, index) => {
            const candidate = plan.candidates.find((c) => c.id === option.candidateId);
            const role = routeRole(plan, index);
            return (
              <TableRow
                key={option.candidateId}
                data-testid={`route-row-${option.candidateId}`}
                data-feasible={option.feasible}
                data-role={role}
                className="align-top"
              >
                <TableCell className="whitespace-normal">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn("inline-block w-5 shrink-0", ROLE_SWATCH[role])}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        role === "infeasible" ? "text-text-3 line-through" : "text-text-1",
                      )}
                    >
                      Route {option.candidateId}
                    </span>
                    <span
                      className={cn(
                        "text-2xs",
                        role === "recommended" && "text-beacon",
                        role === "infeasible" && "text-alarm",
                        (role === "planned" || role === "other") && "text-text-2",
                      )}
                    >
                      {ROLE_TEXT[role]}
                    </span>
                  </div>
                  <div className="pl-7 text-text-2">{candidate?.label ?? "—"}</div>
                  {fuelAware && option.candidateId === result.bestCandidateId ? (
                    <div className="pl-7 text-2xs text-text-2" data-testid="fuel-blind-best">
                      Best route ignoring fuel on board
                    </div>
                  ) : null}
                  <SecurityBlock plan={plan} index={index} names={security} />
                  {option.feasible && option.meetsArriveBy ? (
                    <div className="pl-7 text-2xs text-text-2" data-testid="meets-window">
                      Meets the berth window
                    </div>
                  ) : null}
                  {option.feasible ? null : (
                    <ul className="pl-7 text-alarm">
                      {option.reasons.map((reason) => (
                        <li key={reason}>{reasonText(reason)}</li>
                      ))}
                      {option.hazardIds.length > 0 ? (
                        <li className="text-text-2">
                          Hazard{option.hazardIds.length === 1 ? "" : "s"}:{" "}
                          {option.hazardIds.map((id, i) => (
                            <span key={id}>
                              {i > 0 ? ", " : ""}
                              <span className="font-mono text-2xs">{id}</span>
                            </span>
                          ))}
                        </li>
                      ) : null}
                    </ul>
                  )}
                </TableCell>
                {COLUMNS.map((c) => (
                  <TableCell key={c.metric} className={numeric}>
                    <FactCell
                      fact={optionFact(facts, index, c.metric)}
                      kind={c.kind}
                      metric={c.metric}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          <TableRow data-testid="route-row-baseline" className="text-text-2">
            <TableCell>
              <div className="flex items-center gap-2 pl-0">
                <span className="font-medium">
                  Current plan (route {result.baseline.candidateId}
                  {baselineSpeed ? ` at ${factText(baselineSpeed)}` : ""})
                </span>
              </div>
            </TableCell>
            {COLUMNS.map((c) => (
              <TableCell key={c.metric} className={numeric}>
                <FactCell
                  fact={baselineFact(facts, c.metric)}
                  kind={c.kind}
                  metric={`baseline-${c.metric}`}
                />
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/** The drawer's drag handle above the body: `mt-4` + `h-1` in `components/ui/drawer.tsx`. */
const HANDLE_REM = 1.25;

/** Closed (0) to open: fractions of the map canvas. */
export const TRAY_SNAPS = [0.12, 0.5, 0.88] as const;

/** The snap the tray is at, as an index into `TRAY_SNAPS` (the middle one when unknown). */
const snapIndex = (snap: number | string | null) => {
  const index = TRAY_SNAPS.findIndex((s) => s === snap);
  return index === -1 ? 1 : index;
};

/**
 * vaul does not hand `modal={false}` to the Radix dialog under it, so the dialog still marks every
 * other part of the page `aria-hidden`. The tray leaves the map, panels and dock usable, so they
 * must stay in the accessibility tree: undo the marking once the dialog has mounted.
 */
function unhideRestOfPage() {
  const unhide = () => {
    for (const el of document.querySelectorAll("[data-aria-hidden]")) {
      el.removeAttribute("aria-hidden");
      el.removeAttribute("data-aria-hidden");
    }
  };
  unhide();
  const frame = requestAnimationFrame(unhide);
  return () => cancelAnimationFrame(frame);
}

export function RouteTray({
  plan,
  names,
  security,
  container,
  snap,
  onSnapChange,
  onClose,
  timeline,
  stale = null,
}: {
  plan: RoutePlanView;
  timeline?: TimelineControls;
  /** The demo scenario changed after this plan was made: say so, and offer to plan again. */
  stale?: { onReplan: (() => void) | null } | null;
  /** Supplier and port of each stop plan's quote, by quote id (`GET /api/quotes`). */
  names?: StopNames;
  /** Each security quote's team and each danger area's name (Track 3). */
  security?: SecurityNames;
  container: HTMLElement | null;
  snap: number | string | null;
  onSnapChange: (snap: number | string | null) => void;
  onClose: () => void;
}) {
  useEffect(unhideRestOfPage, []);
  // The tray can be dragged, but never has to be: Taller and Shorter step through the same snaps.
  const at = snapIndex(snap);
  const visible = typeof snap === "number" ? snap : TRAY_SNAPS[1];
  const step = (by: 1 | -1) => onSnapChange(TRAY_SNAPS[at + by] ?? TRAY_SNAPS[at] ?? null);
  return (
    <Drawer
      open
      modal={false}
      dismissible={false}
      container={container}
      snapPoints={[...TRAY_SNAPS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={onSnapChange}
    >
      <DrawerContent
        container={container}
        overlay={false}
        aria-describedby="route-tray-description"
        className="absolute! inset-x-0 bottom-0 mt-0! h-full max-h-none! p-0 before:inset-0 before:rounded-none before:border-x-0 before:border-b-0"
      >
        {/* vaul slides the full-height drawer down by (1 - snap): the body takes only the visible
            part below the handle, so its scroll area ends at the canvas edge, not below it. */}
        <div
          data-testid="route-tray-body"
          className="flex min-h-0 flex-col"
          style={{ height: `calc(${visible * 100}% - ${HANDLE_REM}rem)` }}
        >
          <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3 pt-0">
            <DrawerTitle className="min-w-0 truncate text-sm font-medium font-title">
              Route options: <UntrustedText text={plan.subject} /> to{" "}
              <UntrustedText text={plan.destination} />
            </DrawerTitle>
            <DrawerDescription
              id="route-tray-description"
              className="ml-auto hidden text-2xs sm:block"
            >
              Calculation #{plan.calculationId}
              {plan.weatherSnapshotId === null
                ? ", no weather forecast"
                : `, weather snapshot #${plan.weatherSnapshotId}`}
            </DrawerDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Make route options shorter"
              disabled={at === 0}
              onClick={() => step(-1)}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Make route options taller"
              disabled={at === TRAY_SNAPS.length - 1}
              onClick={() => step(1)}
            >
              <HugeiconsIcon icon={ArrowUp01Icon} size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close route options"
              onClick={onClose}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </Button>
          </div>
          {stale ? (
            <div
              role="status"
              className="flex shrink-0 items-center gap-2 border-b border-line bg-ink-900 px-3 py-1.5 text-xs text-caution"
            >
              The demo scenario changed since this plan was made.
              {stale.onReplan ? (
                <Button size="xs" variant="outline" className="ml-auto" onClick={stale.onReplan}>
                  Plan again
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto p-3" data-vaul-no-drag>
            <RouteComparison plan={plan} names={names} security={security} timeline={timeline} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
