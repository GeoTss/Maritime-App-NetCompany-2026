/**
 * The route comparison: one row per candidate route, every number a fact chip from
 * `RoutePlanView.facts`. A number with no fact shows a dash; nothing is read from
 * `result.options` for display. The tray is a non-modal vaul drawer with snap points, scoped to
 * the map canvas, so the map stays usable behind it.
 */
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Fact, RoutePlanView } from "@pharos/shared";
import { FactChip } from "@/components/fact-chip";
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
import { formatNumber, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  baselineFact,
  fuelSavingFact,
  loadFacts,
  type OptionMetric,
  optionFact,
  reasonText,
  savingFact,
} from "./route-facts";
import { ROLE_SWATCH, ROLE_TEXT, routeRole } from "./route-style";

/** What a fact shows: its own digits, rounded for display; an ETA as a UTC time. */
function factText(fact: Fact, kind: "number" | "time"): string {
  if (kind === "time" && typeof fact.value === "string") return formatUtc(fact.value);
  if (typeof fact.value === "number") return formatNumber(fact.value, fact.unit);
  return String(fact.value);
}

/** A cited number as a chip, or a dash when the plan returned no fact for it. */
export function FactCell({
  fact,
  kind = "number",
  metric,
  className,
}: {
  fact: Fact | undefined;
  kind?: "number" | "time";
  metric?: string;
  className?: string;
}) {
  return (
    <span data-testid={metric ? `cell-${metric}` : undefined} className={className}>
      {fact ? (
        <FactChip fact={fact}>{factText(fact, kind)}</FactChip>
      ) : (
        <span className="text-text-3" title="The plan returned no fact for this number">
          —
        </span>
      )}
    </span>
  );
}

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

export function RouteComparison({ plan }: { plan: RoutePlanView }) {
  const { facts, result } = plan;
  const load = loadFacts(facts);
  const baselineSpeed = baselineFact(facts, "speedKn");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
        <div className="flex items-baseline gap-2">
          <dt className="text-text-3 font-label">Saving against the current plan</dt>
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
                  {baselineSpeed ? ` at ${factText(baselineSpeed, "number")}` : ""})
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

/** Closed (0) to open: fractions of the map canvas. */
export const TRAY_SNAPS = [0.12, 0.4, 0.88] as const;

export function RouteTray({
  plan,
  container,
  snap,
  onSnapChange,
  onClose,
}: {
  plan: RoutePlanView;
  container: HTMLElement | null;
  snap: number | string | null;
  onSnapChange: (snap: number | string | null) => void;
  onClose: () => void;
}) {
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
          <Button variant="ghost" size="icon-sm" aria-label="Close route options" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3" data-vaul-no-drag>
          <RouteComparison plan={plan} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
