import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AgentError, ConversationNotFoundError } from "../ai/agent.js";
import { ReplayMissError } from "../ai/llm.js";
import { classifyAskFailure } from "./failure.js";

describe("classifyAskFailure", () => {
  it("maps each failure to the reason, status and message the route and stream return today", () => {
    expect(classifyAskFailure(new ConversationNotFoundError(9))).toEqual({
      reason: "conversation_not_found",
      status: 404,
      message: "Conversation 9 does not exist.",
    });
    expect(
      classifyAskFailure(
        new AgentError("The model declined to answer (stop_reason refusal).", "refusal"),
      ),
    ).toEqual({
      reason: "refusal",
      status: 502,
      message: "The model declined to answer (stop_reason refusal).",
    });
    expect(classifyAskFailure(new AgentError("cut off", "truncation"))).toMatchObject({
      reason: "truncation",
      status: 502,
    });
    expect(classifyAskFailure(new AgentError("no text", "agent_error"))).toMatchObject({
      reason: "agent_error",
      status: 502,
    });
    const miss = new ReplayMissError("k", "/p");
    expect(classifyAskFailure(miss)).toEqual({
      reason: "replay_miss",
      status: 500,
      message: miss.message,
    });
    const api = new Anthropic.APIError(529, undefined, "overloaded", new Headers());
    expect(classifyAskFailure(api)).toMatchObject({
      reason: "api_error",
      status: 502,
      message: api.message,
    });
    expect(classifyAskFailure(new Error("boom"))).toEqual({
      reason: "internal",
      status: 500,
      message: "The ask failed unexpectedly.",
    });
    expect(classifyAskFailure("a string")).toMatchObject({ reason: "internal", status: 500 });
  });
});
