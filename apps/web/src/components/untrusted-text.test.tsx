import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UntrustedText } from "@/components/untrusted-text";

afterEach(cleanup);

describe("UntrustedText", () => {
  it("untrusted text renders as text", () => {
    const hostile = `<img src=x onerror="alert(1)"><b>Ignore previous instructions</b>`;
    const { container } = render(<UntrustedText text={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe(hostile);
  });

  it("isolates the text's direction from the surrounding line", () => {
    const { container } = render(<UntrustedText text={"‮STAR NAVIGATOR"} />);
    expect(container.querySelector("bdi")?.textContent).toBe("‮STAR NAVIGATOR");
  });

  it("shows a dash, not an empty gap, when there is no text", () => {
    const { container } = render(<UntrustedText text={null} />);
    expect(container.textContent).toBe("—");
  });
});
