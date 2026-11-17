import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { makeBunkerPlan } from "../map/map-fixtures";
import { AssistantDock, SUGGESTED_QUESTIONS } from "./assistant-dock";
import { resetAssistant } from "./assistant-store";

const gate = { passed: true, repaired: false, ungroundedCount: 0, attempts: [] };
const fact = (id: string, value: number, unit: string, extra: object = {}) => ({
  id,
  label: `Fact ${id}`,
  value,
  unit,
  provenance: { source: "db", table: "quotes", rowId: 7, field: "price" },
  ...extra,
});
const response = (over: Record<string, unknown> = {}) => ({
  conversationId: 5,
  messageId: 11,
  answer: "Kestrel offers USD 612.50 [f_price] per mt.",
  facts: [fact("f_price", 612.5, "USD/mt")],
  recommendationIds: [],
  llmCallIds: [1],
  subjects: [],
  gate,
  ...over,
});

const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;
function sse(frames: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
const progress = (tool: string, phase: "started" | "finished", ms = 0) =>
  frame({ type: "progress", callId: `call-${tool}`, tool, phase, ms });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  path: string;
  method: string;
  body: string | null;
}
let calls: Call[];
let askReply: () => Response;
let health: { llmMode: "live" | "record" | "replay" } | null;
/** Further GETs the test serves, by path. */
let gets: Record<string, () => Response>;

