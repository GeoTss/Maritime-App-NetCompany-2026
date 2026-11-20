/**
 * The voyage timeline: what the recommended plan does along its way, in time order, with a switch
 * per kind (port calls, the ECA fuel changeover, sewage discharge, danger areas and the armed team,
 * storms and notices). Every number is a fact chip from `plan.timeline.facts` (or, for a port
 * call's jobs and bunkers, from `plan.facts` by output path); the UI derives none. A port call
 * opens to show everything it does.
 */
import {
  AnchorIcon,
  CloudAngledRainZapIcon,
  DropletIcon,
  FuelStationIcon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type FuelGrade,
  type PortAction,
  type RoutePlanView,
  TIMELINE_GROUP,
  TimelineGroup,
  type VoyageEvent,
} from "@pharos/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UntrustedText } from "@/components/untrusted-text";
import { cn } from "@/lib/utils";
import { FactCell } from "./fact-cell";
import { PortCallBlock } from "./port-call-block";
import { factAtPath, type StopNames, stopPlanName } from "./route-facts";
import type { SecurityNames } from "./security-block";

export const ALL_GROUPS: TimelineGroup[] = [...TimelineGroup.options];

export const GROUP_LABEL: Record<TimelineGroup, string> = {
  port: "Port calls",
  eca: "ECA fuel changeover",
  sewage: "Sewage discharge",
  security: "Danger areas and guards",
  storms_notices: "Storms and notices",
};

export const GROUP_ICON = {
  port: AnchorIcon,
  eca: FuelStationIcon,
  sewage: DropletIcon,
  security: Shield01Icon,
  storms_notices: CloudAngledRainZapIcon,
} as const;

const ACTION_TEXT: Record<PortAction, string> = {
  bunkering: "bunkers",
  provisions: "provisions",
  charts: "charts and publications",
  sludge: "sludge ashore",
  sewage: "sewage ashore",
  clearance: "clearance",
  port_dues: "port dues",
};

const NOTICE_TEXT: Record<Extract<VoyageEvent, { kind: "notice_due" }>["notice"], string> = {
  agent_appointment: "Agent appointment due",
  security_pre_arrival: "Security pre-arrival information due",
  eu_waste_notification: "EU advance waste notification due",
};

