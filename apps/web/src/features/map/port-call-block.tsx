/**
 * What a stop's port call does beside the bunkering, read from the plan by output path
 * (`stopPlans[i].portCall.*`): each job the voyage needs (provisions, charts and publications,
 * waste delivered ashore) with its quantity and cost, the port's charges, the call's total, what is
 * left at the destination, the notices due before arrival, and the out-of-date charts and
 * publications with when each is first needed. Every number is a fact chip; the UI derives none.
 */
import type { PortCallResult, RoutePlanView } from "@pharos/shared";
import type { ReactNode } from "react";
import { StateFlag } from "@/components/primitives/state-flag";
import { FactCell } from "./fact-cell";
import { factAtPath } from "./route-facts";

const JOB_TERM: Record<PortCallResult["jobs"][number]["kind"], string> = {
  provisions: "Provisions",
  charts: "Charts and publications",
  sludge: "Sludge delivered ashore",
  sewage: "Sewage delivered ashore",
};
const JOB_UNIT: Record<PortCallResult["jobs"][number]["kind"], string> = {
  provisions: " person-days",
  charts: " items",
  sludge: "",
  sewage: "",
};
const NOTICE_TERM: Record<PortCallResult["notices"][number]["kind"], string> = {
  agent_appointment: "Agent appointment due",
  security_pre_arrival: "Security pre-arrival information due",
  eu_waste_notification: "EU advance waste notification due",
};

function Row({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line px-2 last:border-b-0">
      <dt className="text-text-2">{term}</dt>
      <dd className="text-right text-text-1 tabular-nums">{children}</dd>
    </div>
  );
}

export function PortCallBlock({
  plan,
  index,
  destination,
}: {
  plan: RoutePlanView;
  index: number;
  destination: string;
}) {
  const call = plan.result.stopPlans[index]?.portCall;
  if (!call) return null;
  const fact = (sub: string) => factAtPath(plan.facts, `stopPlans[${index}].portCall.${sub}`);
  const charges = call.costLines
    .map((l, k) => ({ l, k }))
    .filter(({ l }) => l.kind === "port_dues" || l.kind === "eu_waste_fee");
  return (
    <section data-testid="port-call" aria-label="Port call" className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-text-1">Port call, alongside the bunkering</h4>
      <dl className="grid border border-line text-xs">
        {call.jobs.map((j, k) =>
          j.needed ? (
            <Row key={j.kind} term={JOB_TERM[j.kind]}>
              <span data-testid={`port-call-${j.kind}`}>
                {j.done ? (
                  <>
                    <FactCell fact={fact(`jobs[${k}].qty`)} />
                    <span className="text-text-2">{JOB_UNIT[j.kind]}, </span>
                    <FactCell fact={fact(`jobs[${k}].costUsd`)} />
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-alarm">
                    <StateFlag kind="V" /> not at this port
                  </span>
                )}
              </span>
            </Row>
          ) : null,
        )}
        {charges.map(({ l, k }) => (
          <Row
            key={l.kind}
            term={l.kind === "port_dues" ? "Port dues, agency, pilotage" : "EU waste fee"}
          >
            <FactCell fact={fact(`costLines[${k}].usd`)} />
          </Row>
        ))}
        <Row term="Port call total">
          <FactCell fact={fact("extraCostUsd")} metric="port-call-total" />
        </Row>
        <Row term={`Provisions left at ${destination}`}>
          <FactCell fact={fact("provisionsDaysAtEta")} />
        </Row>
        <Row term={`Sludge on board at ${destination}`}>
          <FactCell fact={fact("sludgeM3AtEta")} />
        </Row>
      </dl>
      {call.notices.length > 0 ? (
        <dl className="grid border border-line text-xs" aria-label="Notices before arrival">
          {call.notices.map((n, k) => (
            <Row key={n.kind} term={NOTICE_TERM[n.kind]}>
              <FactCell fact={fact(`notices[${k}].dueAt`)} kind="time" />
            </Row>
          ))}
        </dl>
      ) : null}
      {call.outdated.length > 0 ? (
        <dl
          className="grid border border-line text-xs"
          aria-label="Charts and publications out of date"
        >
          {call.outdated.map((o, k) => (
            <Row
              key={o.itemId}
              term={
                <span>
                  <span className="font-mono text-2xs">{o.itemId}</span> {o.title}
                </span>
              }
            >
              <span className="inline-flex items-center gap-1">
                {o.inTime ? null : (
                  <span className="inline-flex items-center gap-1 text-caution">
                    <StateFlag kind="K" /> after it is needed,
                  </span>
                )}
                <span className="text-text-2">needed by</span>
                <FactCell fact={fact(`outdated[${k}].neededAt`)} kind="time" />
              </span>
            </Row>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
