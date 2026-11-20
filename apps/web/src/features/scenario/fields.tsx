/**
 * Small form pieces the Scenario panel's tabs share: a labelled number field, a field group, and
 * the "Pick on map" control. Values stay strings while typed; each form parses them with the
 * shared schema on save, so the bounds live in one place.
 */
import type { LatLon } from "@pharos/shared";
import { type ReactNode, useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NumberField({
  label,
  value,
  onChange,
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-text-2 font-label">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 tabular-nums"
      />
    </div>
  );
}

/** A UTC date and time, typed as "2026-11-14T08:00" (the browser's own picker). */
export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-text-2 font-label">
        {label}
      </label>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 tabular-nums"
      />
    </div>
  );
}

/** "2026-11-14T08:00" for an instant, in UTC; and back to an ISO instant (undefined if not one). */
export const utcInput = (iso: string) => iso.slice(0, 16);
export const fromUtcInput = (v: string): string | undefined =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00.000Z` : undefined;

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-text-2 font-label">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        className="h-7"
      />
    </div>
  );
}

export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 border-b border-line pb-3">
      <legend className="pb-1 text-xs font-medium text-text-1">{title}</legend>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </fieldset>
  );
}

/** `null` cancels a pick the page is waiting on. */
export type PickRequest = (resolve: ((p: LatLon) => void) | null) => void;

/**
 * "Pick on map": the next click on the map fills the centre. Esc cancels. While waiting, the
 * button says so.
 */
export function PickOnMap({
  picking,
  onPickingChange,
  onPickRequest,
  onPicked,
}: {
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
  onPickRequest: PickRequest;
  onPicked: (p: LatLon) => void;
}) {
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onPickingChange(false);
      onPickRequest(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, onPickingChange, onPickRequest]);
  return picking ? (
    <p className="col-span-3 text-xs text-beacon" role="status">
      Click the map to place it (Esc cancels).
    </p>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="col-span-3 w-fit"
      onClick={() => {
        onPickingChange(true);
        onPickRequest((p) => {
          onPickingChange(false);
          onPicked(p);
        });
      }}
    >
      Pick on map
    </Button>
  );
}

/** A picked point for a form field: two decimals, as typed. */
export const coordText = (v: number) => String(Math.round(v * 100) / 100);

/** A typed number, or undefined when the field is blank or not a number. */
export const num = (v: string): number | undefined => {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
