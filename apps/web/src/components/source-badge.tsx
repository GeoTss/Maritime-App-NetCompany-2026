/**
 * Honesty signals. `SourceBadge`: whether a data source is live or recorded (go = live, caution =
 * recorded). `DataTag`: what kind of data a panel shows, in words: simulated company data, the
 * synthetic demo hazard, an unverified ad-hoc result, a dev-split score, a draft never sent.
 */
import type { SourceStatusView } from "@pharos/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUtc } from "@/lib/format";
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
        <span className="text-text-2">Updated {formatUtc(status.updatedAt)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The phone form of the source badges, where the strip has room for one: a dot and the mode word
 * per distinct mode ("recorded", or "live" and "recorded" when they differ). It names every
 * source and its mode to assistive technology and in its tooltip, so no source's mode is hidden.
 */
export function SourceSummary({
  items,
  className,
}: {
  items: SourceStatusView[];
  className?: string;
}) {
  const modes = [...new Set(items.map((s) => s.mode))].sort();
  const spoken = items.map((s) => `${SOURCE_NAME[s.source]} ${s.mode}`).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip names each source on focus.
          tabIndex={0}
          role="img"
          aria-label={`Data sources: ${spoken}`}
          data-source-summary={modes.join(" ")}
          className={cn(
            "inline-flex h-6 items-center gap-2 rounded-sm px-1.5 text-xs outline-none",
            "focus-visible:ring-2 focus-visible:ring-beacon/40",
            className,
          )}
        >
          {modes.map((mode) => (
            <span key={mode} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  mode === "live" ? "bg-go" : "bg-caution",
                )}
              />
              <span className={mode === "live" ? "text-go" : "text-caution"}>{mode}</span>
            </span>
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
        {items.map((s) => (
          <span key={s.source}>
            {SOURCE_NAME[s.source]}: {MODE_EXPLAINED[s.mode]}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export type DataKind =
  | "simulated"
  | "synthetic"
  | "unverified"
  | "dev-split"
  | "heldout-split"
  | "draft"
  | "sample"
  | "live-run"
  | "model-recorded"
  | "model-live";

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
    title: "Measured on the development half of the golden set, used for iteration.",
    tone: "border-line-strong text-text-2",
  },
  "heldout-split": {
    text: "held-out, run once",
    title:
      "Measured once on the half of the golden set kept out of development; never tuned toward.",
    tone: "border-line-strong text-text-1",
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
  "live-run": {
    text: "live run",
    title: "Measured with live model calls, not replayed from recordings.",
    tone: "border-line-strong text-text-2",
  },
  "model-recorded": {
    text: "model: recorded",
    title:
      "Answers are replayed from recordings of earlier model calls, so the demo runs offline. Only questions that were recorded have answers.",
    tone: "border-caution/50 text-caution",
  },
  "model-live": {
    text: "model: live",
    title: "Each question is answered by a live model call.",
    tone: "border-go/50 text-go",
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
