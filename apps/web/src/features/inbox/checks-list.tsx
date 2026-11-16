import { Alert02Icon, ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CheckResult } from "@pharos/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UntrustedText } from "@/components/untrusted-text";

function CheckRow({ c }: { c: CheckResult }) {
  return (
    <li data-passed={c.passed} className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <HugeiconsIcon
        icon={c.passed ? Tick02Icon : Alert02Icon}
        strokeWidth={2}
        aria-label={c.passed ? "Passed" : "Failed"}
        className={`mt-0.5 size-3 shrink-0 ${c.passed ? "text-go" : "text-alarm"}`}
      />
      <div className="min-w-0">
        <span className="font-mono text-2xs text-text-1">{c.check}</span>
        {c.detail ? (
          <p className="text-text-2">
            <UntrustedText text={c.detail} />
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Each deterministic check with its verdict and message. Failed checks come first and are always
 * shown; the passed ones sit behind one toggle so a long list does not bury the failures.
 */
export function ChecksList({ checks }: { checks: CheckResult[] }) {
  if (checks.length === 0) {
    return <p className="px-3 py-2 text-xs text-text-3">No checks have run on this email yet.</p>;
  }
  const failed = checks.filter((c) => !c.passed);
  const passed = checks.filter((c) => c.passed);
  return (
    <section aria-label="Checks">
      {failed.length > 0 ? (
        <ul aria-label="Failed checks" className="divide-y divide-line">
          {failed.map((c) => (
            <CheckRow key={c.check} c={c} />
          ))}
        </ul>
      ) : null}
      {passed.length > 0 ? (
        <Collapsible className="border-t border-line first:border-t-0">
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-text-2 outline-none hover:bg-ink-850 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60">
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className="size-3 transition-transform group-data-[state=open]:rotate-180"
            />
            {passed.length} {passed.length === 1 ? "check" : "checks"} passed
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul aria-label="Passed checks" className="divide-y divide-line">
              {passed.map((c) => (
                <CheckRow key={c.check} c={c} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}
