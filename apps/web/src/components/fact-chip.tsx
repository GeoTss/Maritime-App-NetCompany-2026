/**
 * A cited number. The chip shows the text as written (or the fact's own value when nothing was
 * written) and opens its source: label, value and unit exactly as the API returned them, and the
 * provenance by kind. Static text only: a cited fact is never animated.
 */
import {
  Calculator01Icon,
  Database01Icon,
  FastWindIcon,
  FunctionIcon,
  Link01Icon,
  Mail01Icon,
  Radar01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { DerivedOperation, Fact, Provenance } from "@pharos/shared";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { Link } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UntrustedText } from "@/components/untrusted-text";
import { formatNumber, formatUtcFull } from "@/lib/format";
import { cn } from "@/lib/utils";

const LedgerContext = createContext<ReadonlyMap<string, Fact>>(new Map());
const DepthContext = createContext(0);

/** Nested chips stop here, so a long derivation stays readable. */
const MAX_DEPTH = 3;

/** Makes an answer's facts available to the chips inside it (derived operands resolve here). */
export function FactLedgerProvider({ facts, children }: { facts: Fact[]; children: ReactNode }) {
  const ledger = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);
  return <LedgerContext.Provider value={ledger}>{children}</LedgerContext.Provider>;
}

export const useFactLedger = () => useContext(LedgerContext);

export const PROVENANCE_KIND: Record<
  Provenance["source"],
  { title: string; icon: IconSvgElement }
> = {
  db: { title: "Database record", icon: Database01Icon },
  calculation: { title: "Calculation", icon: Calculator01Icon },
  document: { title: "Supplier email", icon: Mail01Icon },
  ais: { title: "AIS position report", icon: Radar01Icon },
  weather: { title: "Weather snapshot", icon: FastWindIcon },
  derived: { title: "Derived from other facts", icon: FunctionIcon },
};

const OPERATION: Record<DerivedOperation, string> = {
  add: "Sum of",
  subtract: "Difference of",
  multiply: "Product of",
  divide: "Ratio of",
  difference: "Difference between",
  percent_change: "Percent change from",
  sum: "Sum of",
  min: "Smallest of",
  max: "Largest of",
};

/** The fact's value for display when no text was written for it. */
export function factDisplay(fact: Fact): string {
  if (typeof fact.value === "number") return formatNumber(fact.value, fact.unit);
  if (typeof fact.value === "boolean") return fact.value ? "yes" : "no";
  return fact.unit ? `${fact.value} ${fact.unit}` : fact.value;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-3 font-label">{label}</dt>
      <dd className="min-w-0 break-words text-text-1">{children}</dd>
    </>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-2xs">{children}</span>
);

