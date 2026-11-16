import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MAX_EML_BYTES = 10 * 1024 * 1024;

/** What is wrong with the file, before it is sent; null when it can go. */
export function fileProblem(file: File): string | null {
  if (!/\.eml$/i.test(file.name))
    return "Only .eml files can be dropped in. Save the email as .eml first.";
  if (file.size > MAX_EML_BYTES) return "That file is over 10 MB, the most the inbox takes.";
  return null;
}

/**
 * Drop an .eml here (sent as message/rfc822). Dropping or choosing a file is the operator's
 * input; nothing is read or sent on hover.
 */
export function UploadDrop({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (!file) return;
    const why = fileProblem(file);
    setProblem(why);
    if (!why) onFile(file);
  };

  return (
    <fieldset
      aria-label="Upload an email"
      data-testid="upload-drop"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files[0]);
      }}
      className={cn(
        "flex flex-col gap-1.5 border border-dashed p-2 text-xs",
        over ? "border-beacon bg-beacon/10" : "border-line-strong",
      )}
    >
      <p className="flex items-center gap-1.5 text-text-2">
        <HugeiconsIcon icon={FileUploadIcon} strokeWidth={1.75} className="size-3.5 text-text-3" />
        Drop an .eml file here
      </p>
      <input
        ref={input}
        type="file"
        accept=".eml,message/rfc822"
        aria-label="Choose an .eml file"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading" : "Choose a file"}
      </Button>
      {problem ? (
        <p role="alert" className="text-alarm">
          {problem}
        </p>
      ) : null}
    </fieldset>
  );
}
