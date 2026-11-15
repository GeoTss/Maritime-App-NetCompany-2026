import type { CongestionInput, CongestionResult } from "@pharos/shared";
import { greatCircleNm } from "./geo.js";

const SLOW_SOG_KN = 0.5;

/** Vessels waiting off a port from AIS rows: anchored count and the implied waiting time. */
export function portCongestion(input: CongestionInput): CongestionResult {
  let inRangeCount = 0;
  let anchoredCount = 0;
  for (const s of input.vessels) {
    if (greatCircleNm(input.port, s) > input.radiusNm) continue;
    inRangeCount++;
    const anchored =
      s.navStatus === "at anchor" ||
      (s.sogKn !== null && s.sogKn < SLOW_SOG_KN && s.navStatus !== "moored");
    if (anchored) anchoredCount++;
  }
  const waitingHours = Math.min(
    input.maxWaitingHours,
    anchoredCount * input.hoursPerAnchoredVessel,
  );
  return { anchoredCount, inRangeCount, waitingHours };
}
