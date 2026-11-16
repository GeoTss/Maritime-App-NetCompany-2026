import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
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
  frame({ type: "progress", tool, phase, ms });
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

beforeEach(() => {
  resetAssistant();
  calls = [];
  health = null;
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
      return json({ error: "not_found" }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDock() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter>
          <AssistantDock />
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
    expect(await screen.findByText("all numbers sourced")).toBeTruthy();
    // The trace folds once the answer arrives; it can be reopened.
    fireEvent.click(screen.getByText("Checked 1 source"));
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
    expect(await screen.findByText(/repaired once/)).toBeTruthy();
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
      "This question has no recorded reply. Start a new conversation and pick a suggested question.",
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

  it("a route answer offers Show on map, which only navigates", async () => {
    askReply = () =>
      sse([
        progress("plan_route_speed", "started"),
        progress("plan_route_speed", "finished", 90),
        frame({
          type: "answer",
          response: response({
            answer: "MV Aegean Pioneer should sail at 12.5 kn [f_price].",
          }),
        }),
      ]);
    renderDock();
    await ask("Best route?");
    const link = await screen.findByRole("link", { name: /Show on map/ });
    await waitFor(() => expect(link.getAttribute("href")).toBe("/?vessel=1"));
    expect(screen.getByText(/Press Plan route/)).toBeTruthy();
    fireEvent.click(link);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/api/ask/stream",
    ]);
  });

  it("links to the proposals an answer created, and renders Markdown as plain text", async () => {
    askReply = () =>
      sse([
        frame({
          type: "answer",
          response: response({
            answer: "**Best:** Kestrel at USD 612.50 [f_price].\n- first point\n- second point",
            recommendationIds: [4],
          }),
        }),
      ]);
    const { container } = renderDock();
    await ask("Who?");
    const link = await screen.findByRole("link", { name: /Purchase proposal|Proposal/ });
    expect(link.getAttribute("href")).toBe("/approvals?recommendation=4");
    expect(container.textContent).toContain("Best: Kestrel at");
    expect(container.textContent).toContain("• first point");
    expect(container.querySelector("strong, ul, li")).toBeNull();
  });
});
