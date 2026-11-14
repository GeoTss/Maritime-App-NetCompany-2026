/**
 * Every phrasing a generated (truth `extracted`) quote may use must read back, through Pharos's
 * own normalisers, to the value it was rendered from.
 */
import {
  normaliseCurrency,
  normaliseGrade,
  normaliseMassUnit,
  normalisePerUnit,
  parseAmount,
  parseDeliveryWindow,
  parseQuoteDate,
} from "@pharos/domain";
import type { FuelGrade } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { resolvePort, resolveVessel } from "../../../apps/api/src/ingest/resolve.js";
import { createPrng } from "../prng.js";
import { evalWorld } from "../world.js";
import {
  addDays,
  DAY_STYLES,
  formatDay,
  GRADE_NAMES,
  phraseBargeLump,
  phrasePort,
  phrasePrice,
  phraseQty,
  phraseValidity,
  phraseVessel,
  phraseWindow,
} from "./phrasing.js";

const RECEIVED = new Date("2026-11-13T10:00:00Z");
const DAYS = Array.from({ length: 50 }, (_, i) => addDays("2026-11-13", i));

describe("dates", () => {
  it("formats every day style so that parseQuoteDate reads the same day", () => {
    for (const style of DAY_STYLES) {
      for (const day of DAYS) expect(parseQuoteDate(formatDay(day, style), RECEIVED)).toBe(day);
    }
  });

  it("writes the right weekday and ordinal", () => {
    expect(formatDay("2026-11-14", "wkd-d-month-yyyy")).toBe("Saturday, 14 November 2026");
    expect(formatDay("2026-11-16", "wkd-d-mon")).toBe("Mon 16 Nov");
    expect(formatDay("2026-12-01", "dth-month")).toBe("1st December");
    expect(formatDay("2026-11-12", "dth-month")).toBe("12th November");
    expect(formatDay("2026-11-22", "dth-month")).toBe("22nd November");
  });

  it("validity phrasings (with times and zones) read back as the validity day", () => {
    const prng = createPrng(1);
    for (let i = 0; i < 600; i++) {
      const day = DAYS[i % 20] as string;
      expect(parseQuoteDate(phraseValidity(prng, day).text, RECEIVED)).toBe(day);
    }
  });

  it("delivery windows read back as [from, to] under the one-field / two-field rule", () => {
    const prng = createPrng(2);
    const forms = new Set<string>();
    for (let i = 0; i < 800; i++) {
      const from = DAYS[i % 30] as string;
      const to = addDays(from, 1 + (i % 3));
      const w = phraseWindow(prng, from, to);
      forms.add(w.form);
      const read =
        w.kind === "one"
          ? parseDeliveryWindow(w.text, RECEIVED)
          : {
              from: parseDeliveryWindow(w.from, RECEIVED)?.from,
              to: parseDeliveryWindow(w.to, RECEIVED)?.to,
            };
      expect(read, `${JSON.stringify(w)}`).toEqual({ from, to });
    }
    expect([...forms].sort()).toEqual(
      [
        "cross-month",
        "dash",
        "dash-long",
        "dotted",
        "mon-both",
        "mon-first",
        "slash",
        "tolerance",
        "two",
      ].sort(),
    );
  });

  it("never phrases a single-day window", () => {
    expect(() => phraseWindow(createPrng(3), "2026-11-18", "2026-11-18")).toThrow(RangeError);
  });
});

describe("amounts, units and currencies", () => {
  it("prices read back as the value, the currency and per mt", () => {
    const prng = createPrng(4);
    for (let i = 0; i < 400; i++) {
      const value = [738, 738.5, 712.25, 486, 1205][i % 5] as number;
      const currency = i % 2 === 0 ? "USD" : "EUR";
      const p = phrasePrice(prng, value, currency);
      expect(parseAmount(p.asWritten)).toBe(value);
      expect(normaliseCurrency(p.currency)).toBe(currency);
      expect(normalisePerUnit(p.perUnit)).toBe("per_mt");
      expect(p.asWritten).toContain(p.currency as string);
      expect(p.asWritten).toContain(p.perUnit as string);
    }
  });

  it("lump-sum barge fees and quantities read back", () => {
    const prng = createPrng(5);
    for (let i = 0; i < 300; i++) {
      const fee = 1200 + 50 * (i % 49);
      const b = phraseBargeLump(prng, fee, i % 2 === 0 ? "USD" : "EUR");
      expect(parseAmount(b.asWritten)).toBe(fee);
      expect(normalisePerUnit(b.perUnit)).toBe("lump_sum");
      const qty = 50 + 25 * (i % 60);
      const q = phraseQty(prng, qty);
      expect(parseAmount(q.asWritten)).toBe(qty);
      expect(normaliseMassUnit(q.unit)).toBe("mt");
      expect(q.asWritten.endsWith(` ${q.unit}`)).toBe(true);
    }
  });

  it("every grade name normalises to exactly its grade", () => {
    for (const [grade, names] of Object.entries(GRADE_NAMES)) {
      for (const n of names) expect(normaliseGrade(n), n).toBe(grade as FuelGrade);
    }
  });
});

describe("entities", () => {
  const world = evalWorld();

  it("every vessel phrasing resolves to the vessel", () => {
    const prng = createPrng(6);
    for (let i = 0; i < 400; i++) {
      const v = world.vessels[i % world.vessels.length];
      if (!v) throw new Error("no vessel");
      const p = phraseVessel(prng, v);
      expect(resolveVessel(world, { name: p.name, imo: p.imo }).vessel?.id).toBe(v.id);
      if (p.name) expect(p.text).toContain(p.name);
      if (p.imo) expect(p.text).toContain(p.imo);
    }
  });

  it("every port phrasing carries the port name, which resolves", () => {
    const prng = createPrng(7);
    for (let i = 0; i < 200; i++) {
      const port = world.ports[i % world.ports.length];
      if (!port) throw new Error("no port");
      const p = phrasePort(prng, port);
      expect(p.text).toContain(p.value);
      expect(resolvePort(world, p.value).port?.id).toBe(port.id);
    }
  });
});
