/**
 * Two versions side by side (Beautiful UI's diff-table pattern, composed from shadcn `table`):
 * "as written → corrected" in review, "planned → recommended" in the route tray. A row that
 * changes shows its old value struck through and its new value in full ink; equal rows stay quiet.
 * Values are whatever the caller passes (text, fact chips): the table compares nothing itself
 * unless `changed` is left out, in which case two plain strings are compared for equality.
 */
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DiffRow {
  key: string;
  label: string;
  before: ReactNode;
  after: ReactNode;
  /** Whether the row changes; defaults to comparing `before` and `after` when both are strings. */
  changed?: boolean;
}

const isChanged = (row: DiffRow) =>
  row.changed ??
  (typeof row.before === "string" && typeof row.after === "string"
    ? row.before !== row.after
    : true);

export function DiffTable({
  rows,
  beforeLabel,
  afterLabel,
  afterTone = "text-text-1",
  className,
}: {
  rows: DiffRow[];
  beforeLabel: string;
  afterLabel: string;
  /** Colour of a changed new value, e.g. `text-beacon` for the recommended route. */
  afterTone?: string;
  className?: string;
}) {
  return (
    <Table className={cn("table-fixed", className)}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[30%]">Field</TableHead>
          <TableHead className="w-[35%]">{beforeLabel}</TableHead>
          <TableHead className="w-[35%]">{afterLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const changed = isChanged(row);
          return (
            <TableRow key={row.key} data-changed={changed}>
              <TableCell className="truncate text-text-2">{row.label}</TableCell>
              <TableCell
                className={cn(
                  "truncate",
                  changed ? "text-text-3 line-through decoration-text-3/70" : "text-text-2",
                )}
              >
                {row.before}
              </TableCell>
              <TableCell className={cn("truncate", changed ? afterTone : "text-text-2")}>
                <span className="inline-flex max-w-full items-center gap-1.5">
                  {changed ? (
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      aria-label="changes to"
                      className="size-3 shrink-0 text-text-3"
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{row.after}</span>
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
