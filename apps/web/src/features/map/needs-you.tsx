/**
 * The map's left column: everything that waits on the operator (proposals, vessel alerts, quotes
 * to review, hazards), the managed fleet's fuel on board, and the flag key. Items come from
 * `useAttention`; each action goes where the operator acts. Nothing here decides anything.
 */
import type { VesselSummary } from "@pharos/shared";
import { useState } from "react";
import { Link } from "react-router";
import { MetricNumber } from "@/components/metric-number";
import { type FlagKind, StateFlag } from "@/components/primitives/state-flag";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UntrustedText } from "@/components/untrusted-text";
import { type AttentionItem, acknowledgeHazard } from "@/lib/attention";
import { cn } from "@/lib/utils";
import { alertText } from "./vessel-panel";

const KEY: { flag: FlagKind; word: string; code: string }[] = [
  { flag: "K", word: "Needs you, awaiting a decision", code: "K · I wish to communicate with you" },
  { flag: "V", word: "Vessel alert", code: "V · I require assistance" },
  { flag: "U", word: "Hazard", code: "U · You are running into danger" },
  { flag: "C", word: "Approved", code: "C · Affirmative" },
  { flag: "N", word: "Rejected", code: "N · Negative" },
];

const FLAG_OF: Record<AttentionItem["kind"], FlagKind> = {
  proposal: "K",
  quote_review: "K",
  vessel_alert: "V",
  hazard: "U",
};

const KIND_WORD: Record<AttentionItem["kind"], string> = {
  proposal: "Awaiting your decision",
  quote_review: "Quote to review",
  vessel_alert: "Vessel alert",
  hazard: "Hazard",
};

export const bunkerQuestion = (vesselName: string) =>
  `Where should ${vesselName} bunker, and who should we buy from?`;

function ItemShell({
  item,
  tag,
  children,
}: {
  item: AttentionItem;
  tag?: string;
  children: React.ReactNode;
}) {
  const flag = FLAG_OF[item.kind];
  return (
    <li className="flex flex-col gap-1 border-b border-line px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-text-1">
        <StateFlag kind={flag} />
        <span>{KIND_WORD[item.kind]}</span>
        {tag ? <span className="ml-auto text-2xs font-normal text-text-2">{tag}</span> : null}
      </div>
      {children}
    </li>
  );
}

function Item({
  item,
  onAsk,
  onShowVessel,
  onFlyHazard,
}: {
  item: AttentionItem;
  onAsk: (question: string) => void;
  onShowVessel: (id: number) => void;
  onFlyHazard: (id: string) => void;
}) {
  switch (item.kind) {
    case "proposal":
      return (
        <ItemShell
          item={item}
          tag={item.type === "purchase_order" ? "Purchase order" : "Voyage instruction"}
        >
          <p className="text-sm text-text-1">{item.summary}</p>
          <div className="pt-1">
            <Button asChild size="sm" variant="outline">
              <Link to={`/approvals?recommendation=${item.recommendationId}`}>
                Open in Approvals
              </Link>
            </Button>
          </div>
        </ItemShell>
      );
    case "vessel_alert":
      return (
        <ItemShell item={item}>
          <h3 className="text-sm font-medium text-text-1">{item.vesselName}</h3>
          <p className="text-xs/relaxed text-text-2">{alertText(item.alert)}.</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAsk(bunkerQuestion(item.vesselName))}
            >
              Ask where to bunker
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onShowVessel(item.vesselId)}>
              Show on map
            </Button>
          </div>
        </ItemShell>
      );
    case "quote_review":
      return (
        <ItemShell item={item}>
          <h3 className="text-sm font-medium text-text-1">
            <UntrustedText text={item.subject} className="line-clamp-2" />
          </h3>
          <p className="text-xs text-text-2">
            From <UntrustedText text={item.sender} />
          </p>
          <div className="pt-1">
            <Button asChild size="sm" variant="outline">
              <Link to={`/inbox?document=${item.documentId}`}>Review in Inbox</Link>
            </Button>
          </div>
        </ItemShell>
      );
    case "hazard":
      return (
        <ItemShell item={item} tag={item.synthetic ? "synthetic" : undefined}>
          <h3 className="text-sm font-medium text-text-1">
            <UntrustedText text={item.label} className="line-clamp-2" />
          </h3>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="outline" onClick={() => onFlyHazard(item.hazardId)}>
              Show on map
            </Button>
            <Button size="sm" variant="ghost" onClick={() => acknowledgeHazard(item.hazardId)}>
              Dismiss
            </Button>
          </div>
        </ItemShell>
      );
  }
}

