import type { AuditEventList, PortList, SimClockView } from "@pharos/shared";
import { Hono } from "hono";
import { type Clock, createClock } from "../clock.js";
import type { ReadSource } from "./source.js";

/** Marks every response with its source ("fixture" or "db") so the console can badge it. */
export const DATA_SOURCE_HEADER = "x-pharos-data";

const notFound = { error: "not_found" } as const;

/** Largest value of a Postgres `integer` id column. */
const MAX_ID = 2_147_483_647;

/** Positive integer ids that fit a Postgres integer only; anything else is treated as unknown. */
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_ID ? id : null;
}

/**
 * The read API (mounted under /api): vessels, voyages, inbox, quotes, recommendations, plus the
 * console's clock, ports and audit trail. `clock` is the request clock (wall clock by default).
 */
export function createReadRoutes(read: ReadSource, clock: Clock = createClock(null)) {
  const dataTag = read.dataTag;
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header(DATA_SOURCE_HEADER, dataTag);
    await next();
  });

  const resource = <T>(
    path: string,
    list: () => Promise<T[]>,
    get: (id: number) => Promise<T | null>,
  ) => {
    app.get(`/${path}`, async (c) => c.json({ items: await list() }));
    app.get(`/${path}/:id`, async (c) => {
      const id = parseId(c.req.param("id"));
      const item = id === null ? null : await get(id);
      return item === null ? c.json(notFound, 404) : c.json(item);
    });
  };

  resource(
    "vessels",
    () => read.listVessels(),
    (id) => read.getVessel(id),
  );
  resource(
    "voyages",
    () => read.listVoyages(),
    (id) => read.getVoyage(id),
  );
  resource(
    "inbox",
    () => read.listInbox(),
    (id) => read.getInboxItem(id),
  );
  resource(
    "quotes",
    () => read.listQuotes(),
    (id) => read.getQuote(id),
  );
  resource(
    "recommendations",
    () => read.listRecommendations(),
    (id) => read.getRecommendation(id),
  );

  /** The served world's anchor and the clock every request reads. */
  app.get("/clock", async (c) => {
    const anchor = await read.worldAnchor();
    if (anchor === null) {
      return c.json({ error: "no_world", message: "No world is seeded yet." }, 503);
    }
    const body: SimClockView = {
      anchor: anchor.toISOString(),
      now: clock.now().toISOString(),
      pinned: clock.pinned,
    };
    return c.json(body);
  });

  app.get("/ports", async (c) => c.json({ items: await read.listPorts() } satisfies PortList));

  /** `?recommendationId=` narrows the trail to one recommendation; without it, the latest events. */
  app.get("/audit", async (c) => {
    const raw = c.req.query("recommendationId");
    const recommendationId = raw === undefined ? null : parseId(raw);
    if (raw !== undefined && recommendationId === null) {
      return c.json(
        { error: "invalid_request", message: "recommendationId must be a positive integer id." },
        400,
      );
    }
    const items = await read.listAuditEvents(recommendationId);
    return c.json({ items } satisfies AuditEventList);
  });

  return app;
}