function Operands({ ids, depth }: { ids: string[]; depth: number }) {
  const ledger = useFactLedger();
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {ids.map((id, i) => {
        const operand = ledger.get(id);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: an operand id may repeat (x - x).
          <li key={`${id}-${i}`} className="flex min-h-7 items-center justify-between gap-3 py-1">
            {operand ? (
              <>
                <span className="min-w-0 text-text-2">{operand.label}</span>
                {depth < MAX_DEPTH ? (
                  <FactChip fact={operand} />
                ) : (
                  <span className="text-text-1">{factDisplay(operand)}</span>
                )}
              </>
            ) : (
              <>
                <Mono>{id}</Mono>
                <span className="text-caution">not in this answer</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ProvenanceDetail({ provenance, depth }: { provenance: Provenance; depth: number }) {
  switch (provenance.source) {
    case "db":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Row label="Table">
            <Mono>{provenance.table}</Mono>
          </Row>
          <Row label="Row">
            <Mono>{String(provenance.rowId)}</Mono>
          </Row>
          <Row label="Field">
            <Mono>{provenance.field}</Mono>
          </Row>
        </dl>
      );
    case "calculation":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Row label="Calculator">
            <Mono>{provenance.calculator}</Mono>
          </Row>
          <Row label="Run">
            <Mono>{String(provenance.calculationId)}</Mono>
          </Row>
          <Row label="Output">
            <Mono>{provenance.path}</Mono>
          </Row>
        </dl>
      );
    case "document":
      return (
        <div className="flex flex-col gap-2">
          <blockquote className="border-l border-line-strong pl-2 text-text-1">
            <UntrustedText text={provenance.evidence} />
          </blockquote>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <Row label="Field">
              <Mono>{provenance.field}</Mono>
            </Row>
            <Row label="Extraction">
              <Mono>{String(provenance.extractionId)}</Mono>
            </Row>
          </dl>
          <Link
            to={`/inbox?document=${provenance.documentId}`}
            className="w-fit text-beacon underline decoration-beacon/50 hover:decoration-beacon"
          >
            Open the email in the inbox
          </Link>
        </div>
      );
    case "ais":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Row label="MMSI">
            <Mono>{provenance.mmsi}</Mono>
          </Row>
          <Row label="Reported">
            <Mono>{formatUtcFull(provenance.ts)}</Mono>
          </Row>
        </dl>
      );
    case "weather":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Row label="Snapshot">
            <Mono>{String(provenance.snapshotId)}</Mono>
          </Row>
          <Row label="Model run">
            <Mono>{formatUtcFull(provenance.modelRun)}</Mono>
          </Row>
        </dl>
      );
    case "derived":
      return (
        <div className="flex flex-col gap-1">
          <span className="text-text-2">{OPERATION[provenance.operation]}</span>
          <Operands ids={provenance.operands} depth={depth} />
        </div>
      );
  }
}

export function FactChip({
  fact,
  children,
  iconOnly = false,
  className,
}: {
  fact: Fact;
  /** The number as the answer wrote it. Omitted, the chip shows the fact's value. */
  children?: ReactNode;
  /** A citation with no written number before it (e.g. "route B [f_…]"): a small source mark. */
  iconOnly?: boolean;
  className?: string;
}) {
  const depth = useContext(DepthContext);
  const kind = PROVENANCE_KIND[fact.provenance.source];
  const label = children ?? factDisplay(fact);

  return (
    <Popover>
      <PopoverTrigger
        data-fact-id={fact.id}
        data-slot="fact-chip"
        aria-label={iconOnly ? `Show source: ${fact.label}` : undefined}
        className={cn(
          "-mx-0.5 inline cursor-pointer rounded-sm px-0.5 whitespace-nowrap text-text-1 tabular-nums",
          "underline decoration-beacon/70 decoration-dotted decoration-1 underline-offset-[3px]",
          "transition-colors duration-150 hover:bg-beacon/12 hover:decoration-solid",
          "focus-visible:outline-1 focus-visible:outline-beacon focus-visible:outline-offset-1",
          "data-[state=open]:bg-beacon/15 data-[state=open]:decoration-solid",
          iconOnly && "inline-flex size-4 items-center justify-center align-[-2px] no-underline",
          className,
        )}
      >
        {iconOnly ? (
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3 text-beacon" />
        ) : (
          label
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 text-xs">
        <DepthContext.Provider value={depth + 1}>
          <div className="flex flex-col gap-0.5">
            <span className="text-text-2">{fact.label}</span>
            <span className="text-base text-text-1 tabular-nums">
              {String(fact.value)}
              {fact.unit ? <span className="text-text-2"> {fact.unit}</span> : null}
            </span>
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <span className="flex items-center gap-1.5 text-text-2 font-label">
              <HugeiconsIcon icon={kind.icon} strokeWidth={2} className="size-3.5" />
              {kind.title}
            </span>
            <ProvenanceDetail provenance={fact.provenance} depth={depth + 1} />
          </div>
          <span className="font-mono text-2xs text-text-3">{fact.id}</span>
        </DepthContext.Provider>
      </PopoverContent>
    </Popover>
  );
}
