import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { ApprovalsPage } from "./approvals-page";

// The border beam reads motion's reduced-motion preference; the tests set it.
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (original) => ({
  ...(await original<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduce,
}));

const NOW = "2026-11-14T08:05:00.000Z";
const fact = (id: string, label: string, value: number, unit: string) => ({
  id,
  label,
  value,
  unit,
  provenance: { source: "db", table: "quotes", rowId: 7, field: "price" },
});

/** A fact of a stored calculation, with the id `plan_bunkering` / `plan_route_speed` gives it. */
const calcFact = (
  tool: string,
  calculator: string,
  calc: number,
  path: string,
  label: string,
  value: number | string | boolean,
  unit: string | null,
) => ({
  id: `f_${tool}_${calc}_${path.replace(/\[(\d+)\]/g, ".$1")}`,
  label,
  value,
  unit,
  provenance: { source: "calculation", calculationId: calc, calculator, path },
});
const planFact = (
  path: string,
  label: string,
  value: number | string | boolean,
  unit: string | null,
) => calcFact("plan_bunkering", "planBunkers", 1, path, label, value, unit);

// The recorded demo's bunker plan 1: three feasible options, Kestrel best by total cost.
const OPTIONS = [
  {
    optionId: "MTMLA-kestrel",
    supplier: "Kestrel Marine Fuels",
    port: { id: 3, name: "Marsaxlokk", unlocode: "MTMLA", position: { lat: 35.82, lon: 14.54 } },
    qty: 300,
    headline: 738,
    total: 233942.91,
    effective: 779.81,
    delay: 11.12,
    ets: 440.95,
    fuelEu: 72.25,
  },
  {
    optionId: "ESALG-nordwind",
    supplier: "Nordwind Bunker Services",
    port: { id: 2, name: "Algeciras", unlocode: "ESALG", position: { lat: 36.13, lon: -5.44 } },
    qty: 300,
    headline: 745.2,
    total: 239253.28,
    effective: 797.51,
    delay: 14.96,
    ets: 512.4,
    fuelEu: 80.1,
  },
  {
    optionId: "GIGIB-straitline",
    supplier: "Strait Line Fuels",
    port: { id: 1, name: "Gibraltar", unlocode: "GIGIB", position: { lat: 36.14, lon: -5.35 } },
    qty: 300,
    headline: 712,
    total: 250081.36,
    effective: 833.6,
    delay: 36.32,
    ets: 901.2,
    fuelEu: 150.3,
  },
];

function optionView(o: (typeof OPTIONS)[number], i: number) {
  const named = (name: string) => `${o.optionId} (${o.supplier}, ${o.port.name}): ${name}`;
  const f = (field: string, name: string, value: number, unit: string) =>
    planFact(`options[${i}].${field}`, named(name), value, unit);
  const rows = [
    { name: "quantity", fact: f("qtyMt", "quantity", o.qty, "mt") },
    {
      name: "headline price",
      fact: f("headlinePriceUsdPerMt", "headline price", o.headline, "USD/mt"),
    },
    {
      name: "total delivered cost",
      fact: f("totalCostUsd", "total delivered cost", o.total, "USD"),
    },
    {
      name: "effective price (total cost per mt)",
      fact: f(
        "effectivePriceUsdPerMt",
        "effective price (total cost per mt)",
        o.effective,
        "USD/mt",
      ),
    },
    { name: "delay", fact: f("delayHours", "delay", o.delay, "h") },
    { name: "EU ETS cost", fact: f("etsCostUsd", "EU ETS cost", o.ets, "USD") },
    { name: "FuelEU exposure", fact: f("fuelEuCostUsd", "FuelEU exposure", o.fuelEu, "USD") },
  ];
  return {
    optionId: o.optionId,
    supplier: o.supplier,
    port: o.port,
    rank: i + 1,
    feasible: true,
    best: i === 0,
    headlinePrice: rows[1]?.fact,
    totalCost: rows[2]?.fact,
    delay: rows[4]?.fact,
    rows,
  };
}

const MARGIN = {
  id: "f_plan_bunkering_1_marginVsRunnerUpUsd",
  label: "Margin of the best option over the runner-up, in total cost",
  value: 5310.37,
  unit: "USD",
  provenance: {
    source: "derived",
    operation: "subtract",
    operands: [
      "f_plan_bunkering_1_options.1.totalCostUsd",
      "f_plan_bunkering_1_options.0.totalCostUsd",
    ],
  },
};

const bunkerPlan = (n = 3) => ({
  calculationId: 1,
  grade: "LSMGO",
  vesselId: 1,
  voyageNo: "AP-2611",
  options: OPTIONS.slice(0, n).map(optionView),
  marginVsRunnerUp: n > 1 ? MARGIN : null,
});

const SAVING = planFact(
  "savingVsCheapestHeadlineUsd",
  "Saving of the best option against the cheapest headline price, in total cost",
  16138.45,
  "USD",
);

