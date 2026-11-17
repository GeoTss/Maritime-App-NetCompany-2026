import { DEFAULT_WORLD_SEED, DEMO_SCENARIO, generateWorld } from "@pharos/db";
import { describe, expect, it } from "vitest";
import { FIXTURE_ANCHOR } from "../read/fixtures.js";
import {
  checkPriceBand,
  latestMarketPrice,
  latestUsdRate,
  resolvePort,
  resolveSupplier,
  resolveSupplierName,
  resolveVessel,
} from "./resolve.js";

const world = generateWorld({ seed: DEFAULT_WORLD_SEED, anchor: FIXTURE_ANCHOR });
const pioneer = world.vessels.find((v) => v.imo === DEMO_SCENARIO.vesselImo);
const portId = (code: string) => world.ports.find((p) => p.unlocode === code)?.id;

describe("resolveVessel", () => {
  it("resolves by IMO, by name as written, and by name without the MV prefix", () => {
    expect(resolveVessel(world, { name: null, imo: "9480019" }).vessel?.id).toBe(pioneer?.id);
    expect(resolveVessel(world, { name: "MV Aegean Pioneer", imo: null }).vessel?.id).toBe(
      pioneer?.id,
    );
    expect(resolveVessel(world, { name: "aegean  PIONEER", imo: null }).vessel?.id).toBe(
      pioneer?.id,
    );
    expect(
      resolveVessel(world, { name: "M/V Aegean Pioneer", imo: "IMO 9480019" }).vessel?.id,
    ).toBe(pioneer?.id);
  });

  it("fails for an unknown vessel, a missing vessel, and a name that contradicts the IMO", () => {
    const unknown = resolveVessel(world, { name: "MV Flying Dutchman", imo: null });
    expect(unknown.vessel).toBeNull();
    expect(unknown.detail).toContain("Flying Dutchman");
    expect(resolveVessel(world, { name: null, imo: null }).vessel).toBeNull();
    expect(resolveVessel(world, { name: "MV Aegean Pioneer", imo: "9999999" }).vessel).toBeNull();
    expect(resolveVessel(world, { name: "MV Thessaly Star", imo: "9480019" }).vessel).toBeNull();
  });
});

describe("resolvePort", () => {
  it("resolves by name (any case) and by UN/LOCODE", () => {
    expect(resolvePort(world, "Marsaxlokk").port?.unlocode).toBe("MTMLA");
    expect(resolvePort(world, " GIBRALTAR ").port?.unlocode).toBe("GIGIB");
    expect(resolvePort(world, "MTMLA").port?.unlocode).toBe("MTMLA");
  });

  it("fails for an unknown or missing port", () => {
    expect(resolvePort(world, "Atlantis").port).toBeNull();
    expect(resolvePort(world, null).port).toBeNull();
  });

  it.each([
    ["Antwerp outer anchorage", "BEANR"],
    ["Rotterdam (NLRTM)", "NLRTM"],
    ["Brest (FRBES)", "FRBES"],
    ["Hamburg anchorage", "DEHAM"],
    ["Port of Piraeus", "GRPIR"],
    ["Le Havre roads", "FRLEH"],
  ])("resolves the one port named inside %s", (written, unlocode) => {
    expect(resolvePort(world, written).port?.unlocode).toBe(unlocode);
  });

  it("stays unresolved when two different ports are named, or only part of a word matches", () => {
    expect(resolvePort(world, "Rotterdam or Antwerp").port).toBeNull();
    expect(resolvePort(world, "Gibraltar (ESALG)").port).toBeNull();
    expect(resolvePort(world, "Brestville").port).toBeNull();
    expect(resolvePort(world, "Saint-Genoa-Ville").port?.unlocode).toBe("ITGOA");
  });
});

