import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { readBodyOnce } from "./read-body.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** A full garbage collection, then a macrotask so FinalizationRegistry callbacks can run. */
async function collectGarbage(): Promise<void> {
  gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json", "request-id": "req_1" },
    ...init,
  });

describe("readBodyOnce", () => {
  it("parses the JSON and returns a new Response over the same bytes, status and headers kept", async () => {
    const original = json({ model: "m", usage: { input_tokens: 1 } });
    const { json: parsed, response, nullBody } = await readBodyOnce(original);
    expect(parsed).toEqual({ ok: true, value: { model: "m", usage: { input_tokens: 1 } } });
    expect(nullBody).toBe(false);
    expect(response).not.toBe(original);
    expect([response.status, response.statusText, response.headers.get("request-id")]).toEqual([
      200,
      "OK",
      "req_1",
    ]);
    expect(await response.json()).toEqual({ model: "m", usage: { input_tokens: 1 } });
  });

  it("reports a body that is not JSON without throwing, and keeps its bytes", async () => {
    const { json: parsed, response } = await readBodyOnce(new Response("not json"));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? null : parsed.error).toBeInstanceOf(SyntaxError);
    expect(await response.text()).toBe("not json");
  });

  it("gives a 204 or 205 a null body (and no JSON)", async () => {
    for (const status of [204, 205]) {
      const {
        json: parsed,
        response,
        nullBody,
      } = await readBodyOnce(new Response(null, { status }));
      expect([nullBody, response.status, response.body, parsed.ok]).toEqual([
        true,
        status,
        null,
        false,
      ]);
    }
  });

  it("a garbage collection before the caller reads the new Response leaves its body readable", async () => {
    for (let i = 0; i < 3; i++) {
      const { response } = await readBodyOnce(json({ i }));
      await collectGarbage();
      expect(response.bodyUsed).toBe(false);
      expect(await response.json()).toEqual({ i });
    }
  });
});
