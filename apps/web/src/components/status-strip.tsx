import { Search01Icon, SidebarRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCommandMenu } from "@/components/command-menu";
import { SimClock } from "@/components/sim-clock";
import { SourceBadge, SourceSummary } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSourceStatus } from "@/lib/queries";

function Sources() {
  const { data, isPending, isError } = useSourceStatus();
  if (isPending) {
    return (
      <span role="status" className="flex items-center gap-2" aria-label="Loading data sources">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="hidden h-4 w-24 md:block" />
      </span>
    );
  }
  if (isError || !data) {
    return <span className="px-1.5 text-xs text-text-3">Source modes unavailable</span>;
  }
  // Each source keeps its mode on screen at every width: named badges from md, the dot-and-mode
  // summary below it.
  return (
    <>
      <span className="hidden items-center md:flex">
        {data.items.map((s) => (
          <SourceBadge key={s.source} status={s} />
        ))}
      </span>
      <SourceSummary items={data.items} className="md:hidden" />
    </>
  );
}

/** The 36 px strip: where you are, what the data is, what time the world thinks it is. */
export function StatusStrip({
  dockOpen,
  onToggleDock,
}: {
  dockOpen: boolean;
  onToggleDock: () => void;
}) {
  const { setOpen } = useCommandMenu();
  return (
    <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-ink-900 pr-1.5 pl-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-sm font-semibold tracking-[0.01em] text-text-1 font-title">
          Pharos
        </span>
        <span className="hidden truncate text-xs text-text-3 sm:inline">bunker-to-berth desk</span>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <div className="flex items-center">
          <Sources />
        </div>
        <Separator orientation="vertical" className="my-2.5" />
        <SimClock />
        <Separator orientation="vertical" className="my-2.5" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 text-text-2"
          aria-label="Open the command menu"
        >
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} data-icon="inline-start" />
          <span className="hidden lg:inline">Go to</span>
          <Kbd>⌘K</Kbd>
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
