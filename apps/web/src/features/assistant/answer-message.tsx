/**
 * One released answer, read as structure around the model's own words. Ruling U12: the text is
 * never rewritten, only framed.
 * - The lead paragraph, the other paragraphs, and Markdown bullets as a real list. Every cited
 *   number is a fact chip. Bold, heading and code markers are stripped; nothing becomes HTML from
 *   the text itself.
 * - For a bunker plan, the options it compared, built from the stored plan's facts.
 * - The release gate's verification line.
 * - A link that shows the answer's ship and plan on the map.
 * - A card for each proposal the answer created.
 */
import { Alert02Icon, MapsLocation01Icon, SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AskResponse } from "@pharos/shared";
import { Link } from "react-router";
import { FactText } from "@/components/fact-text";
import { cn } from "@/lib/utils";
import { useBunkerPlan } from "../map/map-data";
import { answerMapLink, answerPlan } from "./answer-plan";
import { OptionsTable } from "./options-table";
import { ProposalLink } from "./proposal-link";

/** Simple Markdown without its bold, heading and code markers. Citations (`[f_…]`) are untouched. */
export function plainText(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}

export type AnswerBlock = { kind: "text"; text: string } | { kind: "list"; items: string[] };

/** A Markdown bullet: "- ", "* " or "• " at the start of a line. */
const BULLET = /^\s*[-*•]\s+/;

/**
 * The answer as paragraphs and lists. A paragraph ends at a blank line or a list. Each list item is
 * its line after the bullet, exactly; an indented line under an item continues it.
 */
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] | null = null;
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "text", text: paragraph.join("\n") });
    paragraph = [];
  };
  const endList = () => {
    if (items !== null) blocks.push({ kind: "list", items });
    items = null;
  };
  for (const line of plainText(text).split("\n")) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      endParagraph();
      items ??= [];
      items.push(line.slice(bullet[0].length));
    } else if (line.trim() === "") {
      endParagraph();
      endList();
    } else if (items !== null && /^\s/.test(line)) {
      const last = items.length - 1;
      items[last] = `${items[last]}\n${line.trim()}`;
    } else {
      endList();
      paragraph.push(line);
    }
  }
  endParagraph();
  endList();
  return blocks;
}

function AnswerText({ response }: { response: AskResponse }) {
  const blocks = answerBlocks(response.answer ?? "");
  return (
    <div className="flex max-w-[60ch] flex-col gap-2">
      {blocks.map((block, i) => {
        const key = `${block.kind}-${i}`;
        if (block.kind === "list") {
          return (
            <ul
              key={key}
              className="flex list-disc flex-col gap-1 pl-4 text-sm/relaxed text-text-1 marker:text-text-3"
            >
              {block.items.map((item, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two bullets may read the same.
                <li key={`${key}-${j}`}>
                  <FactText text={item} facts={response.facts} />
                </li>
              ))}
            </ul>
          );
        }
        // The answer's first paragraph is its lead.
        const lead = i === 0;
        return (
          <p
            key={key}
            className={cn("text-text-1", lead ? "text-base font-medium" : "text-sm/relaxed")}
          >
            <FactText text={block.text} facts={response.facts} />
          </p>
        );
      })}
    </div>
  );
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
  if (gate.repaired) {
    return { text: "Repaired once; every number above is a tool fact.", tone: "text-text-2" };
  }
  return { text: "Every number above is a tool fact.", tone: "text-text-2" };
}

/** The options of the bunker plan the answer cited, as stored. */
function PlanOptions({ calculationId }: { calculationId: number }) {
  const plan = useBunkerPlan(calculationId);
  if (plan.data) return <OptionsTable plan={plan.data} />;
  if (plan.isError) {
    return (
      <p className="text-xs text-text-2">
        The options of bunker plan {calculationId} could not be loaded. The map shows them.
      </p>
    );
  }
  return null;
}

function ShowOnMap({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="flex h-7 w-fit items-center gap-1.5 border border-line px-2 text-xs text-beacon hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-beacon/40 outline-none"
    >
      <HugeiconsIcon icon={MapsLocation01Icon} strokeWidth={2} className="size-3.5" />
      Show on map
    </Link>
  );
}

export function AnswerMessage({ response }: { response: AskResponse }) {
  const withheld = response.answer === null;
  const gate = gateLine(response.gate, withheld);
  const plan = withheld ? null : answerPlan(response);
  const mapLink = withheld ? null : answerMapLink(response);
  return (
    <div className="flex flex-col gap-3">
      {withheld ? (
        <p className="max-w-[60ch] text-sm text-text-2">
          The answer was not shown because its numbers could not be matched to a source. Try asking
          again, or ask for one figure at a time.
        </p>
      ) : (
        <AnswerText response={response} />
      )}
      {plan?.kind === "bunker" ? <PlanOptions calculationId={plan.calculationId} /> : null}
      <p className={cn("flex items-center gap-1.5 text-xs", gate.tone)} data-testid="gate-line">
        <HugeiconsIcon
          icon={withheld ? Alert02Icon : SecurityCheckIcon}
          strokeWidth={2}
          aria-hidden
          className="size-3.5 shrink-0"
        />
        {gate.text}
      </p>
      {mapLink ? <ShowOnMap to={mapLink} /> : null}
      {response.recommendationIds.map((id) => (
        <ProposalLink key={id} id={id} />
      ))}
    </div>
  );
}
