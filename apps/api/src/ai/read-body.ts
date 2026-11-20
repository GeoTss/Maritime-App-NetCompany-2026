/**
 * Reads a transport Response's body once and hands back a new Response over the same bytes.
 *
 * Never read a body through `clone()` and then return the original: Node 22's fetch (undici 6.21)
 * cancels the original body when the clone is garbage collected, so a collection before the
 * caller reads it fails with "middleware consumed the response body". The LLM gateway, the eval
 * spend guard and the eval transcript tap all use this.
 */

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: Error };

export interface BodyRead {
  /**
   * The body parsed as UTF-8 JSON; `ok: false` when it is not JSON (an empty body included).
   * Parsed on first access, so a caller can time the transport read without the parse.
   */
  readonly json: ParsedJson;
  /** A new Response over the same bytes: status, statusText and headers kept. */
  readonly response: Response;
  /** 204 or 205: the new Response has a null body (it may not carry one, not even an empty one). */
  readonly nullBody: boolean;
}

function parse(bytes: ArrayBuffer): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function readBodyOnce(transported: Response): Promise<BodyRead> {
  const bytes = await transported.arrayBuffer();
  const nullBody = transported.status === 204 || transported.status === 205;
  const response = new Response(nullBody ? null : bytes, {
    status: transported.status,
    statusText: transported.statusText,
    headers: transported.headers,
  });
  let parsed: ParsedJson | undefined;
  return {
    response,
    nullBody,
    get json() {
      parsed ??= parse(bytes);
      return parsed;
    },
  };
}
