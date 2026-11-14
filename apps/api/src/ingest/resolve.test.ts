import { DEMO_SCENARIO, generateWorld } from "@pharos/db";
import { describe, expect, it } from "vitest";
import { FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";
import {
  currentVoyage,
  latestMarketPrice,
  openRequirement,
  priceWithinBand,
  resolvePort,
  resolveSupplier,
  resolveVessel,
} from "./resolve.js";

const world = generateWorld({ seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR });
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

describe("market band and requirement", () => {
  it("uses the latest market price for the port and grade", () => {
    const id = portId("MTMLA");
    const rows = world.portFuelPrices.filter((p) => p.portId === id && p.grade === "LSMGO");
    const latest = rows.sort((a, b) => b.asOf.getTime() - a.asOf.getTime())[0];
    expect(latestMarketPrice(world, id ?? 0, "LSMGO")?.priceUsdPerMt).toBe(latest?.priceUsdPerMt);
    expect(latestMarketPrice(world, 999_999, "LSMGO")).toBeNull();
  });

  it("accepts both demo prices within ±15 % of their port's market and rejects a far-off price", () => {
    for (const o of DEMO_SCENARIO.options.filter((x) => x.currency === "USD")) {
      const band = priceWithinBand(world, portId(o.portLocode) ?? 0, "LSMGO", o.pricePerMt, "USD");
      expect(band.passed, band.detail ?? "").toBe(true);
    }
    expect(priceWithinBand(world, portId("MTMLA") ?? 0, "LSMGO", 73.8, "USD").passed).toBe(false);
    expect(priceWithinBand(world, portId("MTMLA") ?? 0, "LSMGO", 7380, "USD").passed).toBe(false);
  });

  it("converts EUR with the reference rate before comparing", () => {
    const o = DEMO_SCENARIO.options.find((x) => x.currency === "EUR");
    const band = priceWithinBand(
      world,
      portId(o?.portLocode ?? "") ?? 0,
      "LSMGO",
      o?.pricePerMt ?? 0,
      "EUR",
    );
    expect(band.passed, band.detail ?? "").toBe(true);
  });

  it("finds the open LSMGO requirement on Aegean Pioneer's current voyage, none for HSFO", () => {
    const voyage = currentVoyage(world, pioneer?.id ?? 0);
    expect(voyage?.voyageNo).toBe(DEMO_SCENARIO.voyageNo);
    const req = openRequirement(world, pioneer?.id ?? 0, "LSMGO");
    expect(req?.qtyMt).toBe(DEMO_SCENARIO.requirement.qtyMt);
    expect(req?.voyageId).toBe(voyage?.id);
    expect(openRequirement(world, pioneer?.id ?? 0, "HSFO")).toBeNull();
  });
});