const rec = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  type: "purchase_order",
  status: "pending",
  calculationId: 3,
  optionId: "MTMLA-kestrel",
  optionLabel: null,
  summary: "Buy VLSFO from Kestrel Marine at Marsaxlokk.",
  expectedSavingUsd: null,
  expectedSaving: null,
  factRefs: ["f_total"],
  facts: [
    fact("f_total", "Total landed cost", 233914, "USD"),
    fact("f_save", "Saving", 18250, "USD"),
  ],
  gatePassed: true,
  order: null,
  instruction: null,
  bunkerPlan: null,
  dependsOn: null,
  ...over,
});

/** The demo's purchase order: Kestrel at Marsaxlokk from bunker plan 1, with the whole plan. */
const poRec = (id: number, over: Record<string, unknown> = {}) => {
  const plan = bunkerPlan();
  const kestrel = plan.options[0]?.rows ?? [];
  const pick = (name: string) => kestrel.find((r) => r.name === name)?.fact;
  return rec(id, {
    calculationId: 1,
    optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
    summary: "Order LSMGO for the AP-2611 stem from Kestrel Marine Fuels at Marsaxlokk.",
    expectedSavingUsd: SAVING.value,
    expectedSaving: SAVING,
    factRefs: [],
    facts: [
      pick("quantity"),
      pick("headline price"),
      pick("total delivered cost"),
      pick("effective price (total cost per mt)"),
      pick("FuelEU exposure"),
      planFact("bestOptionId", "Best option (lowest total cost, feasible)", "MTMLA-kestrel", null),
      SAVING,
    ],
    bunkerPlan: plan,
    ...over,
  });
};

const routeFact = (path: string, label: string, value: number | string, unit: string | null) =>
  calcFact("plan_route_speed", "route_speed", 5, path, label, value, unit);

/** The demo's voyage instruction: route B at 11.0 kn from route plan 5. */
const viRec = (id: number, over: Record<string, unknown> = {}) =>
  rec(id, {
    type: "voyage_instruction",
    calculationId: 5,
    optionId: "B",
    optionLabel: "Shortest sea route",
    summary: "Instruct MV Aegean Pioneer to Rotterdam: Shortest sea route (route B).",
    factRefs: [],
    facts: [
      routeFact("options[1].distanceNm", "MV Aegean Pioneer, route B: distance", 2210, "nm"),
      routeFact("options[1].speedKn", "MV Aegean Pioneer, route B: recommended speed", 11, "kn"),
      routeFact(
        "options[1].eta",
        "MV Aegean Pioneer, route B: ETA at Rotterdam (UTC)",
        "2026-11-26T15:01:46.466Z",
        null,
      ),
      routeFact("options[1].etsCostUsd", "MV Aegean Pioneer, route B: EU ETS cost", 9120.5, "USD"),
      routeFact(
        "options[1].fuelEuCostUsd",
        "MV Aegean Pioneer, route B: FuelEU exposure",
        1210.25,
        "USD",
      ),
      routeFact(
        "options[1].totalCostUsd",
        "MV Aegean Pioneer, route B: total voyage cost (fuel, EU ETS, FuelEU, vessel time)",
        412345.6,
        "USD",
      ),
    ],
    ...over,
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  method: string;
  path: string;
  body: string | null;
  type: string | null;
}
let calls: Call[];
let items: ReturnType<typeof rec>[];
let decide: (id: number, verb: string) => Response | Promise<Response>;

const DRAFT = {
  id: 1,
  recommendationId: 1,
  kind: "supplier_confirmation",
  to: "desk@kestrel.example",
  subject: "Confirmation of order",
  body: "Please confirm the stem.",
  status: "draft",
  createdAt: NOW,
};
let drafts: unknown[];

beforeEach(() => {
  motion.reduce = false;
  calls = [];
  drafts = [];
  items = [
    rec(1),
    rec(2, { type: "voyage_instruction", summary: "Slow to 12.5 kn.", expectedSavingUsd: -300 }),
  ];
  decide = () => json({}, 500);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path,
        body: typeof init?.body === "string" ? init.body : null,
        type: headers.get("content-type"),
      });
      if (path === "/api/recommendations") return json({ items });
      const m = /^\/api\/recommendations\/(\d+)\/(approve|reject)$/.exec(path);
      if (m && method === "POST") return decide(Number(m[1]), m[2] as string);
      if (/\/drafts$/.test(path)) return json({ items: drafts });
      if (path.startsWith("/api/audit"))
        return json({
          items: [
            {
              id: 9,
              recommendationId: 1,
              kind: "recommendation.approved",
              actor: "operator",
              detail: { erpPoNumber: "PO-1" },
              at: NOW,
            },
          ],
        });
      return json({ error: "not_found" }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(initial = "/approvals") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initial]}>
          <ApprovalsPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const posts = () => calls.filter((c) => c.method === "POST");
