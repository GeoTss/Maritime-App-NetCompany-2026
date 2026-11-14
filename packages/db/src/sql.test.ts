import { afterEach, describe, expect, it, vi } from "vitest";
import { pingDb, type Sql } from "./sql.js";

const answering = (() => Promise.resolve([{ ok: 1 }])) as unknown as Sql;
const hanging = (() => new Promise(() => {})) as unknown as Sql;

describe("pingDb", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves true and leaves no timer behind when the database answers", async () => {
    vi.useFakeTimers();
    await expect(pingDb(answering, 2000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves false after the timeout when the database does not answer", async () => {
    vi.useFakeTimers();
    const result = pingDb(hanging, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
