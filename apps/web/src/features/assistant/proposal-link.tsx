/** A link to a proposal an answer created: the approvals screen is where it is decided. */
import { CheckListIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "react-router";

export function ProposalLink({ id }: { id: number }) {
  return (
    <Link
      to={`/approvals?recommendation=${id}`}
      className="flex h-7 w-fit items-center gap-1.5 border border-line px-2 text-xs text-beacon hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-beacon/40 outline-none"
    >
      <HugeiconsIcon icon={CheckListIcon} strokeWidth={2} className="size-3.5" />
      Proposal {id} waiting for your decision
    </Link>
  );
}
