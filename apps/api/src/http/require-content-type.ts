/**
 * CSRF guard for mutating routes: the request's media type must be one of `allowed`, else 415.
 * A cross-site HTML form or a no-cors fetch can send only form-encoded, multipart or text/plain
 * bodies (or none), never `application/json`, so a forged request cannot reach the handler.
 */
import type { MiddlewareHandler } from "hono";

export function requireContentType(...allowed: string[]): MiddlewareHandler {
  const accepted = new Set(allowed.map((t) => t.toLowerCase()));
  return async (c, next) => {
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!accepted.has(type)) {
      return c.json(
        {
          error: "unsupported_media_type",
          message: `Send this request as ${allowed.join(" or ")}.`,
        },
        415,
      );
    }
    await next();
  };
}
