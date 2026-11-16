// @vitest-environment node
/**
 * In replay (the offline demo) only recorded questions have answers, so the dock suggests the
 * demo story's three questions, word for word and in story order.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUGGESTED_QUESTIONS } from "./assistant-dock";

const STORY = fileURLToPath(new URL("../../../../../e2e/demo.spec.ts", import.meta.url));

describe("the dock's suggested questions", () => {
  it("are the story's BUNKER_Q, ROUTE_Q and INSTRUCT_Q, in that order", () => {
    const story = readFileSync(STORY, "utf8");
    const scripted = ["BUNKER_Q", "ROUTE_Q", "INSTRUCT_Q"].map(
      (name) => new RegExp(`const ${name} =\\s*"([^"]+)"`).exec(story)?.[1],
    );
    expect(scripted.every((q) => typeof q === "string" && q.length > 0)).toBe(true);
    expect(SUGGESTED_QUESTIONS).toEqual(scripted);
  });
});
