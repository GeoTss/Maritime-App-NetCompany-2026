/**
 * The danger areas in the map's side column (Track 3), ranked most-needed first as the API sends
 * them: each with its level, what it asks of a ship, why (the sources' note) and, on request, the
 * cited source and its date. Pressing a name flies the map there. Nothing here decides anything.
 */
import type { SecurityArea } from "@pharos/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setLayout, useLayout } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { FoldSection } from "./fold-section";
import { LEVEL_TEXT, LEVEL_TONE, POLICY_TEXT, TONE_SWATCH, TONE_TEXT } from "./security-text";

export function DangerAreas({
  areas,
  onFly,
}: {
  areas: readonly SecurityArea[];
  onFly: (id: string) => void;
}) {
  const layout = useLayout();
  if (areas.length === 0) return null;
  return (
    <FoldSection
      label="Danger areas"
      title={`Danger areas (${areas.length})`}
      open={layout.danger}
      onOpenChange={(danger) => setLayout({ danger })}
      className="border-t border-line"
    >
      <ol className="grid">
        {areas.map((a) => {
          const tone = LEVEL_TONE[a.level];
          return (
            <li
              key={a.id}
              data-testid={`danger-area-${a.id}`}
              className="grid grid-cols-[10px_1fr] gap-x-2 border-b border-line/60 py-1.5 last:border-0"
            >
              <span aria-hidden className={cn("mt-1 size-2.5 rounded-[2px]", TONE_SWATCH[tone])} />
              <div className="flex min-w-0 items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onFly(a.id)}
                  className="text-left text-xs text-text-1 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-beacon/50"
                >
                  {a.name}
                </button>
                <span className={cn("ml-auto shrink-0 text-2xs font-medium", TONE_TEXT[tone])}>
                  {LEVEL_TEXT[a.level]}
                </span>
              </div>
              <span className="col-start-2 text-xs text-text-1">{POLICY_TEXT[a.policy]}</span>
              <span className="col-start-2 text-xs text-pretty text-text-2">{a.note}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="link"
                    size="xs"
                    className="col-start-2 h-auto justify-self-start px-0 text-text-3"
                  >
                    Source, as of {a.asOf}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="max-w-80 text-2xs break-words">
                  {a.source}
                </PopoverContent>
              </Popover>
            </li>
          );
        })}
      </ol>
    </FoldSection>
  );
}
