import type { Fact, RoutePlanView } from "@pharos/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makePlan } from "./map-fixtures";
import { SecurityBlock, SuezOrCape } from "./security-block";

afterEach(cleanup);

const calc = (path: string, value: number | string, unit: string | null): Fact => ({
  id: `f_${path}`,
  label: path,
  value,
  unit,
  provenance: { source: "calculation", calculationId: 1, calculator: "route_speed", path },
});

/** Route B through Suez with a team; route C stands in for the Cape as candidate K. */
function securePlan(): RoutePlanView {
  const plan = { ...makePlan(), computeMs: null } as RoutePlanView;
  const b = plan.result.options[1];
  const c = plan.result.options[2];
  if (!b || !c) throw new Error("fixture changed");
  b.security = {
    spans: [{ areaId: "gulf-of-aden", enterNm: 400, exitNm: 760, hoursInside: 34.3 }],
    needsTeam: true,
    quoteId: 7,
    embarkPortId: 1,
    disembarkPortId: 2,
    embarkAt: "2026-11-15T06:00:00.000Z",
    disembarkAt: "2026-11-20T06:00:00.000Z",
    teamDays: 6,
    costLines: [
      { kind: "security_team", usd: 14000 },
      { kind: "canal_dues", usd: 300000 },
    ],
    extraCostUsd: 314000,
    convoyWaitHours: 5.8,
  };
  c.candidateId = "K";
  plan.result.bestCandidateId = "B";
  plan.facts.push(
    calc("options[1].security.spans[0].hoursInside", 34.3, "h"),
    calc("options[1].security.teamDays", 6, "days"),
    calc("options[1].security.embarkAt", "2026-11-15T06:00:00.000Z", null),
    calc("options[1].security.costLines[0].usd", 14000, "USD"),
    // costLines[1] (canal dues) has no fact: it must show a dash, not the result's number.
    calc("options[1].security.convoyWaitHours", 5.8, "h"),
  );
  return plan;
}

describe("SecurityBlock", () => {
  it("names the areas and the team, cites every number, and shows a dash for a missing fact", () => {
    const plan = securePlan();
    render(
      <SecurityBlock
        plan={plan}
        index={1}
        names={{
          teams: new Map([
            [
              7,
              {
                provider: "Tridentis Marine Protection",
                embark: "Fujairah",
                disembark: "Djibouti",
              },
            ],
          ]),
          areas: new Map([["gulf-of-aden", "Gulf of Aden"]]),
        }}
      />,
    );
    const block = screen.getByTestId("security-B");
    expect(block.textContent).toContain("Gulf of Aden");
    expect(block.textContent).toContain("Tridentis Marine Protection, Fujairah to Djibouti");
    expect(block.textContent).toContain("Armed team");
    expect(block.textContent).not.toContain("300,000");
    expect(block.textContent).toContain("—");
  });

  it("is absent for a route that crosses no danger area", () => {
    render(<SecurityBlock plan={securePlan()} index={0} />);
    expect(screen.queryByTestId("security-A")).toBeNull();
  });
});

describe("SuezOrCape", () => {
  it("sets the recommended canal route's total beside the Cape route's, both as facts", () => {
    render(<SuezOrCape plan={securePlan()} />);
    const line = screen.getByTestId("suez-or-cape");
    expect(line.textContent).toMatch(/route B through Suez totals/);
    expect(line.textContent).toMatch(/route K round the Cape totals/);
    expect(screen.getByTestId("cell-suez-total").textContent).not.toBe("—");
    expect(screen.getByTestId("cell-cape-total").textContent).not.toBe("—");
  });
});
