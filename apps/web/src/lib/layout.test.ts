import { afterEach, describe, expect, it } from "vitest";
import { getLayout, LAYOUT_KEY, resetLayout, setLayout } from "./layout";

afterEach(() => resetLayout());

describe("layout", () => {
  it("starts with every panel open, folds closed and focus off", () => {
    expect(getLayout()).toEqual({
      needs: true,
      dock: true,
      controls: true,
      focus: false,
      fuel: false,
      danger: false,
    });
  });

  it("remembers panels across a reload, but not focus mode", () => {
    setLayout({ needs: false, fuel: true, focus: true });
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
    expect(saved).toEqual({ needs: false, dock: true, controls: true, fuel: true, danger: false });
  });

  it("a stored value of the wrong shape is ignored", () => {
    localStorage.setItem(LAYOUT_KEY, '{"needs":"no","dock":false}');
    resetLayout({ reload: true });
    expect(getLayout().needs).toBe(true);
    expect(getLayout().dock).toBe(false);
  });
});
