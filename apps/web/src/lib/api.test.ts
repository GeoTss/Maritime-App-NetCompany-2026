import { SimClockView } from "@pharos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, api, isApiFailure } from "@/lib/api";

const clock = { anchor: "2026-11-14T08:00:00Z", now: "2026-11-14T08:05:00Z", pinned: true };

function mockFetch(response: Response | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(json(clock));
    await expect(api.get("/api/clock", SimClockView)).resolves.toEqual(clock);
  });

  it("api error becomes a typed failure", async () => {
    mockFetch(json({ error: "inbox_empty", message: "No demo email left to deliver." }, 409));
    const err = await api.get("/api/clock", SimClockView).catch((e: unknown) => e);
    expect(isApiFailure(err)).toBe(true);
    expect(err).toBeInstanceOf(ApiFailure);
    const failure = err as ApiFailure;
    expect(failure.status).toBe(409);
    expect(failure.error).toBe("inbox_empty");
    expect(failure.message).toBe("No demo email left to deliver.");
  });

  it("a non-JSON error body still becomes a typed failure", async () => {
    mockFetch(new Response("Bad Gateway", { status: 502 }));
    const err = (await api.get("/api/clock", SimClockView).catch((e: unknown) => e)) as ApiFailure;
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.status).toBe(502);
    expect(err.error).toBe("http_502");
  });

  it("a network failure is a typed failure with status 0", async () => {
    mockFetch(new TypeError("Failed to fetch"));
    const err = (await api.get("/api/clock", SimClockView).catch((e: unknown) => e)) as ApiFailure;
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.status).toBe(0);
    expect(err.error).toBe("network_error");
  });

  it("a response that fails its schema is an error, not data", async () => {
    mockFetch(json({ ...clock, pinned: "yes" }));
    const err = (await api.get("/api/clock", SimClockView).catch((e: unknown) => e)) as ApiFailure;
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.status).toBe(200);
    expect(err.error).toBe("invalid_response");
    expect(err.message).toMatch(/pinned/);
  });

  it("posts JSON with the JSON content type", async () => {
    const fn = mockFetch(json(clock));
    await api.post("/api/recommendations/7/approve", { decidedBy: "operator" }, SimClockView);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/recommendations/7/approve");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ decidedBy: "operator" }));
  });

  it("uploads raw bytes with the given content type", async () => {
    const fn = mockFetch(json(clock));
    const file = new Blob(["Subject: quote"], { type: "message/rfc822" });
    await api.upload("/api/inbox/upload", file, "message/rfc822", SimClockView);
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("content-type")).toBe("message/rfc822");
    expect(init.body).toBe(file);
  });
});
