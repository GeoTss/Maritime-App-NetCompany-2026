/**
 * A voyage instruction that calls at a bunker port waits for the purchase order for that stop's
 * quote. The line names the order and its status (with its flag), links to it, and says why
 * Approve is off while the order is not approved. The API resolves the link (`dependsOn`); the UI
 * reads `satisfied` and `status` as returned and decides nothing else.
 */
import type { RecommendationDependency, RecommendationView } from "@pharos/shared";
import { Link } from "react-router";
import { StatusWord } from "@/components/primitives/approval-card";
import { StateFlag } from "@/components/primitives/state-flag";
import { cn } from "@/lib/utils";

/** Whether the order is beyond saving: rejected or failed. */
const blocked = (dep: RecommendationDependency) =>
  dep.status === "rejected" || dep.status === "failed";

/**
 * Why Approve is off for this proposal, or null when nothing holds it. `blocked`: the order was
 * rejected or failed, so the instruction can only be rejected.
 */
export function approveHeld(rec: RecommendationView): { text: string; blocked: boolean } | null {
  const dep = rec.dependsOn;
  if (rec.status !== "pending" || !dep || dep.satisfied) return null;
  if (dep.recommendationId === null)
    return {
      text: `Approve opens once a purchase order for ${dep.optionLabel} is proposed and approved.`,
      blocked: false,
    };
  if (blocked(dep))
    return {
      text: `Blocked: its purchase order (proposal ${dep.recommendationId}) was ${dep.status === "failed" ? "not executed" : "rejected"}. Only Reject is open.`,
      blocked: true,
    };
  return {
    text: `Approve opens once purchase order proposal ${dep.recommendationId} is approved.`,
    blocked: false,
  };
}

export function DependencyLine({
  dep,
  className,
}: {
  dep: RecommendationDependency;
  className?: string;
}) {
  return (
    <section
      aria-label="Purchase order it depends on"
      data-testid="dependency-line"
      data-satisfied={dep.satisfied}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-ink-900 px-3 py-2 text-xs",
        className,
      )}
    >
      <span className="text-text-1">
        {dep.satisfied ? "Its purchase order" : "Waits for the purchase order"}:{" "}
        <span className="font-medium">{dep.optionLabel}</span>
      </span>{" "}
      {dep.recommendationId === null ? (
        <span className="inline-flex items-center gap-1.5 text-caution">
          <StateFlag kind="K" />
          none proposed yet
        </span>
      ) : (
        <>
          {dep.status ? <StatusWord status={dep.status} /> : null}{" "}
          <Link
            to={{ search: `?recommendation=${dep.recommendationId}` }}
            className="ml-auto text-beacon underline-offset-3 hover:underline"
          >
            Open proposal {dep.recommendationId}
          </Link>
        </>
      )}
    </section>
  );
}
