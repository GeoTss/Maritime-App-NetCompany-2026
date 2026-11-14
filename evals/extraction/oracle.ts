/**
 * The oracle extraction: the `ExtractionOutput` a perfect transcriber gives for a golden email.
 * The as-written spans come from the case's transcription; every evidence line is copied from the
 * text the extractor actually sees (`sourceText` of the parsed email, so PDF and HTML layout are
 * whatever parseEmail produced), never from the template source.
 */
import { evidenceSupports } from "@pharos/domain";
import { ExtractionOutput } from "@pharos/shared";
import { type ExtractInput, sourceText } from "../../apps/api/src/ai/extract.js";
import type { AmountSpan, DateSpan, MoneySpan, TextSpan, Transcription } from "./case.js";

/** Candidate evidence lines in reading order: body lines, then the Subject and From lines. */
function candidateLines(doc: ExtractInput): string[] {
  const body = doc.bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return [...body, `Subject: ${doc.subject ?? ""}`, `From: ${doc.sender ?? ""}`];
}

export function buildOracle(t: Transcription, doc: ExtractInput): ExtractionOutput {
  const source = sourceText(doc);
  const lines = candidateLines(doc);
  /**
   * The first line that holds `needle` on token boundaries (the pipeline's own evidence rule) and,
   * when `near` is given, also contains that label. Throws when there is none: a template bug.
   */
  const find = (needle: string, near: string | undefined, field: string): string => {
    const hit = lines.find(
      (l) =>
        evidenceSupports(source, l, needle) &&
        (near === undefined || l.toLowerCase().includes(near.toLowerCase())),
    );
    if (hit === undefined) {
      throw new Error(`oracle: no line holds ${field} "${needle}"${near ? ` near "${near}"` : ""}`);
    }
    return hit;
  };

  if (t.kind === "not_a_quote") {
    return ExtractionOutput.parse({
      kind: "not_a_quote",
      reason: t.reason,
      evidence: find(t.evidence.value, t.evidence.near, "notAQuote"),
    });
  }

  const text = (s: TextSpan | null, field: string) =>
    s === null
      ? { value: null, evidence: null }
      : { value: s.value, evidence: find(s.value, s.near, field) };
  const date = (s: DateSpan | null, field: string) =>
    s === null
      ? { asWritten: null, evidence: null }
      : { asWritten: s.asWritten, evidence: find(s.asWritten, s.near, field) };
  const amount = (s: AmountSpan | null, field: string) =>
    s === null
      ? { value: null, unit: null, asWritten: null, evidence: null }
      : {
          value: s.value,
          unit: s.unit,
          asWritten: s.asWritten,
          evidence: find(s.asWritten, s.near, field),
        };
  const money = (s: MoneySpan | null, field: string) =>
    s === null
      ? { value: null, currency: null, perUnit: null, asWritten: null, evidence: null }
      : {
          value: s.value,
          currency: s.currency,
          perUnit: s.perUnit,
          asWritten: s.asWritten,
          evidence: find(s.asWritten, s.near, field),
        };

  return ExtractionOutput.parse({
    kind: "quote",
    supplierName: text(t.supplierName, "supplierName"),
    vesselName: text(t.vesselName, "vesselName"),
    vesselImo: text(t.vesselImo, "vesselImo"),
    port: text(t.port, "port"),
    deliveryFrom: date(t.deliveryFrom, "deliveryFrom"),
    deliveryTo: date(t.deliveryTo, "deliveryTo"),
    validUntil: date(t.validUntil, "validUntil"),
    bargeFee: money(t.bargeFee, "bargeFee"),
    lines: t.lines.map((l, i) => ({
      grade: text(l.grade, `lines.${i}.grade`),
      quantity: amount(l.quantity, `lines.${i}.quantity`),
      price: money(l.price, `lines.${i}.price`),
    })),
    notes: null,
  });
}
