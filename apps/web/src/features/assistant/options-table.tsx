/**
 * The options a bunker plan compared, in the plan's rank order, built from the stored plan's own
 * facts (`GET /api/bunker-plans/:id`). Every value is a fact chip with the same id and label as the
 * answer's citation of it. The UI ranks and recommends nothing: rank, best and feasible are the
 * plan's, and the only arithmetic is rounding for display.
 */
import type { BunkerOptionView, BunkerPlanView, Fact } from "@pharos/shared";
import { useId } from "react";
import { FactChip, factDisplay } from "@/components/fact-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The digits alone when the column head names the fact's unit; otherwise value and unit. */
function inColumnUnit(fact: Fact, unit: string): string {
  return typeof fact.value === "number" && fact.unit === unit
    ? formatDigits(fact.value, fact.unit)
    : factDisplay(fact);
}

function OptionRow({ option }: { option: BunkerOptionView }) {
  return (
    <TableRow
      data-option={option.optionId}
      data-best={option.best}
      className={cn(option.best && "bg-ink-850")}
    >
      <TableCell className="px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "w-2 shrink-0 text-2xs tabular-nums",
              option.best ? "text-beacon" : "text-text-3",
            )}
          >
            {option.rank}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs/3.5 text-text-1" title={option.supplier}>
              {option.supplier}
            </span>
            <span className="flex min-w-0 gap-1 text-2xs/3.5 text-text-2">
              <span className="truncate">{option.port.name}</span>
              {option.best ? <span className="shrink-0 text-beacon">Recommended</span> : null}
              {option.feasible ? null : <span className="shrink-0 text-alarm">infeasible</span>}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-1.5 text-right">
        <FactChip fact={option.headlinePrice}>
          {inColumnUnit(option.headlinePrice, "USD/mt")}
        </FactChip>
      </TableCell>
      <TableCell className="px-1.5 text-right">
        <FactChip fact={option.delay} />
      </TableCell>
      <TableCell className="px-2.5 text-right">
        <FactChip fact={option.totalCost} className={cn(option.best && "text-beacon")}>
          {inColumnUnit(option.totalCost, "USD")}
        </FactChip>
      </TableCell>
    </TableRow>
  );
}

export function OptionsTable({ plan }: { plan: BunkerPlanView }) {
  const titleId = useId();
  if (plan.options.length === 0) return null;
  return (
    <div className="border border-line">
      <div className="flex h-7 items-center gap-2 border-b border-line px-2.5 text-2xs">
        <span id={titleId} className="font-medium text-text-2 font-label">
          Options compared
        </span>
        <span className="ml-auto text-text-3">bunker plan {plan.calculationId}</span>
      </div>
      <Table aria-labelledby={titleId} className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="px-2.5">Supplier · port</TableHead>
            <TableHead className="w-14 px-1.5 text-right">USD/mt</TableHead>
            <TableHead className="w-14 px-1.5 text-right">Delay</TableHead>
            <TableHead className="w-18 px-2.5 text-right">Total USD</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.options.map((option) => (
            <OptionRow key={option.optionId} option={option} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
