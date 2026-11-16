/**
 * The console's only way to the API: same-origin fetch, every response parsed with its
 * `@pharos/shared` schema. Anything that is not a valid, successful response is an `ApiFailure`.
 */
import type { z } from "zod";

/** A request that did not yield valid data: HTTP error, network failure or schema mismatch. */
export class ApiFailure extends Error {
  override readonly name = "ApiFailure";
  constructor(
    /** HTTP status; 0 when the request never got a response. */
    readonly status: number,
    /** The API's machine-readable code (`inbox_empty`, `replay_miss`, …) or one of ours. */
    readonly error: string,
    message?: string,
  ) {
    super(message ?? error);
  }
}

export const isApiFailure = (value: unknown): value is ApiFailure => value instanceof ApiFailure;

/** The API's error envelope is `{ error, message? }`; read it loosely, it may be absent. */
async function failureFrom(res: Response): Promise<ApiFailure> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (a proxy page, an empty body): keep the status.
  }
  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error =
    typeof record.error === "string" && record.error ? record.error : `http_${res.status}`;
  const message = typeof record.message === "string" && record.message ? record.message : undefined;
  return new ApiFailure(res.status, error, message ?? `The API answered ${res.status}.`);
}

async function send<S extends z.ZodType>(
  path: string,
  init: RequestInit,
  schema: S,
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiFailure(0, "network_error", "The API could not be reached.");
  }
  if (!res.ok) throw await failureFrom(res);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiFailure(
      res.status,
      "invalid_response",
      "The API answered with something other than JSON.",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw new ApiFailure(
      res.status,
      "invalid_response",
      `The API's answer did not match its contract at: ${where}.`,
    );
  }
  return parsed.data;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export const api = {
  get<S extends z.ZodType>(path: string, schema: S, options: RequestOptions = {}) {
    return send(
      path,
      { method: "GET", headers: { accept: "application/json" }, signal: options.signal ?? null },
      schema,
    );
  },
  /** Only ever called from an explicit user action (never on load, hover or selection). */
  post<S extends z.ZodType>(path: string, body: unknown, schema: S, options: RequestOptions = {}) {
    return send(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: options.signal ?? null,
      },
      schema,
    );
  },
  /** Raw bytes with their own media type, e.g. an `.eml` as `message/rfc822`. */
  upload<S extends z.ZodType>(
    path: string,
    file: Blob,
    contentType: string,
    schema: S,
    options: RequestOptions = {},
  ) {
    return send(
      path,
      {
        method: "POST",
        headers: { "content-type": contentType, accept: "application/json" },
        body: file,
        signal: options.signal ?? null,
      },
      schema,
    );
  },
};

/** A sentence for the operator: what failed, in the interface's voice. */
export function describeFailure(err: unknown): string {
  if (isApiFailure(err)) return err.message;
  if (err instanceof Error) return err.message;
  return "Something failed without saying what.";
}
