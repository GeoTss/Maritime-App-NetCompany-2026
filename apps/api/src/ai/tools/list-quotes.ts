/**
 * `list_quotes`: the supplier quotes on record (received, accepted, ordered or expired; never one
 * awaiting review or rejected), with citable facts per quote and per quote line. Expired quotes
 * (see `quoteExpiry`) are left out unless asked for. A non-USD price also comes in USD, converted
 * by the domain FX helper at the latest reference rate, as a derived fact with its lineage.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { loadWorld } from "@pharos/db";
import { isoDayAfter, toUsd } from "@pharos/domain";
import {
  type Currency,
  type Fact,
  ListQuotesInput,
  type Provenance,
  type Quote,
  type ToolResult,
} from "@pharos/shared";
import { resolvePort } from "../../ingest/resolve.js";
import { dbFact, factId, findVessel, quoteExpiry, runTool, type ToolContext } from "./common.js";

export const TOOL = "list_quotes";

/** Quote statuses the agent may list: the rest await a human or were turned down. */
const LISTED: ReadonlySet<Quote["status"]> = new Set([
  "received",
  "accepted",
  "ordered",
  "expired",
]);

const fact = (
  path: string,
  key: number,
  label: string,
  value: Fact["value"],
  unit: string | null,
  provenance: Provenance,
): Fact => ({ id: factId(TOOL, key, path), label, value, unit, provenance });

export function listQuotes(ctx: ToolContext, input: ListQuotesInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const now = ctx.now();

    let requirementIds: Set<number> | null = null;
    if (input.vessel) {
      const vessel = findVessel(world, input.vessel);
      const voyageIds = new Set(
        world.voyages.filter((v) => v.vesselId === vessel.id).map((v) => v.id),
      );
      requirementIds = new Set(
        world.bunkerRequirements.filter((r) => voyageIds.has(r.voyageId)).map((r) => r.id),
      );
    }
    let portId: number | null = null;
    if (input.port) {
      const { port, detail } = resolvePort(world, input.port);
      if (!port) throw new Error(detail ?? `No port matches "${input.port}".`);
      portId = port.id;
    }

    const facts: Fact[] = [];
    const quotes = [];
    let hiddenExpired = false;
    /** The latest fx rate to USD per currency, added as a fact once it is used. */
    const fxFacts = new Map<Currency, Fact>();
    const fxFact = (currency: Currency): Fact => {
      const known = fxFacts.get(currency);
      if (known) return known;
      const rate = world.referenceRates
        .filter((r) => r.kind === "fx" && r.key === `${currency}USD`)
        .sort((a, b) => b.asOf.getTime() - a.asOf.getTime() || b.id - a.id)[0];
      if (!rate) throw new Error(`No ${currency} to USD reference rate.`);
      const f = dbFact(
        TOOL,
        { table: "reference_rates", rowId: rate.id, field: "value" },
        `${currency} to USD exchange rate`,
        rate.value,
        `USD/${currency}`,
      );
      fxFacts.set(currency, f);
      facts.push(f);
      return f;
    };

    for (const q of [...world.quotes].sort((a, b) => a.id - b.id)) {
      if (!LISTED.has(q.status)) continue;
      if (requirementIds && (q.requirementId === null || !requirementIds.has(q.requirementId))) {
        continue;
      }
      if (portId !== null && q.portId !== portId) continue;
      const lines = world.quoteLines
        .filter((l) => l.quoteId === q.id && (!input.grade || l.grade === input.grade))
        .sort((a, b) => a.id - b.id);
      if (lines.length === 0) continue;
      const expiry = quoteExpiry(q, now);
      if (expiry && !input.includeExpired) {
        hiddenExpired = true;
        continue;
      }
      const supplier = world.suppliers.find((s) => s.id === q.supplierId);
      const port = world.ports.find((p) => p.id === q.portId);
      if (!supplier || !port) continue;

      const prefix = `${supplier.name} quote at ${port.name}`;
      const validUntil = q.validUntil ? isoDayAfter(q.validUntil, 0) : null;
      facts.push(
        fact("quotes.supplier", q.id, `${prefix}: supplier`, supplier.name, null, {
          source: "db",
          table: "suppliers",
          rowId: supplier.id,
          field: "name",
        }),
        fact("quotes.port", q.id, `${prefix}: port`, port.name, null, {
          source: "db",
          table: "ports",
          rowId: port.id,
          field: "name",
        }),
        dbFact(
          TOOL,
          { table: "quotes", rowId: q.id, field: "bargeFee" },
          `${prefix}: barge fee`,
          q.bargeFee,
          q.currency,
        ),
        dbFact(
          TOOL,
          { table: "quotes", rowId: q.id, field: "status" },
          `${prefix}: status`,
          q.status,
          null,
        ),
        fact("quotes.expired", q.id, `${prefix}: expired`, expiry !== null, null, {
          source: "db",
          table: "quotes",
          rowId: q.id,
          field: expiry ?? "validUntil",
        }),
      );
      if (validUntil) {
        facts.push(
          dbFact(
            TOOL,
            { table: "quotes", rowId: q.id, field: "validUntil" },
            `${prefix}: valid until (UTC date)`,
            validUntil,
            null,
          ),
        );
      }
      for (const l of lines) {
        const linePrefix = `${prefix}, ${l.grade}`;
        const price = dbFact(
          TOOL,
          { table: "quote_lines", rowId: l.id, field: "pricePerMt" },
          `${linePrefix}: price per mt`,
          l.pricePerMt,
          `${q.currency}/mt`,
        );
        facts.push(
          dbFact(
            TOOL,
            { table: "quote_lines", rowId: l.id, field: "grade" },
            `${linePrefix}: grade`,
            l.grade,
            null,
          ),
          dbFact(
            TOOL,
            { table: "quote_lines", rowId: l.id, field: "qtyMt" },
            `${linePrefix}: quantity offered`,
            l.qtyMt,
            "mt",
          ),
          price,
        );
        if (q.currency !== "USD") {
          const fx = fxFact(q.currency);
          facts.push(
            fact(
              "quote_lines.priceUsdPerMt",
              l.id,
              `${linePrefix}: price per mt in USD`,
              toUsd(l.pricePerMt, fx.value as number),
              "USD/mt",
              { source: "derived", operation: "multiply", operands: [price.id, fx.id] },
            ),
          );
        }
      }
      quotes.push({
        supplier: supplier.name,
        port: port.name,
        unlocode: port.unlocode,
        currency: q.currency,
        status: q.status,
        expired: expiry !== null,
        validUntil,
        grades: lines.map((l) => l.grade),
      });
    }

    const notes: string[] = [];
    if (quotes.length === 0) notes.push("No quotes match.");
    if (hiddenExpired) {
      notes.push("Expired quotes are left out; call again with includeExpired true to see them.");
    }
    return { facts, data: notes.length > 0 ? { quotes, message: notes.join(" ") } : { quotes } };
  });
}

export function listQuotesTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Supplier quotes on record, optionally for one vessel's voyages, one port or one fuel grade: " +
      "supplier, port, status, validity, barge fee, and per fuel grade the quantity offered and the " +
      "price per mt in the quote currency (and in USD for a non-USD quote). Expired quotes are left " +
      "out unless includeExpired is true. Returns citable facts per quote and per grade.",
    inputSchema: ListQuotesInput,
    run: async (input) => JSON.stringify(await listQuotes(ctx, input)),
  });
}