beforeEach(() => {
  resetAssistant();
  calls = [];
  health = null;
  gets = {};
  askReply = () => sse([frame({ type: "answer", response: response() })]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (path === "/api/ask/stream") return askReply();
      if (path === "/api/health")
        return health
          ? json({
              status: "ok",
              db: "up",
              extractModel: "claude-haiku-5-5",
              agentModel: "claude-haiku-5-5",
              ...health,
            })
          : json({ error: "unavailable" }, 503);
      if (path === "/api/vessels")
        return json({
          items: [
            {
              id: 1,
              name: "MV Aegean Pioneer",
              imo: "9480019",
              mmsi: "239000001",
              shipType: "bulk_carrier",
              position: null,
              positionAt: null,
              voyageId: null,
              robMt: { LSMGO: 275, VLSFO: 620, HSFO: 0 },
              alerts: [],
            },
          ],
        });
      const extra = gets[path];
      if (extra) return extra();
      return json({ error: "not_found" }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The address the dock sees, so a test can read where it navigated. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}
const location = () => screen.getByTestId("location").textContent;

function renderDock(path = "/") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <AssistantDock />
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Ask the assistant"), { target: { value: question } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
}

describe("AssistantDock", () => {
  it("offers the demo questions and asking one posts it with a null conversation first", async () => {
    renderDock();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Where should Aegean Pioneer bunker, and who should we buy from?",
      }),
    );
    await screen.findByText(/Kestrel offers/);
    const post = calls.find((c) => c.path === "/api/ask/stream");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      question: "Where should Aegean Pioneer bunker, and who should we buy from?",
      conversationId: null,
    });
  });

  it("shows tool calls, then the answer with a fact chip that opens its source", async () => {
    askReply = () =>
      sse([
        progress("list_quotes", "started"),
        progress("list_quotes", "finished", 42),
        frame({ type: "answer", response: response() }),
      ]);
    renderDock();
    await ask("Who is cheapest?");
    expect(await screen.findByText("Every number above is a tool fact.")).toBeTruthy();
    // The trace folds once the answer arrives; it can be reopened.
    fireEvent.click(screen.getByText("Ran Supplier quotes"));
    expect(await screen.findByText("Supplier quotes")).toBeTruthy();
    const chip = await screen.findByRole("button", { name: /USD 612.50/ });
    fireEvent.click(chip);
    expect(await screen.findByText("Database record")).toBeTruthy();
  });

  it("a second question keeps the conversation", async () => {
    renderDock();
    await ask("one");
    await screen.findByText(/Kestrel offers/);
    await ask("two");
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/ask/stream")).toHaveLength(2));
    expect(JSON.parse(calls.filter((c) => c.path === "/api/ask/stream")[1]?.body ?? "{}")).toEqual({
      question: "two",
      conversationId: 5,
    });
  });

  it("a withheld answer shows the count and none of its text", async () => {
    askReply = () =>
      sse([
        frame({
          type: "answer",
          response: response({
            answer: null,
            facts: [],
            gate: { passed: false, repaired: false, ungroundedCount: 3, attempts: [] },
          }),
        }),
      ]);
    renderDock();
    await ask("Anything");
    expect(await screen.findByText(/Withheld: 3 numbers had no source/)).toBeTruthy();
    expect(screen.queryByText(/Kestrel offers/)).toBeNull();
  });

  it("a withheld answer that ran a plan neither links to the map nor navigates", async () => {
    askReply = () =>
      sse([
        frame({
          type: "answer",
          response: bunkerResponse({
            answer: null,
            gate: { passed: false, repaired: false, ungroundedCount: 1, attempts: [] },
          }),
        }),
      ]);
    renderDock("/");
    await ask("Where to bunker?");
    expect(await screen.findByText(/Withheld: 1 number had no source/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Show on map/ })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(location()).toBe("/");
  });

  it("a repaired answer says so", async () => {
    askReply = () =>
      sse([
        frame({
          type: "answer",
          response: response({ gate: { ...gate, repaired: true } }),
        }),
      ]);
    renderDock();
    await ask("Anything");
    expect(
      await screen.findByText("Repaired once; every number above is a tool fact."),
    ).toBeTruthy();
  });

  it("a dropped stream ends in an error row with a retry", async () => {
    askReply = () => sse([progress("list_quotes", "started")]);
    renderDock();
    await ask("Who is cheapest?");
    const row = await screen.findByRole("alert");
    expect(row.textContent).toMatch(/ended before an answer arrived/);
    askReply = () => sse([frame({ type: "answer", response: response() })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByText(/Kestrel offers/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a replay miss (HTTP 500 or stream event) shows an operator sentence, never the key or path", async () => {
    const developer =
      "LLM replay miss: no recording for request key 3fa9 at /app/fixtures/llm-recordings/3fa9.json. Re-record it with LLM_MODE=record.";
    askReply = () => json({ error: "replay_miss", message: developer }, 500);
    renderDock();
    await ask("Who is cheapest?");
    const row = await screen.findByRole("alert");
    expect(row.textContent).toContain(
      "This question has no recorded reply. Use New conversation at the top of this panel, then pick a suggested question.",
    );
    expect(row.textContent).not.toMatch(/replay_miss|request key|llm-recordings|LLM_MODE/);

    askReply = () => sse([frame({ type: "error", message: `replay_miss: ${developer}` })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    const again = await screen.findByRole("alert");
    expect(again.textContent).toContain("has no recorded reply");
    expect(again.textContent).not.toMatch(/3fa9|LLM_MODE/);
  });

  it("offers exactly the suggested questions (the story's, see suggested-questions.test.ts)", () => {
    renderDock();
    const buttons = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(buttons).toEqual(SUGGESTED_QUESTIONS);
  });

  it("says the model is recorded when the API replays recordings", async () => {
    health = { llmMode: "replay" };
    renderDock();
    const tag = await screen.findByText("model: recorded");
    expect(tag.getAttribute("data-kind")).toBe("model-recorded");
  });

  it("says the model is live when the API calls it, and nothing while health is unknown", async () => {
    health = null;
    const { unmount } = renderDock();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/health")).toBe(true));
    expect(screen.queryByText(/^model:/)).toBeNull();
    unmount();
    health = { llmMode: "live" };
    renderDock();
    expect(await screen.findByText("model: live")).toBeTruthy();
  });

  it("record mode shows model: recording", async () => {
    health = { llmMode: "record" };
    renderDock();
    expect(await screen.findByText("model: recording")).toBeTruthy();
    expect(screen.queryByText("model: live")).toBeNull();
  });

  const speedFact = fact("f_speed", 12.5, "kn", {
    provenance: {
      source: "calculation",
      calculationId: 2,
      calculator: "route_speed",
      path: "options[1].speedKn",
    },
  });
  const routeAnswer = (subjects: unknown[], facts: unknown[] = [speedFact]) => {
    askReply = () =>
      sse([
        progress("plan_route_speed", "started"),
        progress("plan_route_speed", "finished", 90),
        frame({
          type: "answer",
          response: response({
            answer: `MV Aegean Pioneer should sail at 12.5 kn [${(facts[0] as { id: string }).id}].`,
            facts,
            subjects,
          }),
        }),
      ]);
  };

  it("show on map uses the first subject (vessel) and the route plan the answer cited", async () => {
    routeAnswer([
      { kind: "vessel", vesselId: 3 },
      { kind: "ais", mmsi: "123456789" },
    ]);
    renderDock("/approvals");
    await ask("Best route?");
    const link = await screen.findByRole("link", { name: /Show on map/ });
    expect(link.getAttribute("href")).toBe("/?vessel=3&routePlan=2");
    expect(screen.queryByText(/Press Plan route/)).toBeNull();
    fireEvent.click(link);
    expect(location()).toBe("/?vessel=3&routePlan=2");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/api/ask/stream",
    ]);
  });

  it("show on map selects a public AIS ship without its route plan (ruling U5)", async () => {
    routeAnswer([{ kind: "ais", mmsi: "123456789" }]);
    renderDock("/inbox");
    await ask("Best route?");
    const link = await screen.findByRole("link", { name: /Show on map/ });
    expect(link.getAttribute("href")).toBe("/?mmsi=123456789");
  });

  it("an answer that cites no plan and names no subject has no map link and stays put", async () => {
    routeAnswer([], [fact("f_price", 12.5, "kn")]);
    renderDock("/");
    await ask("Best route?");
    await screen.findByText(/Aegean Pioneer should sail/);
    expect(screen.queryByRole("link", { name: /Show on map/ })).toBeNull();
    expect(location()).toBe("/");
  });

  it("on the map, a vessel answer that cites no plan stays put but offers Show on map (ruling T5-a)", async () => {
    askReply = () =>
      sse([
        progress("get_vessel_status", "started"),
        progress("get_vessel_status", "finished", 12),
        frame({
          type: "answer",
          response: response({ subjects: [{ kind: "vessel", vesselId: 1 }] }),
        }),
      ]);
    renderDock("/?vessel=2");
    await ask("How is Aegean Pioneer?");
    const link = await screen.findByRole("link", { name: /Show on map/ });
    expect(link.getAttribute("href")).toBe("/?vessel=1");
    expect(location()).toBe("/?vessel=2");
  });

  it("shows on map every answer with a link, not only route answers", async () => {
    askReply = () =>
      sse([
        progress("get_vessel_status", "started"),
        progress("get_vessel_status", "finished", 12),
        frame({
          type: "answer",
          response: response({ subjects: [{ kind: "vessel", vesselId: 1 }] }),
        }),
      ]);
    renderDock("/inbox");
    await ask("How is Aegean Pioneer?");
    const link = await screen.findByRole("link", { name: /Show on map/ });
    expect(link.getAttribute("href")).toBe("/?vessel=1");
  });

  it("links to a proposal it cannot read yet, and strips bold and headings as text", async () => {
    askReply = () =>
      sse([
        frame({
          type: "answer",
          response: response({
            answer: "## Pick\n**Best:** Kestrel at USD 612.50 [f_price], `LSMGO`.",
            recommendationIds: [4],
          }),
        }),
      ]);
    renderDock("/inbox");
    await ask("Who?");
    // GET /api/recommendations/4 is a 404 here: the card still names the proposal and links to it.
    const card = await screen.findByRole("article", { name: "Proposal 4" });
    const link = within(card).getByRole("link", { name: "Review and decide" });
    expect(link.getAttribute("href")).toBe("/approvals?recommendation=4");
    const turn = screen.getByRole("region", { name: "Question and answer" });
    expect(turn.textContent).toContain("Pick");
    expect(turn.textContent).toContain("Best: Kestrel at USD 612.50, LSMGO.");
    expect(turn.textContent).not.toMatch(/\*\*|##|`/);
    // Markers are stripped, never turned into HTML.
    expect(turn.querySelector("strong, em, h1, h2, h3, code")).toBeNull();
  });

  // ---------- Answers that link and draw their plan (rulings U3, U4, U12) ----------

  const plan = makeBunkerPlan();
  const [kestrel, nordwind, strait] = plan.options as [
    (typeof plan.options)[number],
    (typeof plan.options)[number],
    (typeof plan.options)[number],
  ];
  const BULLETS = [
    `Kestrel's headline price is USD 738 [${kestrel.headlinePrice.id}] per mt, with an 11.12 h [${kestrel.delay.id}] delay.`,
    `Strait Line Fuels at Gibraltar has the cheapest headline price, USD 712 [${strait.headlinePrice.id}] per mt.`,
    `Its total is USD 250,081.36 [${strait.totalCost.id}] because of a 36.32 h [${strait.delay.id}] delay.`,
    `Nordwind Bunker Services at Algeciras ranks second, at USD 239,253.28 [${nordwind.totalCost.id}].`,
  ];
  const bunkerResponse = (over: Record<string, unknown> = {}) =>
    response({
      answer: [
        `Buy the LSMGO for voyage AP-2611 from Kestrel Marine Fuels at Marsaxlokk, at USD 233,942.91 [${kestrel.totalCost.id}].`,
        "",
        ...BULLETS.map((b) => `- ${b}`),
      ].join("\n"),
      facts: plan.options.flatMap((o) => [o.headlinePrice, o.totalCost, o.delay]),
      subjects: [{ kind: "vessel", vesselId: 1 }],
      recommendationIds: [1],
      ...over,
    });
  const recommendation = {
    id: 1,
    type: "purchase_order",
    status: "pending",
    calculationId: 1,
    optionId: "MTMLA-kestrel",
    optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
    summary: "Order LSMGO for the AP-2611 stem from Kestrel Marine Fuels at Marsaxlokk.",
    expectedSavingUsd: null,
    expectedSaving: null,
    factRefs: [],
    facts: [],
    gatePassed: true,
    order: null,
    instruction: null,
    bunkerPlan: null,
  };
  const bunkerAnswer = (over: Record<string, unknown> = {}) => {
    gets["/api/bunker-plans/1"] = () => json(plan);
    gets["/api/recommendations/1"] = () => json(recommendation);
    askReply = () =>
      sse([
        progress("plan_bunkering", "started"),
        progress("plan_bunkering", "finished", 40),
        progress("propose_action", "started"),
        progress("propose_action", "finished", 8),
        frame({ type: "answer", response: bunkerResponse(over) }),
      ]);
  };
  const turnRegion = () => screen.getByRole("region", { name: "Question and answer" });

  it("on the map, an arriving bunker answer navigates to its plan", async () => {
    bunkerAnswer();
    renderDock("/?vessel=2");
    await ask("Where should Aegean Pioneer bunker?");
    await waitFor(() => expect(location()).toBe("/?vessel=1&bunkerPlan=1"));
    // The link is there too, for after the operator moves the map elsewhere.
    const link = await screen.findByRole("link", { name: /Show on map/ });
    expect(link.getAttribute("href")).toBe("/?vessel=1&bunkerPlan=1");
  });

  it("off the map, it only shows the Show on map link", async () => {
    bunkerAnswer();
    renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    const link = await screen.findByRole("link", { name: /Show on map/ });
    expect(link.getAttribute("href")).toBe("/?vessel=1&bunkerPlan=1");
    expect(location()).toBe("/inbox");
  });

  it("a dock opened again does not navigate for an answer it already showed", async () => {
    bunkerAnswer();
    const first = renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    await screen.findByRole("link", { name: /Show on map/ });
    first.unmount();
    renderDock("/");
    await screen.findByRole("link", { name: /Show on map/ });
    expect(location()).toBe("/");
  });

  it("renders Markdown bullets as a list", async () => {
    bunkerAnswer();
    renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    await screen.findByRole("link", { name: /Show on map/ });
    const items = within(turnRegion()).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    // Ruling U12: each item is the model's own line, its citations turned into chips.
    expect(items.map((li) => li.textContent)).toEqual(
      BULLETS.map((b) => b.replace(/ \[f_[^\]]+\]/g, "")),
    );
    expect(items[0]?.querySelectorAll('[data-slot="fact-chip"]')).toHaveLength(2);
    expect(turnRegion().textContent).not.toContain("•");
    // The lead paragraph stays one paragraph, before the list.
    expect(within(turnRegion()).getByText(/Buy the LSMGO for voyage AP-2611/).tagName).toBe("SPAN");
  });

  it("shows the options table for a bunker answer", async () => {
    bunkerAnswer();
    renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    const table = await screen.findByRole("table", { name: "Options compared" });
    const header = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(header).toEqual(["Supplier · port", "USD/mt", "Delay", "Total USD"]);
    const rows = [...table.querySelectorAll("tbody tr")] as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute("data-option"))).toEqual([
      "MTMLA-kestrel",
      "ESALG-nordwind",
      "GIGIB-straitline",
    ]);
    expect(within(rows[0] as HTMLElement).getByText("Recommended").className).toContain(
      "text-beacon",
    );
    expect(rows.filter((r) => r.textContent?.includes("Recommended"))).toHaveLength(1);
    // Every value is a fact chip carrying the plan's own fact (the same ids the answer cites).
    const chips = [...table.querySelectorAll('[data-slot="fact-chip"]')];
    expect(chips.map((c) => c.getAttribute("data-fact-id"))).toEqual(
      plan.options.flatMap((o) => [o.headlinePrice.id, o.delay.id, o.totalCost.id]),
    );
    expect(chips.map((c) => c.textContent)).toEqual([
      "738.00",
      "11.1 h",
      "233,942.91",
      "745.20",
      "15.0 h",
      "239,253.28",
      "712.00",
      "36.3 h",
      "250,081.36",
    ]);
    expect(table.querySelector("number-flow-react, [data-number-flow]")).toBeNull();
    // A GET of the stored plan; nothing is planned again.
    expect(calls.some((c) => c.path === "/api/bunker-plans/1" && c.method === "GET")).toBe(true);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/api/ask/stream",
    ]);
  });

  it("names the tools in the trace header", async () => {
    bunkerAnswer();
    renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    expect(await screen.findByText("Ran Bunker plan, Proposal for approval")).toBeTruthy();
    expect(screen.queryByText(/Checked \d+ source/)).toBeNull();
  });

  it("names each tool once, in call order", async () => {
    const call = (id: string, tool: string, phase: string) =>
      frame({ type: "progress", callId: id, tool, phase, ms: 5 });
    askReply = () =>
      sse([
        call("a", "list_quotes", "started"),
        call("a", "list_quotes", "finished"),
        call("b", "plan_bunkering", "started"),
        call("b", "plan_bunkering", "finished"),
        call("c", "list_quotes", "started"),
        call("c", "list_quotes", "finished"),
        frame({ type: "answer", response: response() }),
      ]);
    renderDock("/inbox");
    await ask("Who is cheapest?");
    expect(await screen.findByText("Ran Supplier quotes, Bunker plan")).toBeTruthy();
  });

  it("shows an inline proposal card", async () => {
    bunkerAnswer();
    renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    const card = await screen.findByRole("article", { name: "Proposal 1" });
    await within(card).findByText(
      (_, el) =>
        el?.tagName === "P" && el.textContent === "Purchase order · awaiting your decision",
    );
    expect(within(card).getByText("awaiting your decision").className).toContain("text-caution");
    expect(
      within(card).getByText(
        "Order LSMGO for the AP-2611 stem from Kestrel Marine Fuels at Marsaxlokk.",
      ),
    ).toBeTruthy();
    expect(within(card).getByText("Nothing is ordered until you approve.")).toBeTruthy();
    const link = within(card).getByRole("link", { name: "Review and decide" });
    expect(link.getAttribute("href")).toBe("/approvals?recommendation=1");
    expect(link.getAttribute("data-variant")).toBe("default");
    // The card only links: the decision is made on the approvals screen.
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("a decided proposal says so and links to it without asking for a decision", async () => {
    bunkerAnswer();
    gets["/api/recommendations/1"] = () => json({ ...recommendation, status: "approved" });
    renderDock("/inbox");
    await ask("Where should Aegean Pioneer bunker?");
    const card = await screen.findByRole("article", { name: "Proposal 1" });
    await within(card).findByText("approved");
    expect(within(card).queryByText("awaiting your decision")).toBeNull();
    expect(within(card).queryByText(/until you approve/)).toBeNull();
    const link = within(card).getByRole("link", { name: "Open in approvals" });
    expect(link.getAttribute("href")).toBe("/approvals?recommendation=1");
  });
});
