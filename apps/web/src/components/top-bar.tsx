import {
  ArrowShrink02Icon,
  Maximize01Icon,
  Search01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavLink, useLocation } from "react-router";
import { SCREENS, useCommandMenu } from "@/components/command-menu";
import { StateFlag } from "@/components/primitives/state-flag";
import { SimClock } from "@/components/sim-clock";
import { DataTag, SourceBadge, SourceSummary } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useScenario } from "@/features/scenario/scenario-data";
import { useAttention } from "@/lib/attention";
import { setLayout, useLayout } from "@/lib/layout";
import { useMediaQuery } from "@/lib/motion";
import { useSourceStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** What needs the operator, per screen, counted once in `useAttention`. */
function useNeedsYou(): Record<string, number> {
  const { items } = useAttention();
  return {
    "/inbox": items.filter((i) => i.kind === "quote_review").length,
    "/approvals": items.filter((i) => i.kind === "proposal").length,
  };
}

function ScreenTabs() {
  const needs = useNeedsYou();
  return (
    <nav aria-label="Screens" className="flex h-full min-w-0 items-stretch">
      {SCREENS.map((s) => {
        const count = needs[s.path] ?? 0;
        return (
          <NavLink
            key={s.path}
            to={s.path}
            end={s.path === "/"}
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-1.5 px-2.5 text-sm whitespace-nowrap outline-none sm:px-3.5",
                "text-text-2 transition-colors duration-150 hover:text-text-1",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-beacon/50",
                isActive &&
                  "text-text-1 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-beacon",
              )
            }
          >
            {s.label}
            {count > 0 ? (
              <span
                className="inline-flex items-center gap-1 text-xs text-text-1"
                title={`${count} need${count === 1 ? "s" : ""} you`}
              >
                <StateFlag kind="K" />
                <b className="font-semibold">{count}</b>
                <span className="sr-only">need you</span>
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Sources() {
  const { data, isPending, isError } = useSourceStatus();
  if (isPending) {
    return (
      <span role="status" className="flex items-center gap-2" aria-label="Loading data sources">
        <Skeleton className="h-4 w-20" />
      </span>
    );
  }
  if (isError || !data) {
    return <span className="px-1.5 text-xs text-text-3">Source modes unavailable</span>;
  }
  // Named badges from lg; below it the dot-and-mode summary is dropped on phones (the clock and
  // the command menu stay) and shown from sm.
  return (
    <>
      <span className="hidden items-center lg:flex">
        {data.items.map((s) => (
          <SourceBadge key={s.source} status={s} />
        ))}
      </span>
      <SourceSummary items={data.items} className="hidden sm:flex lg:hidden" />
    </>
  );
}

/** The 48 px top bar: the wordmark, the four screens, what the data is, the world's clock. */
/** Says the demo world was edited, while it is (the Scenario panel; the pinned demo only). */
function ScenarioEditedTag() {
  const scenario = useScenario();
  return scenario.data?.edited ? (
    <DataTag kind="scenario-edited" className="hidden sm:inline-flex" />
  ) : null;
}

/** A panel switch in the top bar: an icon whose label says what pressing it does. */
function PanelToggle({
  icon,
  pressed,
  label,
  onClick,
}: {
  icon: typeof SidebarLeft01Icon;
  pressed: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={pressed}
          aria-label={label}
          onClick={onClick}
          className={pressed ? "text-text-1" : "text-text-3"}
        >
          <HugeiconsIcon icon={icon} strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * On the map, on a wide screen: the Needs you column's switch (as the assistant's) and focus mode,
 * which puts both columns and the map controls away at once (also F).
 */
function MapPanelToggles() {
  const onMap = useLocation().pathname === "/";
  const wide = useMediaQuery("(min-width: 768px)", true);
  const layout = useLayout();
  if (!onMap || !wide) return null;
  const needsShown = layout.needs && !layout.focus;
  return (
    <>
      <PanelToggle
        icon={SidebarLeft01Icon}
        pressed={needsShown}
        label={needsShown ? "Hide Needs you" : "Show Needs you"}
        onClick={() => setLayout({ needs: !needsShown, focus: false })}
      />
      <PanelToggle
        icon={layout.focus ? ArrowShrink02Icon : Maximize01Icon}
        pressed={layout.focus}
        label={layout.focus ? "Leave focus mode (F)" : "Focus on the map (F)"}
        onClick={() => setLayout({ focus: !layout.focus })}
      />
    </>
  );
}

export function TopBar({
  dockOpen,
  onToggleDock,
}: {
  dockOpen: boolean;
  onToggleDock: () => void;
}) {
  const { setOpen } = useCommandMenu();
  return (
    <header className="flex h-12 shrink-0 items-stretch gap-2 border-b border-line bg-ink-900 pr-1.5 pl-3 sm:gap-4">
      <span className="flex items-center text-base font-semibold tracking-[0.01em] text-text-1 font-title">
        Pharos
      </span>
      <ScreenTabs />
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <Sources />
        <ScenarioEditedTag />
        <SimClock className="hidden min-[420px]:inline-flex" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 text-text-2"
          aria-label="Open the command menu"
        >
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} data-icon="inline-start" />
          <span className="hidden lg:inline">Go to</span>
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </Button>
        <MapPanelToggles />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={dockOpen}
              aria-label={dockOpen ? "Hide the assistant" : "Show the assistant"}
              onClick={onToggleDock}
              className={dockOpen ? "text-text-1" : "text-text-3"}
            >
              <HugeiconsIcon icon={SidebarRight01Icon} strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {dockOpen ? "Hide the assistant" : "Show the assistant"}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
