import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { UntrustedText } from "@/components/untrusted-text";
import { EvidenceText, locateEvidence } from "./evidence-text";

/**
 * The email as text, on the left. Email content is untrusted data: it is shown as a text node in
 * a pre-wrapped block, never as HTML. While a field is hovered or focused its evidence sentence is
 * marked; if that sentence is not in the text a notice says so rather than showing nothing.
 */
export function DocumentView({
  subject,
  sender,
  bodyText,
  evidence,
}: {
  subject: string | null;
  sender: string | null;
  bodyText: string;
  evidence: string | null;
}) {
  const missing = evidence !== null && locateEvidence(bodyText, evidence) === null;
  return (
    <section aria-label="Source email" className="flex min-h-0 min-w-0 flex-col border-line">
      <header className="flex flex-col gap-0.5 border-b border-line px-3 py-2">
        <h2 className="font-title text-base font-medium text-text-1">
          <UntrustedText text={subject} fallback="(no subject)" />
        </h2>
        <p className="text-xs text-text-2">
          From <UntrustedText text={sender} fallback="unknown sender" />
        </p>
      </header>
      {missing ? (
        <p
          role="status"
          className="flex items-start gap-1.5 border-b border-line bg-caution/10 px-3 py-1.5 text-xs text-caution"
        >
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-3 shrink-0" />
          <span>
            Not found in the email text: <UntrustedText text={evidence} className="text-text-1" />
          </span>
        </p>
      ) : null}
      <pre
        data-testid="source-text"
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-sans text-sm/relaxed whitespace-pre-wrap text-text-1"
      >
        <EvidenceText text={bodyText} evidence={missing ? null : evidence} />
      </pre>
    </section>
  );
}
