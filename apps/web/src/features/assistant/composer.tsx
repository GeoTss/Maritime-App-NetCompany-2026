/** The question box: Enter asks, Shift+Enter adds a line. Disabled while an ask runs. */
import { SentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setDraft, useAssistant } from "./assistant-store";

export function Composer({ onAsk, busy }: { onAsk: (question: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const { draft } = useAssistant();
  // A question put here from another screen: shown for the operator to read and send.
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    setDraft(null);
    field.current?.focus();
  }, [draft]);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    onAsk(text);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-2">
      <Textarea
        ref={field}
        id="ask-the-assistant"
        aria-label="Ask the assistant"
        placeholder="Ask about a vessel, a quote, a route…"
        rows={1}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-7 max-h-32 py-1"
      />
      <Button type="submit" disabled={busy || !text.trim()} aria-label="Ask">
        <HugeiconsIcon icon={SentIcon} strokeWidth={2} data-icon="inline-start" />
        Ask
      </Button>
    </form>
  );
}
