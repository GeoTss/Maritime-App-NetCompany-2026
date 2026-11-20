/**
 * Example values for the design kit only. They are shaped like API responses so the kit renders
 * the real components, and the page labels them "kit sample". Nothing here is computed.
 */
import type { Fact, SourceStatusView } from "@pharos/shared";
import type { ToolCall } from "@/components/primitives/tool-chips";

export const SAMPLE_FACTS: Fact[] = [
  {
    id: "f_kit_price",
    label: "Aegean Bunkers VLSFO price at Piraeus",
    value: 612.5,
    unit: "USD/mt",
    provenance: { source: "db", table: "quote_lines", rowId: 12, field: "price_per_mt" },
  },
  {
    id: "f_kit_barge",
    label: "Barge fee as quoted",
    value: 2750,
    unit: "USD",
    provenance: {
      source: "document",
      documentId: 3,
      extractionId: 3,
      field: "bargeFee",
      evidence: "Barge delivery is charged at USD 2,750 per stem.",
    },
  },
  {
    id: "f_kit_total",
    label: "Total delivered cost, Aegean Bunkers at Piraeus",
    value: 941318.75,
    unit: "USD",
    provenance: {
      source: "calculation",
      calculationId: 41,
      calculator: "bunker_planner",
      path: "options[0].totalCostUsd",
    },
  },
  {
    id: "f_kit_alt_total",
    label: "Total delivered cost, Algeciras",
    value: 959568.75,
    unit: "USD",
    provenance: {
      source: "calculation",
      calculationId: 41,
      calculator: "bunker_planner",
      path: "options[1].totalCostUsd",
    },
  },
  {
    id: "f_kit_saving",
    label: "Saving against Algeciras",
    value: 18250,
    unit: "USD",
    provenance: {
      source: "derived",
      operation: "difference",
      operands: ["f_kit_alt_total", "f_kit_total"],
    },
  },
  {
    id: "f_kit_sog",
    label: "Aegean Pioneer speed over ground",
    value: 13.4,
    unit: "kn",
    provenance: { source: "ais", mmsi: "538007841", ts: "2026-11-14T07:58:12Z" },
  },
  {
    id: "f_kit_wave",
    label: "Significant wave height on leg 2",
    value: 2.4,
    unit: "m",
    provenance: { source: "weather", snapshotId: 7, modelRun: "2026-11-14T06:00:00Z" },
  },
];

export const SAMPLE_ANSWER =
  "Bunker Aegean Pioneer at Piraeus with Aegean Bunkers: $612.50/mt [f_kit_price] plus a USD 2,750 [f_kit_barge] barge fee comes to USD 941,319 [f_kit_total] delivered, USD 18,250 [f_kit_saving] less than Algeciras once the deviation is counted. The ship is making 13.4 kn [f_kit_sog] into 2.4 m [f_kit_wave] seas on leg 2.";

export const SAMPLE_SOURCES: SourceStatusView[] = [
  {
    source: "ais",
    mode: "recorded",
    detail: "fixtures/recorded/ais-capture.jsonl",
    updatedAt: "2026-11-14T08:05:00Z",
  },
  {
    source: "weather",
    mode: "live",
    detail: "Open-Meteo marine",
    updatedAt: "2026-11-14T08:00:00Z",
  },
];

export const SAMPLE_CALLS_WORKING: ToolCall[] = [
  { id: "0", tool: "get_vessel_status", state: "done", ms: 38 },
  { id: "1", tool: "list_quotes", state: "done", ms: 21 },
  { id: "2", tool: "plan_bunkering", state: "running", ms: null },
];

export const SAMPLE_CALLS_DONE: ToolCall[] = [
  { id: "0", tool: "get_vessel_status", state: "done", ms: 38 },
  { id: "1", tool: "list_quotes", state: "done", ms: 21 },
  { id: "2", tool: "plan_bunkering", state: "done", ms: 312 },
  { id: "3", tool: "calculate", state: "done", ms: 2 },
];

/** Values a metric steps through when the kit's "next value" button is pressed. */
export const SAMPLE_METRICS = {
  anchored: [12, 15, 9],
  waitingHours: [14.5, 18, 9.25],
  robMt: [612.4, 598.1, 640],
};

export const SAMPLE_QUOTES = [
  {
    id: 1,
    supplier: "Aegean Bunkers",
    port: "Piraeus",
    grade: "VLSFO",
    price: 612.5,
    currency: "USD",
    barge: 2750,
  },
  {
    id: 2,
    supplier: "Med Fuel Partners",
    port: "Algeciras",
    grade: "VLSFO",
    price: 598,
    currency: "USD",
    barge: 3100,
  },
  {
    id: 3,
    supplier: "Nordwind Marine",
    port: "Algeciras",
    grade: "LSMGO",
    price: 690,
    currency: "EUR",
    barge: 3000,
  },
];