/** "Bunkers, provisions and port dues": the call's actions as one phrase. */
export function actionsText(actions: readonly PortAction[]): string {
  const words = actions.map((a) => ACTION_TEXT[a]);
  const phrase =
    words.length <= 1
      ? (words[0] ?? "")
      : `${words.slice(0, -1).join(", ")}${words.length > 2 ? "," : ""} ${words.at(-1)}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

interface RowContext {
  plan: RoutePlanView;
  index: number;
  names?: StopNames;
  security?: SecurityNames;
}

function EventBody({ event: e, ctx }: { event: VoyageEvent; ctx: RowContext }): ReactNode {
  const { plan, index, names, security } = ctx;
  const facts = plan.timeline?.facts ?? [];
  const fact = (field: string) => factAtPath(facts, `timeline.events[${index}].${field}`);
  const port = (stopIndex: number, unlocode: string) => {
    const stop = plan.result.stopPlans[stopIndex];
    return stop ? stopPlanName(stop, names).port : unlocode;
  };
  const area = (id: string) => security?.areas.get(id) ?? id;
  switch (e.kind) {
    case "departure":
      return "Departs";
    case "port_arrival":
      return (
        <>
          Arrives at {port(e.stopIndex, e.unlocode)}
          <span className="block text-text-2">{actionsText(e.actions)}</span>
        </>
      );
    case "provisions_restock": {
      const call = `stopPlans[${e.stopIndex}].portCall`;
      return (
        <>
          Restocks provisions:{" "}
          <FactCell fact={factAtPath(plan.facts, `${call}.jobs[${e.jobIndex}].qty`)} /> person-days
          <span className="block text-text-2">
            <FactCell fact={factAtPath(plan.facts, `${call}.provisionsDaysAtEta`)} /> left at the
            destination; without it the voyage runs short of the company reserve
          </span>
        </>
      );
    }
    case "port_departure":
      return `Leaves ${port(e.stopIndex, e.unlocode)}`;
    case "arrival":
      return (
        <>
          Arrives at <UntrustedText text={plan.destination} />
          {e.provisionsDaysLeft !== null ? (
            <span className="block text-text-2">
              Provisions left: <FactCell fact={fact("provisionsDaysLeft")} />
              {e.restockNeeded ? (
                <span className="text-alarm">
                  {" "}
                  (short of the company reserve: this route needs a provisions restock on the way)
                </span>
              ) : null}
            </span>
          ) : null}
        </>
      );
    case "eca_entry":
      return e.atDeparture ? (
        "In a sulphur ECA from departure: burning LSMGO"
      ) : (
        <>
          Enters a sulphur ECA: LSMGO from here
          <span className="block text-text-2">
            Changeover starts <FactCell fact={fact("changeoverStartAt")} kind="time" />
          </span>
        </>
      );
    case "eca_exit":
      return "Leaves the sulphur ECA: back to VLSFO";
    case "sewage_window_open":
      return (
        <>
          Sewage discharge permitted for <FactCell fact={fact("windowHours")} />
          <span className="block text-text-2">
            Holding tank may go overboard: more than 12 nm from land, 4 kn or more (MARPOL IV)
          </span>
        </>
      );
    case "sewage_window_close":
      return "Sewage discharge window closes: hold sewage on board near land";
    case "danger_area_entry":
      return (
        <>
          Enters {area(e.areaId)}
          <span className="block text-text-2">
            <FactCell fact={fact("hoursInside")} /> inside,{" "}
            {e.guarded ? "armed team on board" : "no armed team"}
          </span>
        </>
      );
    case "danger_area_exit":
      return `Leaves ${area(e.areaId)}`;
    case "guards_embark":
      return "Armed team embarks";
    case "guards_disembark":
      return "Armed team disembarks";
    case "storm_passed":
      // A route can cross where a storm is only before it starts or after it ends: say which.
      if (e.timing !== "during") {
        return (
          <>
            {e.timing === "after" ? (
              <>
                Passes where a storm was: it ended{" "}
                <FactCell fact={fact("activeUntil")} kind="time" />, before the ship gets here
              </>
            ) : (
              <>
                Passes before a storm starts here, at{" "}
                <FactCell fact={fact("activeFrom")} kind="time" />
              </>
            )}
            <span className="block text-text-2">
              Its waves reach <FactCell fact={fact("maxWaveHeightM")} />{" "}
              {e.synthetic ? <DataTag kind="synthetic" className="ml-1" /> : null}
            </span>
          </>
        );
      }
      return (
        <>
          {e.clearanceNm >= 0 ? (
            <>
              Passes the storm <FactCell fact={fact("clearanceNm")} /> off its edge
            </>
          ) : (
            <span className="text-alarm">Goes through heavy weather</span>
          )}
          <span className="block text-text-2">
            Waves up to <FactCell fact={fact("maxWaveHeightM")} />
            {e.activeUntil !== null ? (
              <>
                , on until <FactCell fact={fact("activeUntil")} kind="time" />
              </>
            ) : null}{" "}
            {e.synthetic ? <DataTag kind="synthetic" className="ml-1" /> : null}
          </span>
        </>
      );
    case "notice_due":
      return (
        <>
          {NOTICE_TEXT[e.notice]}
          {e.overdue ? <span className="text-alarm"> (overdue)</span> : null}
        </>
      );
  }
}

/**
 * Brings `row` into view inside its nearest scrolling ancestor only. `scrollIntoView` would also
 * scroll the map canvas's overflow-hidden wrappers and push the whole map out of view.
 */
function scrollWithin(row: HTMLElement) {
  let box = row.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box) return;
  const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const fits = top >= box.scrollTop && top + row.offsetHeight <= box.scrollTop + box.clientHeight;
  if (!fits) box.scrollTo?.({ top: top - box.clientHeight / 3, behavior: "smooth" });
}

/**
 * The bunkering at a call: the grade and amount bought, what it costs, what the voyage needed
 * (the best route without a stop's shortfall to keep the margin), and that grade on board on
 * arrival, after bunkering and at the destination. Every number is the plan's own fact.
 */
function Bunkering({
  plan,
  stopIndex,
  grade,
}: {
  plan: RoutePlanView;
  stopIndex: number;
  grade: FuelGrade;
}) {
  const s = `stopPlans[${stopIndex}]`;
  const at = (path: string) => factAtPath(plan.facts, path);
  const kinds = plan.result.stopPlans[stopIndex]?.fuel?.breakpoints.map((b) => b.kind) ?? [];
  const robAt = (k: number) =>
    k < 0 ? undefined : at(`${s}.fuel.breakpoints[${k}].robMt.${grade}`);
  const best = plan.result.options.findIndex((o) => o.candidateId === plan.result.bestCandidateId);
  const shortfall = best < 0 ? undefined : at(`options[${best}].fuel.grades.${grade}.shortfallMt`);
  return (
    <div className="flex flex-col gap-0.5 text-text-2" data-testid="timeline-bunkers">
      <p className="text-text-1">
        {grade} bought: <FactCell fact={at(`${s}.qtyMt`)} />
      </p>
      <p>
        Fuel <FactCell fact={at(`${s}.bunkerFuelCostUsd`)} />, barge fee{" "}
        <FactCell fact={at(`${s}.bargeFeeUsd`)} />
      </p>
      {shortfall ? (
        <p>
          Needed: without a stop the best route runs <FactCell fact={shortfall} /> short of its{" "}
          {grade} margin
        </p>
      ) : null}
      <p>
        {grade} on board: <FactCell fact={robAt(kinds.indexOf("stop_arrival"))} /> on arrival,{" "}
        <FactCell fact={robAt(kinds.indexOf("stop_departure"))} /> after bunkering,{" "}
        <FactCell fact={robAt(kinds.lastIndexOf("end"))} /> at{" "}
        <UntrustedText text={plan.destination} /> (margin{" "}
        <FactCell fact={at(`${s}.fuel.grades.${grade}.marginMt`)} />)
      </p>
    </div>
  );
}

function PortCallDetails({
  plan,
  stopIndex,
  grade,
}: {
  plan: RoutePlanView;
  stopIndex: number;
  grade: FuelGrade;
}) {
  return (
    <Collapsible className="mt-1">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="-ml-2 text-beacon">
          What the call does
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-1">
        <Bunkering plan={plan} stopIndex={stopIndex} grade={grade} />
        <PortCallBlock plan={plan} index={stopIndex} destination={plan.destination} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function VoyageTimelineSection({
  plan,
  names,
  security,
  groups: groupsProp,
  onGroupsChange,
  selected = null,
  onSelect,
}: {
  plan: RoutePlanView;
  names?: StopNames;
  security?: SecurityNames;
  /** The groups shown; the section keeps its own when the page does not. */
  groups?: TimelineGroup[];
  onGroupsChange?: (groups: TimelineGroup[]) => void;
  /** The event picked on the map (its index), scrolled into view. */
  selected?: number | null;
  onSelect?: (index: number) => void;
}) {
  const [own, setOwn] = useState<TimelineGroup[]>(ALL_GROUPS);
  const groups = groupsProp ?? own;
  const setGroups = onGroupsChange ?? setOwn;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (selected === null) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    if (row) scrollWithin(row);
  }, [selected]);

  const timeline = plan.timeline;
  const facts = timeline?.facts ?? [];
  return (
    <section
      aria-label="Voyage timeline"
      className="flex min-w-0 flex-col gap-2"
      data-testid="voyage-timeline"
    >
      <h3 className="text-base font-medium text-text-1 font-title">Voyage timeline</h3>
      {!timeline || timeline.events.length === 0 ? (
        <p className="text-text-2">No timeline for this plan.</p>
      ) : (
        <>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={groups}
            onValueChange={(v) => setGroups(v as TimelineGroup[])}
            aria-label="Events shown"
            className="flex-wrap"
          >
            {ALL_GROUPS.map((g) => (
              <ToggleGroupItem key={g} value={g} className="gap-1 text-xs">
                <HugeiconsIcon icon={GROUP_ICON[g]} size={12} strokeWidth={1.75} />
                {GROUP_LABEL[g]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ol ref={list} className="flex flex-col @4xl:columns-2 @4xl:block">
            {timeline.events.map((event, index) => {
              const group = TIMELINE_GROUP[event.kind];
              if (!groups.includes(group)) return null;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the row's icon button is the keyboard path.
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: events are positional (their facts are by index)
                  key={index}
                  data-index={index}
                  data-kind={event.kind}
                  data-testid={`timeline-event-${index}`}
                  aria-current={selected === index ? "true" : undefined}
                  // A click anywhere on the row picks it (its icon is the keyboard's way); a click
                  // on something of its own inside (a fact chip, the port call) stays that one's.
                  onClick={(e) => {
                    // Only what lies inside the row counts (the tray around it is a dialog too).
                    const own = (e.target as HTMLElement).closest("button, a, [role='dialog']");
                    if (own && e.currentTarget.contains(own)) return;
                    onSelect?.(index);
                  }}
                  className={cn(
                    "flex cursor-pointer break-inside-avoid gap-2 border-b border-l-2 border-b-line border-l-transparent px-1 py-1.5 text-xs hover:bg-ink-800/60",
                    selected === index && "border-l-beacon bg-ink-800",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Show on the map: ${GROUP_LABEL[group]}`}
                    onClick={() => onSelect?.(index)}
                    className="mt-0.5 h-fit text-text-2 hover:text-beacon"
                  >
                    <HugeiconsIcon icon={GROUP_ICON[group]} size={14} strokeWidth={1.75} />
                  </button>
                  <span
                    className="w-28 shrink-0 tabular-nums text-text-2"
                    data-testid="timeline-at"
                  >
                    <FactCell
                      fact={factAtPath(facts, `timeline.events[${index}].at`)}
                      kind="time"
                    />
                  </span>
                  <div className="min-w-0 text-text-1">
                    <EventBody event={event} ctx={{ plan, index, names, security }} />
                    {event.kind === "port_arrival" ? (
                      <PortCallDetails
                        plan={plan}
                        stopIndex={event.stopIndex}
                        grade={event.bunkerGrade}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
