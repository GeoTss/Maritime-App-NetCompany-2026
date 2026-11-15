import type { RecommendationStatus } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { type ApprovalEvent, TransitionError, transition } from "./state.js";

const STATUSES: RecommendationStatus[] = [
  "pending",
  "approved",
  "executing",
  "executed",
  "rejected",
  "failed",
];
const EVENTS: ApprovalEvent[] = ["approve", "reject", "start", "succeed", "fail", "retry"];

const LEGAL: [RecommendationStatus, ApprovalEvent, RecommendationStatus][] = [
  ["pending", "approve", "approved"],
  ["approved", "start", "executing"],
  ["executing", "succeed", "executed"],
  ["executing", "fail", "failed"],
  ["failed", "retry", "executing"],
  ["pending", "reject", "rejected"],
];

describe("transition", () => {
  it.each(LEGAL)("%s -%s-> %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it("throws TransitionError for every other (status, event) pair", () => {
    const legal = new Set(LEGAL.map(([f, e]) => `${f}/${e}`));
    let illegal = 0;
    for (const from of STATUSES) {
      for (const event of EVENTS) {
        if (legal.has(`${from}/${event}`)) continue;
        illegal++;
        expect(() => transition(from, event), `${from}/${event}`).toThrow(TransitionError);
      }
    }
    expect(illegal).toBe(STATUSES.length * EVENTS.length - LEGAL.length);
  });

  it("executed and rejected are terminal", () => {
    for (const event of EVENTS) {
      expect(() => transition("executed", event)).toThrow(TransitionError);
      expect(() => transition("rejected", event)).toThrow(TransitionError);
    }
  });
});
