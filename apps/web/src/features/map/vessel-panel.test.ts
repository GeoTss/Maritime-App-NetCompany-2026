import { describe, expect, it } from "vitest";
import { alertText } from "./vessel-panel";

describe("vessel alert copy", () => {
  it("words each known alert flag", () => {
    expect(alertText("lsmgo_below_margin_for_eca")).toMatch(/below the safety margin/);
    expect(alertText("lsmgo_runs_out")).toBe("LSMGO runs out before arrival at the planned speed");
  });

  it("makes an unknown flag readable", () => {
    expect(alertText("some_new_flag")).toBe("Some new flag");
  });
});
