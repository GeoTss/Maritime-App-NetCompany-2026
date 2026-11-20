/**
 * The Vessels tab: one fleet vessel's stats (fuel on board, tanks, speed and consumption, costs,
 * stores), edited as numbers and saved as one patch. The shared schema checks the bounds and the
 * speed order before anything is sent; the server checks the patch against the vessel too.
 */
import { FUEL_GRADES, ScenarioVesselPatch, type ScenarioView } from "@pharos/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UntrustedText } from "@/components/untrusted-text";
import { FieldGroup, NumberField, num } from "./fields";

type Values = ScenarioView["vessels"][number]["values"];
type Draft = Record<string, string>;

const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function draftOf(v: Values): Draft {
  const d: Draft = {
    refSpeedKn: s(v.consumption.refSpeedKn),
    refMtPerDay: s(v.consumption.refMtPerDay),
    auxMtPerDay: s(v.consumption.auxMtPerDay),
    minSpeedKn: s(v.consumption.minSpeedKn),
    maxSpeedKn: s(v.consumption.maxSpeedKn),
    dailyCostUsd: s(v.dailyCostUsd),
    hullValueUsd: s(v.hullValueUsd),
    crew: s(v.stores?.crew),
    provisionsPersonDays: s(v.stores?.provisionsPersonDays),
    sludgeM3: s(v.stores?.sludgeM3),
    sewageM3: s(v.stores?.sewageM3),
  };
  for (const g of FUEL_GRADES) {
    d[`rob.${g}`] = s(v.robMt[g]);
    d[`tank.${g}`] = s(v.tankCapacityMt[g]);
  }
  return d;
}

/** Only the fields that changed, as the patch the API takes. */
function patchOf(d: Draft, v: Values): unknown {
  const was = draftOf(v);
  const changed = (k: string) => d[k] !== was[k];
  const pick = (keys: string[], key: (k: string) => string) => {
    const out: Record<string, number | undefined> = {};
    for (const k of keys) if (changed(key(k))) out[k] = num(d[key(k)] ?? "");
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const patch: Record<string, unknown> = {
    robMt: pick([...FUEL_GRADES], (g) => `rob.${g}`),
    tankCapacityMt: pick([...FUEL_GRADES], (g) => `tank.${g}`),
    consumption: pick(
      ["refSpeedKn", "refMtPerDay", "auxMtPerDay", "minSpeedKn", "maxSpeedKn"],
      (k) => k,
    ),
    stores: v.stores
      ? pick(["crew", "provisionsPersonDays", "sludgeM3", "sewageM3"], (k) => k)
      : undefined,
    dailyCostUsd: changed("dailyCostUsd") ? num(d.dailyCostUsd ?? "") : undefined,
    hullValueUsd: changed("hullValueUsd") ? num(d.hullValueUsd ?? "") : undefined,
  };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  return patch;
}

export function VesselForm({
  vessels,
  saving,
  onSave,
}: {
  vessels: ScenarioView["vessels"];
  saving: boolean;
  onSave: (id: number, patch: ScenarioVesselPatch) => void;
}) {
  const [id, setId] = useState<number | null>(vessels[0]?.id ?? null);
  const vessel = vessels.find((v) => v.id === id) ?? vessels[0];
  const [draft, setDraft] = useState<Draft>(() => (vessel ? draftOf(vessel.values) : {}));
  const [problem, setProblem] = useState<string | null>(null);
  // A new vessel, or the vessel as saved: the form shows its values again.
  useEffect(() => {
    if (vessel) setDraft(draftOf(vessel.values));
    setProblem(null);
  }, [vessel]);
  if (!vessel) return <p className="text-text-2">There is no fleet vessel to edit.</p>;

  const field = (key: string, label: string) => (
    <NumberField
      key={key}
      label={label}
      value={draft[key] ?? ""}
      onChange={(value) => setDraft((d) => ({ ...d, [key]: value }))}
    />
  );
  const save = () => {
    const parsed = ScenarioVesselPatch.safeParse(patchOf(draft, vessel.values));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setProblem(issue ? `${issue.path.join(".")}: ${issue.message}` : "A value is not valid.");
      return;
    }
    setProblem(null);
    onSave(vessel.id, parsed.data);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Select value={String(vessel.id)} onValueChange={(v) => setId(Number(v))}>
        <SelectTrigger aria-label="Vessel" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {vessels.map((v) => (
            <SelectItem key={v.id} value={String(v.id)}>
              <UntrustedText text={v.name} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldGroup title="Fuel on board (mt)">
        {FUEL_GRADES.map((g) => field(`rob.${g}`, `${g} on board`))}
      </FieldGroup>
      <FieldGroup title="Tank capacity (mt)">
        {FUEL_GRADES.map((g) => field(`tank.${g}`, `${g} tank`))}
      </FieldGroup>
      <FieldGroup title="Speed and consumption">
        {field("minSpeedKn", "Minimum speed (kn)")}
        {field("refSpeedKn", "Reference speed (kn)")}
        {field("maxSpeedKn", "Maximum speed (kn)")}
        {field("refMtPerDay", "Main engine at reference (mt/day)")}
        {field("auxMtPerDay", "Auxiliaries (mt/day)")}
      </FieldGroup>
      <FieldGroup title="Costs (USD)">
        {field("dailyCostUsd", "Daily cost")}
        {field("hullValueUsd", "Hull value")}
      </FieldGroup>
      {vessel.values.stores ? (
        <FieldGroup title="Stores and waste">
          {field("crew", "Crew")}
          {field("provisionsPersonDays", "Provisions (person-days)")}
          {field("sludgeM3", "Sludge (m³)")}
          {field("sewageM3", "Sewage (m³)")}
        </FieldGroup>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-alarm">
          {problem}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="w-fit" disabled={saving}>
        Save vessel
      </Button>
    </form>
  );
}