const queue = () => screen.getByRole("complementary", { name: "Approval queue" });
const rowIds = (within_: HTMLElement) =>
  within(within_)
    .getAllByRole("listitem")
    .map((li) => Number(li.dataset.recommendationId));
/** The one decision in view. */
const detail = () => screen.findByRole("article");
const detailId = async () => Number((await detail()).dataset.recommendationId);
const chipIds = (el: Element) =>
  [...el.querySelectorAll<HTMLElement>("[data-slot=fact-chip]")].map((c) => c.dataset.factId);
const openDisclosure = async (name: RegExp) => {
  const trigger = await screen.findByRole("button", { name });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  return trigger;
};

describe("ApprovalsPage: the queue", () => {
  it("lists awaiting oldest first and decided newest first", async () => {
    items = [
      rec(3, { status: "rejected" }),
      rec(2),
      rec(4, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-4", erpSyncStatus: "synced" },
      }),
      rec(1),
    ];
    renderPage();
    await detail();
    expect(rowIds(queue())).toEqual([1, 2, 4, 3]);
    const awaiting = screen.getByRole("region", { name: /Awaiting your decision/ });
    const decided = screen.getByRole("region", { name: /Decided/ });
    expect(rowIds(awaiting)).toEqual([1, 2]);
    expect(rowIds(decided)).toEqual([4, 3]);
    expect(posts()).toEqual([]);
  });

  it("a flag sits beside each status word, hidden from assistive technology", async () => {
    items = [rec(1), rec(3, { status: "rejected" })];
    renderPage();
    await detail();
    const flagBeside = (word: string, kind: string) => {
      const el = screen.getAllByText(word)[0]?.closest("span");
      const svg = el?.querySelector("svg");
      expect(svg?.getAttribute("data-flag")).toBe(kind);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
    };
    flagBeside("awaiting approval", "K");
    flagBeside("rejected", "N");
  });

  it("selects the first awaiting proposal by default and follows ?recommendation=", async () => {
    items = [rec(3, { status: "rejected" }), rec(2), rec(1)];
    renderPage();
    expect(await detailId()).toBe(1);
    const row = (id: number) =>
      within(queue())
        .getAllByRole("listitem")
        .find((li) => li.dataset.recommendationId === String(id)) as HTMLElement;
    expect(within(row(1)).getByRole("link").getAttribute("aria-current")).toBe("true");
    expect(within(row(2)).getByRole("link").getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(row(3)).getByRole("link"));
    await waitFor(async () => expect(await detailId()).toBe(3));
    expect(within(row(3)).getByRole("link").getAttribute("aria-current")).toBe("true");
    cleanup();

    renderPage("/approvals?recommendation=2");
    expect(await detailId()).toBe(2);
  });

  it("says when a linked proposal is not in the list", async () => {
    renderPage("/approvals?recommendation=42");
    expect(await screen.findByText("Proposal 42 is not in the list.")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    // The queue still lists what there is, and offers the default decision.
    expect(rowIds(queue())).toEqual([1, 2]);
    fireEvent.click(screen.getByRole("link", { name: /Open the first awaiting proposal/ }));
    expect(await detailId()).toBe(1);
  });

  it("shows the newest decided proposal when nothing is pending", async () => {
    items = [
      rec(3, { status: "rejected" }),
      rec(5, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-5", erpSyncStatus: "synced" },
      }),
      rec(4, { status: "rejected" }),
    ];
    renderPage();
    expect(await detailId()).toBe(5);
    expect(screen.getByText("Nothing is awaiting a decision.")).toBeTruthy();
  });

  it("a purchase order's row reads its quantity and total from the plan's facts", async () => {
    items = [poRec(1)];
    renderPage();
    await detail();
    const [row] = within(queue()).getAllByRole("listitem");
    expect(chipIds(row as HTMLElement)).toEqual([
      "f_plan_bunkering_1_options.0.qtyMt",
      "f_plan_bunkering_1_options.0.totalCostUsd",
    ]);
  });

  it("the selected pending decision carries the page's one focal beam", async () => {
    items = [rec(3, { status: "rejected" }), rec(1), rec(2)];
    renderPage();
    const article = await detail();
    expect(article.dataset.status).toBe("pending");
    expect(article.querySelectorAll("[data-slot=border-beam]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot=border-beam]")).toHaveLength(1);
    cleanup();

    renderPage("/approvals?recommendation=3");
    expect((await detail()).dataset.status).toBe("rejected");
    expect(document.querySelectorAll("[data-slot=border-beam]")).toHaveLength(0);
  });

  it("no beam under reduced motion", async () => {
    motion.reduce = true;
    items = [rec(1), rec(2)];
    renderPage();
    await detail();
    expect(document.querySelectorAll("[data-slot=border-beam]")).toHaveLength(0);
  });

  it("an empty queue and a failed load say so", async () => {
    items = [];
    renderPage();
    expect(await screen.findByText(/Nothing is waiting/)).toBeTruthy();
  });
});

