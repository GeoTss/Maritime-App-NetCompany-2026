import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ExtractionOutput, QuoteExtraction, SecurityQuoteExtraction } from "@pharos/shared";
import { useState } from "react";
import { UntrustedText } from "@/components/untrusted-text";
import { cn } from "@/lib/utils";
import { locateEvidence } from "./evidence-text";

export interface FieldRow {
  key: string;
  label: string;
  /** The value as the supplier wrote it. */
  written: string | null;
  evidence: string | null;
}

const joinParts = (...parts: (string | number | null | undefined)[]) =>
  parts.filter((p) => p !== null && p !== undefined && p !== "").join(" ") || null;

/** A security quote's fields in reading order, each with its evidence sentence. Display only. */
export function securityFieldRows(q: SecurityQuoteExtraction): FieldRow[] {
  const money = (f: SecurityQuoteExtraction["dayRate"]) =>
    f.asWritten ?? joinParts(f.currency, f.value);
  const qty = (f: SecurityQuoteExtraction["teamSize"]) => f.asWritten ?? joinParts(f.value, f.unit);
  return [
    {
      key: "provider",
      label: "Security provider",
      written: q.providerName.value,
      evidence: q.providerName.evidence,
    },
    {
      key: "vessel",
      label: "Vessel",
      written: q.vesselName.value,
      evidence: q.vesselName.evidence,
    },
    { key: "imo", label: "Vessel IMO", written: q.vesselImo.value, evidence: q.vesselImo.evidence },
    {
      key: "embark",
      label: "Team boards at",
      written: q.embarkPort.value,
      evidence: q.embarkPort.evidence,
    },
    {
      key: "disembark",
      label: "Team leaves at",
      written: q.disembarkPort.value,
      evidence: q.disembarkPort.evidence,
    },
    { key: "team", label: "Team size", written: qty(q.teamSize), evidence: q.teamSize.evidence },
    { key: "rate", label: "Day rate", written: money(q.dayRate), evidence: q.dayRate.evidence },
    {
      key: "fees",
      label: "Fixed fees",
      written: money(q.fixedFees),
      evidence: q.fixedFees.evidence,
    },
    { key: "days", label: "Minimum days", written: qty(q.minDays), evidence: q.minDays.evidence },
    {
      key: "valid",
      label: "Valid until",
      written: q.validUntil.asWritten,
      evidence: q.validUntil.evidence,
    },
  ];
}

/** The quote's fields in reading order, each with its evidence sentence. Display only. */
export function fieldRows(q: QuoteExtraction): FieldRow[] {
  const rows: FieldRow[] = [
    {
      key: "supplier",
      label: "Supplier",
      written: q.supplierName.value,
      evidence: q.supplierName.evidence,
    },
    {
      key: "vessel",
      label: "Vessel",
      written: q.vesselName.value,
      evidence: q.vesselName.evidence,
    },
    { key: "imo", label: "Vessel IMO", written: q.vesselImo.value, evidence: q.vesselImo.evidence },
    { key: "port", label: "Port", written: q.port.value, evidence: q.port.evidence },
    {
      key: "from",
      label: "Delivery from",
      written: q.deliveryFrom.asWritten,
      evidence: q.deliveryFrom.evidence,
    },
    {
      key: "to",
      label: "Delivery to",
      written: q.deliveryTo.asWritten,
      evidence: q.deliveryTo.evidence,
    },
    {
      key: "valid",
      label: "Valid until",
      written: q.validUntil.asWritten,
      evidence: q.validUntil.evidence,
    },
    {
      key: "barge",
      label: "Barge fee",
      written: q.bargeFee.asWritten ?? joinParts(q.bargeFee.currency, q.bargeFee.value),
      evidence: q.bargeFee.evidence,
    },
  ];
  q.lines.forEach((line, i) => {
    const n = q.lines.length > 1 ? ` ${i + 1}` : "";
    rows.push(
      {
        key: `line${i}-grade`,
        label: `Grade${n}`,
        written: line.grade.value,
        evidence: line.grade.evidence,
      },
      {
        key: `line${i}-qty`,
        label: `Quantity${n}`,
        written: line.quantity.asWritten ?? joinParts(line.quantity.value, line.quantity.unit),
        evidence: line.quantity.evidence,
      },
      {
        key: `line${i}-price`,
        label: `Price${n}`,
        written:
          line.price.asWritten ??
          joinParts(
            line.price.currency,
            line.price.value,
            line.price.perUnit && `/${line.price.perUnit}`,
          ),
        evidence: line.price.evidence,
      },
    );
  });
  return rows;
}

/**
 * The structured quote, on the right. Hovering or focusing a row hands its evidence sentence to
 * the source view. A value whose evidence cannot be found in the source is flagged on the row.
 */
export function ExtractionPanel({
  extraction,
  bodyText,
  onEvidence,
}: {
  extraction: ExtractionOutput;
  bodyText: string;
  onEvidence: (evidence: string | null) => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  if (extraction.kind === "not_a_quote") {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 text-xs">
        <p className="font-medium text-text-1">Not a quote</p>
        <p className="text-text-2">
          <UntrustedText text={extraction.reason} />
        </p>
      </div>
    );
  }

  const rows =
    extraction.kind === "security_quote" ? securityFieldRows(extraction) : fieldRows(extraction);
  const show = (row: FieldRow | null) => {
    setActive(row?.key ?? null);
    onEvidence(row?.evidence ?? null);
  };

  return (
    <ul aria-label="Extracted quote" className="divide-y divide-line">
      {rows.map((row) => {
        const found = row.evidence ? locateEvidence(bodyText, row.evidence) !== null : null;
        return (
          <li key={row.key}>
            <button
              type="button"
              data-field={row.key}
              data-active={active === row.key}
              aria-label={`${row.label}: ${row.written ?? "not stated"}`}
              onMouseEnter={() => show(row)}
              onMouseLeave={() => show(null)}
              onFocus={() => show(row)}
              onBlur={() => show(null)}
              className={cn(
                "grid w-full grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1 text-left text-xs outline-none",
                "hover:bg-ink-850 focus-visible:bg-ink-850 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                active === row.key && "bg-ink-850",
              )}
            >
              <span className="font-label text-text-2">{row.label}</span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-text-1">
                <UntrustedText text={row.written} fallback="not stated" />
                {found === false ? (
                  <span
                    data-testid="evidence-missing"
                    className="inline-flex items-center gap-1 text-2xs text-caution"
                  >
                    <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-2.5" />
                    Evidence not found in the email text
                  </span>
                ) : null}
                {row.evidence === null && row.written !== null ? (
                  <span className="text-2xs text-text-3">no source sentence</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
