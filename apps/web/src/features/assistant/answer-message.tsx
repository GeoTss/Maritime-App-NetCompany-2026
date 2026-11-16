/**
 * One released answer: its text with every cited number as a fact chip, the gate line, links to
 * the proposals it created, and for a route answer a way to see the vessel on the map.
 *
 * Markdown: the model sometimes writes bold, headings or bullets. They are shown as plain text
 * (markers stripped, bullets as "•"), never converted to HTML.
 */
import { MapsLocation01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AskResponse, Fact } from "@pharos/shared";
import { Link } from "react-router";
import { FactText } from "@/components/fact-text";
import { cn } from "@/lib/utils";
import { useVessels } from "../map/map-data";
import { ProposalLink } from "./proposal-link";

/** Plain-text view of simple Markdown. Citations (`[f_…]`) are untouched. */
export function plainText(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}

export function gateLine(
  gate: AskResponse["gate"],
  withheld: boolean,
): { text: string; tone: string } {
  if (withheld) {
    const n = gate.ungroundedCount;
    return {
      text: `Withheld: ${n} ${n === 1 ? "number" : "numbers"} had no source`,
      tone: "text-alarm",
    };
  }
  if (gate.repaired) return { text: "repaired once, all numbers sourced", tone: "text-caution" };
  return { text: "all numbers sourced", tone: "text-text-3" };
}

/** Which map selection (`vessel=` or `mmsi=`) an answer's facts point to, if any. */
function mapTarget(facts: Fact[], text: string, vessels: { id: number; name: string }[]) {
  for (const f of facts) {
    const p = f.provenance;
    if (p.source === "db" && p.table === "vessels" && typeof p.rowId === "number")
      return `vessel=${p.rowId}`;
  }
  const named = vessels.find((v) => text.includes(v.name));
  if (named) return `vessel=${named.id}`;
  for (const f of facts) {
    if (f.provenance.source === "ais") return `mmsi=${f.provenance.mmsi}`;
  }
  return null;
}

function ShowOnMap({ response }: { response: AskResponse }) {
  const vessels = useVessels();
  const target = mapTarget(response.facts, response.answer ?? "", vessels.data?.items ?? []);
  if (!target) return null;
  return (
    <div className="flex flex-col gap-1">
      <Link
        to={`/?${target}`}
        className="flex h-7 w-fit items-center gap-1.5 border border-line px-2 text-xs text-beacon hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-beacon/40 outline-none"
      >
        <HugeiconsIcon icon={MapsLocation01Icon} strokeWidth={2} className="size-3.5" />
        Show on map
      </Link>
      <p className="text-2xs text-text-3">
        Opens the vessel on the map. Press Plan route there to draw the candidates; nothing is
        planned until you do.
      </p>
    </div>
  );
}

export function AnswerMessage({
  response,
  routeAnswer,
}: {
  response: AskResponse;
  routeAnswer: boolean;
}) {
  const withheld = response.answer === null;
  const gate = gateLine(response.gate, withheld);
  return (
    <div className="flex flex-col gap-2">
      {withheld ? (
        <p className="max-w-[60ch] text-sm text-text-2">
          The answer was not shown because its numbers could not be matched to a source. Try asking
          again, or ask for one figure at a time.
        </p>
      ) : (
        <FactText
          text={plainText(response.answer ?? "")}
          facts={response.facts}
          className="max-w-[60ch] text-sm/relaxed text-text-1"
        />
      )}
      <p className={cn("text-2xs", gate.tone)} data-testid="gate-line">
        {gate.text}
      </p>
      {response.recommendationIds.map((id) => (
        <ProposalLink key={id} id={id} />
      ))}
      {routeAnswer && !withheld ? <ShowOnMap response={response} /> : null}
    </div>
  );
}
