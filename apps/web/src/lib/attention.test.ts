// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HAZARDS, VESSELS } from "@/features/map/map-fixtures";
import { attentionItems } from "./attention";

const inbox = (documentId: number, receivedAt: string, extractionStatus = "needs_review") =>
  ({
    documentId,
    sender: "a@b.c",
    subject: `Quote ${documentId}`,
    receivedAt,
    kind: "email",
    extractionStatus,
  }) as never;

describe("attentionItems", () => {
  it("counts 3 at the demo's start: one alert, one quote to review, one hazard", () => {
    const items = attentionItems({
      vessels: VESSELS,
      inbox: [
        inbox(1, "2026-11-14T08:00:00.000Z"),
        inbox(2, "2026-11-14T08:00:00.000Z", "extracted"),
      ],
      recommendations: [],
      hazards: HAZARDS.items,
    });
    expect(items.map((i) => i.kind)).toEqual(["vessel_alert", "quote_review", "hazard"]);
  });

  it("orders proposals, alerts, quotes, hazards; oldest first within a kind", () => {
    const rec = (id: number, status: string) =>
      ({ id, status, type: "purchase_order", summary: `PO ${id}` }) as never;
    const items = attentionItems({
      vessels: VESSELS,
      inbox: [inbox(5, "2026-11-14T10:00:00.000Z"), inbox(4, "2026-11-14T09:00:00.000Z")],
      recommendations: [rec(9, "pending"), rec(3, "pending"), rec(1, "approved")],
      hazards: HAZARDS.items,
    });
    expect(items.map((i) => i.kind)).toEqual([
      "proposal",
      "proposal",
      "vessel_alert",
      "quote_review",
      "quote_review",
      "hazard",
    ]);
    expect(
      items
        .filter((i) => i.kind === "proposal")
        .map((i) => (i as { recommendationId: number }).recommendationId),
    ).toEqual([3, 9]);
    expect(
      items
        .filter((i) => i.kind === "quote_review")
        .map((i) => (i as { documentId: number }).documentId),
    ).toEqual([4, 5]);
  });
});
