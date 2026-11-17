import { Search01Icon, SidebarRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InboxItem, listOf, RecommendationView } from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router";
import { SCREENS, useCommandMenu } from "@/components/command-menu";
import { StateFlag } from "@/components/primitives/state-flag";
import { SimClock } from "@/components/sim-clock";
import { SourceBadge, SourceSummary } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { queryKeys, useSourceStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const InboxItems = listOf(InboxItem);
const Recommendations = listOf(RecommendationView);

/**
 * What needs the operator, per screen. Read from the same lists the Inbox and Approvals screens
 * read (same query keys, so one request serves both); a failed read shows no badge.
 */
function useNeedsYou(): Record<string, number> {
  const inbox = useQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ signal }) => api.get("/api/inbox", InboxItems, { signal }),
    retry: false,
  });
  const recs = useQuery({
    queryKey: queryKeys.recommendations,
    queryFn: ({ signal }) => api.get("/api/recommendations", Recommendations, { signal }),
    retry: false,
  });
  return {
    "/inbox": inbox.data?.items.filter((i) => i.extractionStatus === "needs_review").length ?? 0,
    "/approvals": recs.data?.items.filter((r) => r.status === "pending").length ?? 0,
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