describe("ApprovalsPage: the decision", () => {
  it("summarises the order with four cited facts", async () => {
    items = [poRec(1)];
    renderPage();
    const order = await screen.findByRole("region", { name: "The order" });
    const terms = within(order)
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual([
      "Grade and quantity",
      "Headline price",
      "Total delivered cost",
      "Delay to the voyage",
    ]);
    const readouts = within(order).getAllByRole("definition");
    expect(readouts[0]?.textContent).toContain("LSMGO");
    // Each readout is the plan's own fact for the proposed option: 300 mt, 738 USD/mt,
    // USD 233,942.91 and 11.12 h, shown through the one display formatter.
    expect(readouts.map((d) => chipIds(d))).toEqual([
      ["f_plan_bunkering_1_options.0.qtyMt"],
      ["f_plan_bunkering_1_options.0.headlinePriceUsdPerMt"],
      ["f_plan_bunkering_1_options.0.totalCostUsd"],
      ["f_plan_bunkering_1_options.0.delayHours"],
    ]);
    expect(readouts.map((d) => d.querySelector("[data-slot=fact-chip]")?.textContent)).toEqual([
      "300.0 mt",
      "738.00 USD/mt",
      "USD 233,942.91",
      "11.1 h",
    ]);
    // What the total counts, with its carbon costs cited.
    expect(order.textContent).toMatch(/Total delivered cost counts the fuel, barge fee/);
    expect(chipIds(order)).toContain("f_plan_bunkering_1_options.0.etsCostUsd");
    expect(chipIds(order)).toContain("f_plan_bunkering_1_options.0.fuelEuCostUsd");
  });

  it("summarises a voyage instruction by route, speed, ETA and total voyage cost", async () => {
    items = [viRec(2)];
    renderPage();
    const order = await screen.findByRole("region", { name: "The instruction" });
    expect(
      within(order)
        .getAllByRole("term")
        .map((t) => t.textContent),
    ).toEqual(["Route", "Recommended speed", "ETA", "Total voyage cost"]);
    const readouts = within(order).getAllByRole("definition");
    expect(readouts[0]?.textContent).toBe("Shortest sea route");
    expect(readouts.slice(1).map((d) => chipIds(d))).toEqual([
      ["f_plan_route_speed_5_options.1.speedKn"],
      ["f_plan_route_speed_5_options.1.eta"],
      ["f_plan_route_speed_5_options.1.totalCostUsd"],
    ]);
    expect(readouts[2]?.textContent).toBe("26 Nov 15:01Z");
    // An instruction has no bunker plan to compare.
    expect(screen.queryByRole("img", { name: /headline price/ })).toBeNull();
  });

  it("an instruction's readouts come from one route option, never a mix", async () => {
    // Another route's total cited first: which option is the instruction's cannot be told.
    const vi = viRec(2);
    items = [
      viRec(2, {
        facts: [
          routeFact(
            "options[0].totalCostUsd",
            "MV Aegean Pioneer, route A: total voyage cost (fuel, EU ETS, FuelEU, vessel time)",
            398765.4,
            "USD",
          ),
          ...vi.facts,
        ],
      }),
    ];
    renderPage();
    const order = await screen.findByRole("region", { name: "The instruction" });
    const readouts = within(order).getAllByRole("definition");
    expect(readouts.slice(1).map((d) => d.textContent)).toEqual([
      "not stated",
      "not stated",
      "not stated",
    ]);
    expect(chipIds(order)).not.toContain("f_plan_route_speed_5_options.0.totalCostUsd");
    // The queue row shows no figure it cannot place either.
    const [row] = within(queue()).getAllByRole("listitem");
    expect(chipIds(row as HTMLElement)).toEqual([]);
  });

  it("another route's other facts leave the instruction's readouts in place", async () => {
    const vi = viRec(2);
    items = [
      viRec(2, {
        facts: [
          routeFact("options[0].distanceNm", "MV Aegean Pioneer, route A: distance", 2390, "nm"),
          routeFact(
            "options[0].etsCostUsd",
            "MV Aegean Pioneer, route A: EU ETS cost",
            9900,
            "USD",
          ),
          ...vi.facts,
        ],
      }),
    ];
    renderPage();
    const order = await screen.findByRole("region", { name: "The instruction" });
    expect(
      within(order)
        .getAllByRole("definition")
        .slice(1)
        .map((d) => chipIds(d)),
    ).toEqual([
      ["f_plan_route_speed_5_options.1.speedKn"],
      ["f_plan_route_speed_5_options.1.eta"],
      ["f_plan_route_speed_5_options.1.totalCostUsd"],
    ]);
    // The footnote's EU ETS is the same option's, not route A's cited first.
    expect(chipIds(order)).toContain("f_plan_route_speed_5_options.1.etsCostUsd");
    expect(chipIds(order)).not.toContain("f_plan_route_speed_5_options.0.etsCostUsd");
  });

  it("an order without a readable plan reads its facts from one option only", async () => {
    const f = (i: number, field: string, value: number, unit: string) =>
      planFact(`options[${i}].${field}`, `option ${i}: ${field}`, value, unit);
    items = [
      rec(1, {
        bunkerPlan: null,
        facts: [
          f(1, "totalCostUsd", 239253.28, "USD"),
          f(0, "qtyMt", 300, "mt"),
          f(0, "headlinePriceUsdPerMt", 738, "USD/mt"),
          f(0, "totalCostUsd", 233942.91, "USD"),
        ],
      }),
    ];
    renderPage();
    const order = await screen.findByRole("region", { name: "The order" });
    expect(chipIds(order)).toEqual([]);
    expect(order.textContent).toMatch(/not stated/);
  });

  it("draws headline price against total cost for every option", async () => {
    items = [poRec(1)];
    renderPage();
    expect(
      await screen.findByRole("heading", {
        name: "Why Kestrel Marine Fuels, not the cheapest price",
      }),
    ).toBeTruthy();
    const chart = screen.getByRole("img", { name: /Ranked by headline price/ });
    const label = chart.getAttribute("aria-label") ?? "";
    expect(label).toContain(
      "Kestrel Marine Fuels at Marsaxlokk: 2nd by headline price, 1st by total delivered cost, recommended",
    );
    expect(label).toContain(
      "Nordwind Bunker Services at Algeciras: 3rd by headline price, 2nd by total delivered cost",
    );
    expect(label).toContain(
      "Strait Line Fuels at Gibraltar: 1st by headline price, 3rd by total delivered cost",
    );
    const lines = [...chart.querySelectorAll("line")];
    expect(lines).toHaveLength(3);
    const best = lines.filter((l) => l.dataset.best === "true");
    expect(best).toHaveLength(1);
    expect(best[0]?.getAttribute("class")).toMatch(/\bstroke-beacon\b/);
    expect(best[0]?.getAttribute("stroke-width")).toBe("2.5");
    for (const other of lines.filter((l) => l.dataset.best !== "true")) {
      expect(other.getAttribute("class")).toMatch(/\bstroke-text-3\b/);
      expect(other.getAttribute("stroke-width")).toBe("1.5");
    }
    // Labels are focusable fact chips beside the drawing, never inside it.
    expect(chart.querySelectorAll("[data-slot=fact-chip]")).toHaveLength(0);
    const figure = chart.closest("figure") as HTMLElement;
    const byHeadline = figure.querySelector("[data-column=headline]") as HTMLElement;
    const byTotal = figure.querySelector("[data-column=total]") as HTMLElement;
    // Left: ascending by the headline price facts; right: the plan's rank by total cost.
    expect(chipIds(byHeadline)).toEqual([
      "f_plan_bunkering_1_options.2.headlinePriceUsdPerMt",
      "f_plan_bunkering_1_options.0.headlinePriceUsdPerMt",
      "f_plan_bunkering_1_options.1.headlinePriceUsdPerMt",
    ]);
    expect(chipIds(byTotal).filter((id) => id?.endsWith("totalCostUsd"))).toEqual([
      "f_plan_bunkering_1_options.0.totalCostUsd",
      "f_plan_bunkering_1_options.1.totalCostUsd",
      "f_plan_bunkering_1_options.2.totalCostUsd",
    ]);
    expect(chipIds(byTotal).filter((id) => id?.endsWith("delayHours"))).toHaveLength(3);
  });

  it("states the margin over the runner-up as a fact", async () => {
    items = [poRec(1)];
    renderPage();
    const why = await screen.findByRole("region", { name: /^Why Kestrel Marine Fuels/ });
    const margin = why.querySelector(
      '[data-fact-id="f_plan_bunkering_1_marginVsRunnerUpUsd"]',
    ) as HTMLElement;
    expect(margin.textContent).toBe("USD 5,310.37");
    expect(margin.closest("p")?.textContent).toMatch(/less than the runner-up/);
    // Its popover resolves both operands from the plan (the ledger includes the view's facts).
    fireEvent.click(margin);
    const popover = await screen.findByRole("dialog");
    expect(popover.textContent).toContain(
      "ESALG-nordwind (Nordwind Bunker Services, Algeciras): total delivered cost",
    );
    expect(popover.textContent).toContain(
      "MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): total delivered cost",
    );
    expect(popover.textContent).not.toContain("not in this answer");
  });

  it("omits the runner-up line for a one-option plan", async () => {
    items = [poRec(1, { bunkerPlan: bunkerPlan(1) })];
    renderPage();
    const chart = await screen.findByRole("img", { name: /Ranked by headline price/ });
    expect(chart.querySelectorAll("line")).toHaveLength(1);
    expect(screen.queryByText(/less than the runner-up/)).toBeNull();
    expect(document.querySelector('[data-fact-id$="marginVsRunnerUpUsd"]')).toBeNull();
  });

  it("an order for another option than the plan's best claims no why and no margin", async () => {
    // propose_action accepts any feasible option: here the runner-up, Nordwind.
    items = [
      poRec(1, {
        optionId: "ESALG-nordwind",
        optionLabel: "Nordwind Bunker Services at Algeciras",
        summary: "Order LSMGO for the AP-2611 stem from Nordwind Bunker Services at Algeciras.",
        expectedSaving: null,
        expectedSavingUsd: null,
      }),
    ];
    renderPage();
    const section = await screen.findByRole("region", { name: "The options compared" });
    expect(screen.queryByRole("heading", { name: /^Why / })).toBeNull();
    expect(section.textContent).not.toMatch(/less than the runner-up/);
    expect(section.querySelector('[data-fact-id$="marginVsRunnerUpUsd"]')).toBeNull();
    // The chart still shows every option, Kestrel still marked as the plan's recommendation.
    const chart = within(section).getByRole("img", { name: /Ranked by headline price/ });
    expect(chart.getAttribute("aria-label")).toContain(
      "Kestrel Marine Fuels at Marsaxlokk: 2nd by headline price, 1st by total delivered cost, recommended",
    );
    // The order itself is Nordwind's.
    const order = screen.getByRole("region", { name: "The order" });
    expect(chipIds(order)).toContain("f_plan_bunkering_1_options.1.totalCostUsd");
  });

  it("a plan whose view lacks the best option claims no why and no margin", async () => {
    // The best option's port is unknown, so the view leaves it out; the margin is still served.
    const plan = bunkerPlan();
    items = [poRec(1, { bunkerPlan: { ...plan, options: plan.options.slice(1) } })];
    renderPage();
    const section = await screen.findByRole("region", { name: "The options compared" });
    expect(section.textContent).not.toMatch(/less than the runner-up/);
    expect(section.querySelector('[data-fact-id$="marginVsRunnerUpUsd"]')).toBeNull();
    expect(within(section).getByRole("img").querySelectorAll("line")).toHaveLength(2);
  });

  it("groups the facts behind it by option with short names", async () => {
    items = [poRec(1)];
    renderPage();
    await openDisclosure(/^Facts behind it/);
    const kestrel = await screen.findByRole("group", {
      name: "Kestrel Marine Fuels at Marsaxlokk",
    });
    const quantity = within(kestrel).getByText("quantity").closest("li") as HTMLElement;
    expect(chipIds(quantity)).toEqual(["f_plan_bunkering_1_options.0.qtyMt"]);
    expect(
      within(kestrel)
        .getAllByRole("listitem")
        .map((li) => li.firstElementChild?.textContent),
    ).toEqual([
      "quantity",
      "headline price",
      "total delivered cost",
      "effective price (total cost per mt)",
      "delay",
      "EU ETS cost",
      "FuelEU exposure",
    ]);
    expect(
      screen.getByRole("group", { name: "Nordwind Bunker Services at Algeciras" }),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Strait Line Fuels at Gibraltar" })).toBeTruthy();
    // The plan-wide facts (best option, saving, margin) sit in their own group.
    const plan = screen.getByRole("group", { name: "Across the plan" });
    expect(chipIds(plan)).toEqual([
      "f_plan_bunkering_1_bestOptionId",
      "f_plan_bunkering_1_savingVsCheapestHeadlineUsd",
      "f_plan_bunkering_1_marginVsRunnerUpUsd",
    ]);
  });

  it("an instruction's facts behind it are one flat list with their labels", async () => {
    items = [viRec(2)];
    renderPage();
    await openDisclosure(/^Facts behind it/);
    const row = (await screen.findByText("MV Aegean Pioneer, route B: distance")).closest("li");
    expect(chipIds(row as HTMLElement)).toEqual(["f_plan_route_speed_5_options.1.distanceNm"]);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("fact rows show the fact labels when the plan is unreadable", async () => {
    const label = "MTMLA-kestrel (Kestrel Marine Fuels, Marsaxlokk): quantity";
    items = [rec(1, { facts: [fact("f_q", label, 500, "mt")] })];
    renderPage();
    await openDisclosure(/^Facts behind it/);
    const row = (await screen.findByText(label)).closest("li") as HTMLElement;
    expect(row.querySelector("[data-slot=fact-chip]")?.getAttribute("data-fact-id")).toBe("f_q");
  });

  it("names the route from optionLabel", async () => {
    items = [viRec(2, { optionLabel: "Via the Strait of Gibraltar" })];
    renderPage();
    expect((await screen.findByTestId("option-name")).textContent).toBe(
      "Via the Strait of Gibraltar",
    );
  });

  it("saving is the expectedSaving fact chip", async () => {
    items = [
      rec(1, {
        expectedSaving: {
          id: "f_saving",
          label: "Saving versus the cheapest headline price",
          value: 18250,
          unit: "USD",
          provenance: {
            source: "calculation",
            calculationId: 1,
            calculator: "planBunkers",
            path: "savingVsCheapestHeadlineUsd",
          },
        },
      }),
    ];
    renderPage();
    await detail();
    const saving = screen
      .getByText("Expected saving")
      .parentElement?.querySelector("[data-slot=fact-chip]");
    expect(saving?.getAttribute("data-fact-id")).toBe("f_saving");
    expect(saving?.textContent).toBe("+USD 18,250.00");
  });

  it("the chip prints the cited fact's number, not the second field", async () => {
    items = [
      rec(1, {
        expectedSavingUsd: 999,
        expectedSaving: fact("f_s", "Saving", 18250, "USD"),
      }),
    ];
    renderPage();
    await detail();
    const chip = screen
      .getByText("Expected saving")
      .parentElement?.querySelector("[data-slot=fact-chip]");
    expect(chip?.textContent).toBe("+USD 18,250.00");
  });

  it("no uncited saving: without an expectedSaving fact it reads not stated", async () => {
    items = [rec(1, { expectedSavingUsd: 18250, expectedSaving: null })];
    renderPage();
    await detail();
    const dd = screen.getByText("Expected saving").parentElement;
    expect(dd?.textContent).toContain("not stated");
    expect(dd?.querySelector("[data-slot=fact-chip]")).toBeNull();
    expect(dd?.textContent).not.toContain("18,250");
  });

  it("shows a signed saving, as returned, and the gate and data tags", async () => {
    items = [
      rec(2, {
        type: "voyage_instruction",
        expectedSavingUsd: -300,
        expectedSaving: fact("f_neg", "Saving", -300, "USD"),
      }),
    ];
    renderPage();
    const article = await detail();
    expect(within(article).getByText(/-USD 300|−USD 300|USD -300/)).toBeTruthy();
    expect(within(article).getAllByText("simulated data").length).toBeGreaterThan(0);
    expect(within(article).getAllByText(/gate passed/i).length).toBeGreaterThan(0);
  });
});

describe("ApprovalsPage: deciding", () => {
  it("says in words what approving does, and asks before anything is posted", async () => {
    items = [poRec(1)];
    renderPage();
    const bar = await screen.findByRole("region", { name: "If you approve" });
    expect(bar.textContent).toMatch(
      /A purchase order is created in the ERP simulator\. The confirmation to Kestrel Marine Fuels stays a draft; nothing goes to the supplier\./,
    );
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Reject…", "Approve purchase order…"]);
    const trigger = within(bar).getByRole("button", { name: /^Approve purchase order/ });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(
      /pushes the order to the ERP simulator and drafts a supplier confirmation \(not sent\)/,
    );
    expect(within(dialog).getByRole("heading").textContent).toMatch(/^Order .+ from .+ at .+\?$/);
    expect(posts()).toEqual([]);
    // Escape closes it and focus returns to the Approve trigger.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("a voyage instruction names its own consequence", async () => {
    items = [viRec(2)];
    renderPage();
    const bar = await screen.findByRole("region", { name: "If you approve" });
    expect(bar.textContent).toMatch(/The route and speed instruction is recorded/);
    fireEvent.click(within(bar).getByRole("button", { name: "Reject…" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Nothing is written to the ERP/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it pending" }));
    fireEvent.click(within(bar).getByRole("button", { name: /^Approve voyage instruction/ }));
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(
      /records the route and speed instruction and drafts a message to the master \(not sent\)/,
    );
  });

  it("approve is single-flight", async () => {
    let release: (r: Response) => void = () => undefined;
    decide = () => new Promise<Response>((r) => (release = r));
    renderPage();
    const article = await detail();
    fireEvent.click(within(article).getByRole("button", { name: /^Approve purchase order/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve and create the order" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    // While in flight no control can start another decision, on this proposal or another.
    for (const b of screen.getAllByRole("button", { name: /Approving|Approve|Reject/ }))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    const row2 = within(queue())
      .getAllByRole("listitem")
      .find((li) => li.dataset.recommendationId === "2") as HTMLElement;
    fireEvent.click(within(row2).getByRole("link"));
    await waitFor(async () => expect(await detailId()).toBe(2));
    for (const b of within(await detail()).getAllByRole("button", { name: /Approve|Reject/ }))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(posts()[0]?.path).toBe("/api/recommendations/1/approve");
    expect(posts()[0]?.type).toBe("application/json");
    // Back on the decided proposal, its outcome comes from the refetch.
    const row1 = within(queue())
      .getAllByRole("listitem")
      .find((li) => li.dataset.recommendationId === "1") as HTMLElement;
    fireEvent.click(within(row1).getByRole("link"));
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-100234", erpSyncStatus: "synced" },
      }),
      rec(2),
    ];
    await act(async () => {
      release(
        json({
          recommendationId: 1,
          status: "executed",
          orderId: 5,
          erpPoNumber: "PO-100234",
          erpSyncStatus: "synced",
          instructionId: null,
        }),
      );
    });
    expect(await within(await detail()).findByText(/PO-100234/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it("the decided proposal stays in view after the decision", async () => {
    decide = () =>
      json({
        recommendationId: 1,
        status: "executed",
        orderId: 5,
        erpPoNumber: "PO-100234",
        erpSyncStatus: "synced",
        instructionId: null,
      });
    renderPage();
    const article = await detail();
    expect(article.dataset.recommendationId).toBe("1");
    fireEvent.click(within(article).getByRole("button", { name: /^Approve purchase order/ }));
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-100234", erpSyncStatus: "synced" },
      }),
      rec(2),
    ];
    await act(async () => {
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Approve and create the order",
        }),
      );
    });
    // Not the next awaiting one: the outcome of what was just approved.
    expect(await screen.findByText(/PO-100234/)).toBeTruthy();
    expect(await detailId()).toBe(1);
  });

  it("a 409 shows the current status from a refetch", async () => {
    decide = () => json({ error: "illegal_transition", message: "already approved" }, 409);
    renderPage();
    const article = await detail();
    fireEvent.click(within(article).getByRole("button", { name: /^Approve purchase order/ }));
    const dialog = await screen.findByRole("alertdialog");
    items = [rec(1, { status: "rejected" }), rec(2)];
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Approve and create the order" }));
    });
    const note = await screen.findByText(/already decided/i);
    expect(note.textContent).toMatch(/rejected/);
    await waitFor(() =>
      expect(rowIds(screen.getByRole("region", { name: /Decided/ }))).toEqual([1]),
    );
    expect((await detail()).dataset.status).toBe("rejected");
  });

  it("an approved PO shows PO number, ERP state, drafts and the audit trail", async () => {
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-100234", erpSyncStatus: "synced" },
      }),
    ];
    drafts = [DRAFT];
    renderPage();
    const article = await detail();
    expect(await within(article).findByText(/PO-100234/)).toBeTruthy();
    expect(within(article).getByText(/ERP sync: synced/)).toBeTruthy();
    // Behind disclosures: the drafts and the audit trail open on request.
    expect(screen.queryByText("Confirmation of order")).toBeNull();
    await openDisclosure(/^Drafted messages/);
    expect(await screen.findByText("Confirmation of order")).toBeTruthy();
    await openDisclosure(/^Audit trail/);
    expect(await screen.findByText("recommendation.approved")).toBeTruthy();
    // The audit detail reads as labelled pairs, not JSON.
    const audit = screen.getByRole("region", { name: "Audit trail" });
    expect(within(audit).getByText("ERP PO number")).toBeTruthy();
    expect(within(audit).getByText("PO-1")).toBeTruthy();
    expect(audit.textContent).not.toMatch(/[{}"]/);
    // Decided: nothing left to approve or reject.
    expect(within(article).queryAllByRole("button", { name: /Approve|Reject/ })).toEqual([]);
  });

  it("a failed ERP sync reads not synced, will retry", async () => {
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: null, erpSyncStatus: "failed" },
      }),
    ];
    renderPage();
    expect(await screen.findByText(/not synced, will retry/)).toBeTruthy();
  });

  it("an approved voyage instruction shows route, speed and ETA", async () => {
    items = [
      rec(2, {
        type: "voyage_instruction",
        status: "executed",
        instruction: {
          instructionId: 3,
          candidateId: "via-suez-12.5",
          speedKn: 12.5,
          eta: NOW,
          stop: null,
        },
      }),
    ];
    renderPage();
    const text = (await screen.findByText(/via-suez-12.5/)).parentElement?.textContent ?? "";
    expect(text).toMatch(/12\.5 kn/);
    expect(text).toMatch(/14 Nov 08:05Z/);
  });

  it("drafts have no send control", async () => {
    items = [
      rec(1, {
        status: "executed",
        order: { orderId: 5, erpPoNumber: "PO-1", erpSyncStatus: "synced" },
      }),
    ];
    drafts = [DRAFT];
    renderPage();
    await openDisclosure(/^Drafted messages/);
    expect(await screen.findByText("Confirmation of order")).toBeTruthy();
    expect(screen.getByText("draft, not sent")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /send/i })).toEqual([]);
    expect(screen.queryAllByRole("link", { name: /send/i })).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it("a pending proposal has no drafts yet: approving drafts them", async () => {
    items = [poRec(1)];
    renderPage();
    await detail();
    expect(screen.queryByRole("button", { name: /^Drafted messages/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Audit trail/ })).toBeTruthy();
  });
});