function FleetTable({
  vessels,
  selectedId,
  onShowVessel,
}: {
  vessels: readonly VesselSummary[];
  selectedId: number | null;
  onShowVessel: (id: number) => void;
}) {
  if (vessels.length === 0) return null;
  return (
    <section aria-label="Managed fleet" className="border-b border-line px-3 py-3">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-xs font-medium text-text-2">Fuel on board</h3>
        <DataTag kind="simulated" className="ml-auto" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-6 px-1 text-2xs">Vessel</TableHead>
            <TableHead className="h-6 px-1 text-right text-2xs">LSMGO</TableHead>
            <TableHead className="h-6 px-1 text-right text-2xs">VLSFO</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vessels.map((v) => {
            const alerted = v.alerts.length > 0;
            return (
              <TableRow
                key={v.id}
                data-alerted={alerted ? "" : undefined}
                aria-selected={selectedId === v.id}
                className={cn(alerted && "bg-caution/10", selectedId === v.id && "bg-ink-800")}
              >
                <TableCell className="px-1 py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => onShowVessel(v.id)}
                    className="flex items-center gap-1.5 text-left text-text-1 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-beacon/50"
                  >
                    {alerted ? <StateFlag kind="V" /> : null}
                    <UntrustedText text={v.name} />
                    {alerted ? <span className="sr-only">, vessel alert</span> : null}
                  </button>
                </TableCell>
                <TableCell className="px-1 py-1 text-right text-xs">
                  <MetricNumber value={v.robMt.LSMGO} unit="mt" />
                </TableCell>
                <TableCell className="px-1 py-1 text-right text-xs">
                  <MetricNumber value={v.robMt.VLSFO} unit="mt" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/** The legend of the state flags, closed until asked for: it explains, it does not need the room. */
export function FlagKey() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mt-auto border-t border-line bg-ink-950 px-3 py-2"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between px-0 text-2xs font-medium text-text-2 hover:bg-transparent"
        >
          Flag key · International Code of Signals
          <span className="text-text-3">{open ? "Hide" : "Show"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="grid gap-2 pt-1 pb-1">
          {KEY.map((k) => (
            <li key={k.flag} className="grid grid-cols-[16px_1fr] gap-x-2 text-xs/4">
              <StateFlag kind={k.flag} className="mt-0.5" />
              <span className="text-text-1">{k.word}</span>
              <span className="col-start-2 text-2xs text-text-2">{k.code}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NeedsYou({
  items,
  isPending,
  vessels,
  selectedVesselId,
  onAsk,
  onShowVessel,
  onFlyHazard,
}: {
  items: AttentionItem[];
  isPending: boolean;
  vessels: readonly VesselSummary[];
  selectedVesselId: number | null;
  onAsk: (question: string) => void;
  onShowVessel: (id: number) => void;
  onFlyHazard: (id: string) => void;
}) {
  return (
    <section aria-label="Needs you" className="flex h-full min-h-0 flex-col bg-ink-900">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="text-base font-medium text-text-1">Needs you</h2>
        <span className="inline-flex items-center gap-1 text-xs text-text-1">
          <StateFlag kind="K" />
          <b className="font-semibold" data-testid="needs-count">
            {items.length}
          </b>
          <span className="sr-only">{items.length === 1 ? "item needs" : "items need"} you</span>
        </span>
        <DataTag kind="simulated" className="ml-auto" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-2">
            {isPending ? "Checking what needs you…" : "Nothing needs you right now."}
          </p>
        ) : (
          <ul>
            {items.map((item) => (
              <Item
                key={
                  item.kind === "proposal"
                    ? `p${item.recommendationId}`
                    : item.kind === "vessel_alert"
                      ? `v${item.vesselId}-${item.alert}`
                      : item.kind === "quote_review"
                        ? `q${item.documentId}`
                        : `h${item.hazardId}`
                }
                item={item}
                onAsk={onAsk}
                onShowVessel={onShowVessel}
                onFlyHazard={onFlyHazard}
              />
            ))}
          </ul>
        )}
        <FleetTable vessels={vessels} selectedId={selectedVesselId} onShowVessel={onShowVessel} />
        <FlagKey />
      </div>
    </section>
  );
}
