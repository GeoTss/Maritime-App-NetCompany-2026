import type { CongestionInput, CongestionResult } from "@pharos/shared";
import { greatCircleNm } from "./geo.js";

/** Vessels waiting off a port from AIS rows: anchored count and the implied waiting time. */
export function portCongestion(input: CongestionInput): CongestionResult {
  let inRangeCount = 0;
  let anchoredCount = 0;
  for (const s of input.vessels) {
    if (greatCircleNm(input.port, s) > input.radiusNm) continue;
    inRangeCount++;
    // Only ships reporting "at anchor": ships in port basins report slow speeds under way or moored.
    if (s.navStatus === "at anchor") anchoredCount++;
  }
  const waitingHours = Math.min(
    input.maxWaitingHours,
    anchoredCount * input.hoursPerAnchoredVessel,
  );
  return { anchoredCount, inRangeCount, waitingHours };
}
