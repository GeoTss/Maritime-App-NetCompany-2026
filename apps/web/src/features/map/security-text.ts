/**
 * Track 3 wording shared by the danger-areas layer, its list and the route tray: what each JMIC
 * level is called and which hue it takes (alarm for SEVERE and above, caution for SUBSTANTIAL,
 * plan grey for the rest), and what each area's policy asks of a ship.
 */
import type { SecurityLevel, SecurityPolicy } from "@pharos/shared";

export type SecurityTone = "alarm" | "caution" | "plan";

export const LEVEL_TONE: Record<SecurityLevel, SecurityTone> = {
  CRITICAL: "alarm",
  SEVERE: "alarm",
  SUBSTANTIAL: "caution",
  MODERATE: "plan",
  LOW: "plan",
  LISTED: "plan",
};

export const LEVEL_TEXT: Record<SecurityLevel, string> = {
  CRITICAL: "Critical",
  SEVERE: "Severe",
  SUBSTANTIAL: "Substantial",
  MODERATE: "Moderate",
  LOW: "Low",
  LISTED: "Listed by insurers",
};

export const POLICY_TEXT: Record<SecurityPolicy, string> = {
  avoid: "No transit: routes go round",
  guards: "Armed security team needed",
  premium: "War-risk premium (guards cannot stop missiles)",
  measures: "Report to UKMTO, keep protective measures",
  escort: "Navy escort only: private guards not allowed",
};

/** The policy in two or three words, for the map label. */
export const POLICY_SHORT: Record<SecurityPolicy, string> = {
  avoid: "no transit",
  guards: "armed team",
  premium: "war-risk premium",
  measures: "protective measures",
  escort: "navy escort only",
};

export const TONE_TEXT: Record<SecurityTone, string> = {
  alarm: "text-alarm",
  caution: "text-caution",
  plan: "text-plan",
};

export const TONE_SWATCH: Record<SecurityTone, string> = {
  alarm: "bg-alarm/70",
  caution: "bg-caution/70",
  plan: "bg-plan/60",
};
