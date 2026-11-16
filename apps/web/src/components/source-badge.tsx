/**
 * Honesty signals. `SourceBadge`: whether a data source is live or recorded (go = live, caution =
 * recorded). `DataTag`: what kind of data a panel shows, in words: simulated company data, the
 * synthetic demo hazard, an unverified ad-hoc result, a dev-split score, a draft never sent.
 */
import type { SourceStatusView } from "@pharos/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUtcFull } from "@/lib/format";
import { cn } from "@/lib/utils";

const SOURCE_NAME: Record<SourceStatusView["source"], string> = { ais: "AIS", weather: "Weather" };

const MODE_EXPLAINED: Record<SourceStatusView["mode"], string> = {
  live: "Live: read from the provider as it arrives.",
  recorded: "Recorded: replayed from a capture stored with the app, so the demo runs offline.",
};

export function SourceBadge({
  status,
  className,
}: {
  status: SourceStatusView;
  className?: string;
}) {
  const live = status.mode === "live";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip explains the mode on focus.
          tabIndex={0}
          data-source-mode={status.mode}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-sm px-1.5 text-xs outline-none",
            "focus-visible:ring-2 focus-visible:ring-beacon/40",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-go" : "bg-caution")}
          />
          <span className="text-text-2">{SOURCE_NAME[status.source]}</span>{" "}
          <span className={live ? "text-go" : "text-caution"}>{status.mode}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
        <span>{MODE_EXPLAINED[status.mode]}</span>
        {status.detail ? (
          <span className="font-mono text-2xs text-text-2">{status.detail}</span>
        ) : null}
        <span className="text-text-2">Updated {formatUtcFull(status.updatedAt)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export type DataKind = "simulated" | "synthetic" | "unverified" | "dev-split" | "draft" | "sample";

const TAG: Record<DataKind, { text: string; title: string; tone: string }> = {
  simulated: {
    text: "simulated data",
    title: "Fleet, quotes and orders are generated for the demo; no real company's data.",
    tone: "border-line-strong text-text-2",
  },
  synthetic: {
    text: "synthetic",
    title: "Made up for the demo, not reported by any ship or authority.",
    tone: "border-chart-magenta/50 text-chart-magenta",
  },
  unverified: {
    text: "unverified",
    title: "An ad-hoc result no calculator or reviewer has checked.",
    tone: "border-caution/50 text-caution",
  },
  "dev-split": {
    text: "dev split",
    title: "Measured on the development half of the golden set; the held-out half is pending.",
    tone: "border-line-strong text-text-2",
  },
  draft: {
    text: "draft, not sent",
    title: "Drafted for a person to send. Pharos never sends anything.",
    tone: "border-line-strong text-text-2",
  },
  sample: {
    text: "kit sample",
    title: "Example values for the design kit, not data from the API.",
    tone: "border-line-strong text-text-3",
  },
};

export function DataTag({ kind, className }: { kind: DataKind; className?: string }) {
  const tag = TAG[kind];
  return (
    <span
      title={tag.title}
      data-kind={kind}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-2xs whitespace-nowrap",
        tag.tone,
        className,
      )}
    >
      {tag.text}
    </span>
  );
}