describe("resolveSupplier", () => {
  it("resolves by the sender's email domain, case-insensitively", () => {
    expect(resolveSupplier(world, "bunkers@kestrel-fuels.example").supplier?.name).toBe(
      "Kestrel Marine Fuels",
    );
    expect(resolveSupplier(world, "Sales@STRAITLINE-FUELS.example").supplier?.name).toBe(
      "Strait Line Fuels",
    );
  });

  it("fails for an unknown domain, a look-alike subdomain, and a missing sender", () => {
    expect(resolveSupplier(world, "bunkers@kestrel-fuels.example.evil").supplier).toBeNull();
    expect(resolveSupplier(world, "x@mail.kestrel-fuels.example").supplier).toBeNull();
    expect(resolveSupplier(world, null).supplier).toBeNull();
  });
});

describe("resolveSupplierName", () => {
  const name = (written: string | null) => resolveSupplierName(world, written)?.name ?? null;

  it("matches a full supplier name, case- and whitespace-folded", () => {
    expect(name("Kestrel Marine Fuels")).toBe("Kestrel Marine Fuels");
    expect(name("  STRAIT   line fuels ")).toBe("Strait Line Fuels");
  });

  it("matches a token-bounded prefix of a supplier's full name", () => {
    expect(name("Kestrel")).toBe("Kestrel Marine Fuels");
    expect(name("kestrel marine")).toBe("Kestrel Marine Fuels");
    expect(name("Kes")).toBeNull();
    expect(name("Kestrel Marine Fu")).toBeNull();
  });

  it("is null for a name with extra words, an unknown name, or nothing", () => {
    expect(name("Kestrel Marine Fuels Ltd")).toBeNull();
    expect(name("Acme Oil")).toBeNull();
    expect(name("")).toBeNull();
    expect(name(null)).toBeNull();
  });

  it("is null when the name matches more than one supplier", () => {
    const twin = {
      ...world.suppliers[0],
      id: 99,
      name: "Kestrel Shipping",
    } as (typeof world.suppliers)[number];
    const w = { ...world, suppliers: [...world.suppliers, twin] };
    expect(resolveSupplierName(w, "Kestrel")).toBeNull();
    expect(resolveSupplierName(w, "Kestrel Marine")?.name).toBe("Kestrel Marine Fuels");
  });
});

describe("market band", () => {
  it("uses the latest market price for the port and grade", () => {
    const id = portId("MTMLA");
    const rows = world.portFuelPrices.filter((p) => p.portId === id && p.grade === "LSMGO");
    const latest = rows.sort((a, b) => b.asOf.getTime() - a.asOf.getTime())[0];
    expect(latestMarketPrice(world, id ?? 0, "LSMGO")?.priceUsdPerMt).toBe(latest?.priceUsdPerMt);
    expect(latestMarketPrice(world, 999_999, "LSMGO")).toBeNull();
  });

  it("accepts both demo prices within ±15 % of their port's market and rejects a far-off price", () => {
    for (const o of DEMO_SCENARIO.options.filter((x) => x.currency === "USD")) {
      const band = checkPriceBand(world, portId(o.portLocode) ?? 0, "LSMGO", o.pricePerMt, "USD");
      expect(band.passed, band.detail ?? "").toBe(true);
    }
    expect(checkPriceBand(world, portId("MTMLA") ?? 0, "LSMGO", 73.8, "USD").passed).toBe(false);
    expect(checkPriceBand(world, portId("MTMLA") ?? 0, "LSMGO", 7380, "USD").passed).toBe(false);
  });

  it("reads the latest EURUSD reference rate; USD is 1", () => {
    expect(latestUsdRate(world, "USD")).toBe(1);
    const fx = world.referenceRates.filter((r) => r.kind === "fx" && r.key === "EURUSD");
    const latest = fx.sort((a, b) => b.asOf.getTime() - a.asOf.getTime())[0];
    expect(latestUsdRate(world, "EUR")).toBe(latest?.value);
  });

  it("converts EUR with the reference rate before comparing", () => {
    const o = DEMO_SCENARIO.options.find((x) => x.currency === "EUR");
    const band = checkPriceBand(
      world,
      portId(o?.portLocode ?? "") ?? 0,
      "LSMGO",
      o?.pricePerMt ?? 0,
      "EUR",
    );
    expect(band.passed, band.detail ?? "").toBe(true);
  });
});
