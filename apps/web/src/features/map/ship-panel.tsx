/**
 * A public AIS ship. Its name and destination are untrusted text. AIS draught and load condition
 * are cited facts once a route is planned; before that, only the raw last AIS report is shown.
 */
import type { AisTrafficView, PortView, RoutePlanResponse } from "@pharos/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UntrustedText } from "@/components/untrusted-text";
import { describeFailure } from "@/lib/api";
import { formatUtc } from "@/lib/format";
import { Field, PanelFrame, Section } from "./panel-frame";
import { loadFacts } from "./route-facts";
import { FactCell } from "./route-tray";

export function ShipPanel({
  ship,
  ports,
  plan,
  planning,
  planError,
  onPlan,
  onClose,
  className,
}: {
  ship: AisTrafficView;
  ports: PortView[];
  plan: RoutePlanResponse | null;
  planning: boolean;
  planError: unknown;
  onPlan: (unlocode: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const [destination, setDestination] = useState<string>("");
  const load = plan ? loadFacts(plan.facts) : null;
  return (
    <PanelFrame
      label="Ship panel"
      className={className}
      onClose={onClose}
      title={<UntrustedText text={ship.name} fallback="Unnamed ship" />}
      subtitle={
        <span className="flex flex-wrap gap-x-2">
          <span>
            MMSI <span className="font-mono text-2xs">{ship.mmsi}</span>
          </span>
          <UntrustedText text={ship.shipType} fallback="Type not reported" />
        </span>
      }
      footer={
        <>
          <label htmlFor="ship-destination" className="text-text-3 font-label">
            Plan route to…
          </label>
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger id="ship-destination" className="w-full" aria-label="Destination port">
              <SelectValue placeholder="Choose a port" />
            </SelectTrigger>
            <SelectContent>
              {ports.map((p) => (
                <SelectItem key={p.id} value={p.unlocode}>
                  {p.name}
                  <span className="font-mono text-2xs text-text-3">{p.unlocode}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="lg"
            disabled={planning || destination === ""}
            aria-busy={planning}
            onClick={() => onPlan(destination)}
          >
            {planning ? "Planning…" : "Plan route"}
          </Button>
          <p className="text-2xs text-text-3">
            Uses this ship's reported draught and position. Stores the calculation; nothing is sent.
          </p>
          {planError ? (
            <p role="alert" className="text-alarm">
              {describeFailure(planError)}
            </p>
          ) : null}
        </>
      }
      tags={<span className="text-2xs text-text-3">Public AIS ship, not in the fleet</span>}
    >
      <Section title="Reported destination">
        <p className="text-text-1">
          <UntrustedText text={ship.destination} fallback="Not reported" />
        </p>
      </Section>

      <Section title="Last AIS report">
        <dl className="flex flex-col gap-1" data-testid="ship-report">
          <Field label="Status">
            <UntrustedText text={ship.navStatus} fallback="Not reported" />
          </Field>
          <Field label="Speed">{ship.sogKn === null ? "—" : `${ship.sogKn.toFixed(1)} kn`}</Field>
          <Field label="Course">{ship.cogDeg === null ? "—" : `${Math.round(ship.cogDeg)}°`}</Field>
          <Field label="Reported draught">
            {ship.draughtM === null ? "—" : `${ship.draughtM.toFixed(1)} m`}
          </Field>
          <Field label="Position">
            <span className="font-mono text-2xs">
              {ship.lat.toFixed(3)}, {ship.lon.toFixed(3)}
            </span>
          </Field>
          <Field label="Reported at">{formatUtc(ship.updatedAt)}</Field>
        </dl>
      </Section>

      <Section title="Draught and load condition">
        {plan && load ? (
          <dl className="flex flex-col gap-1" data-testid="ship-load">
            <Field label="AIS draught">
              <FactCell fact={load.aisDraught} />
            </Field>
            <Field label="Load condition">
              <FactCell fact={load.loadCondition} />
            </Field>
          </dl>
        ) : (
          <p className="text-text-2">Shown, with its source, once you plan a route.</p>
        )}
      </Section>
    </PanelFrame>
  );
}
