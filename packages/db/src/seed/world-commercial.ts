/** Suppliers, market data and commercial history for the synthetic world. */
import { FUEL_GRADES, type Port, type Voyage } from "@pharos/shared";
import { type Prng, prngInt } from "./prng.js";
import {
  DEMO_SCENARIO,
  FIXED_WAITING_HOURS,
  PRICE_BANDS,
  REFERENCE_RATES,
  SUPPLIERS,
} from "./scenario.js";
import type { World } from "./types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Commercial = Pick<
  World,
  | "suppliers"
  | "portFuelPrices"
  | "portCongestion"
  | "bunkerRequirements"
  | "quotes"
  | "quoteLines"
  | "purchaseOrders"
  | "orderLines"
  | "referenceRates"
>;

export function buildCommercial(
  anchor: Date,
  prng: Prng,
  ports: Port[],
  voyages: Voyage[],
): Commercial {
  const t = (offsetMs: number): Date => new Date(anchor.getTime() + offsetMs);
  const portId = (code: string): number => {
    const p = ports.find((x) => x.unlocode === code);
    if (!p) throw new Error(`unknown port ${code}`);
    return p.id;
  };
  const voyageId = (no: string): number => {
    const v = voyages.find((x) => x.voyageNo === no);
    if (!v) throw new Error(`unknown voyage ${no}`);
    return v.id;
  };

  const suppliers = SUPPLIERS.map((s, i) => ({
    id: i + 1,
    name: s.name,
    emailDomain: s.emailDomain,
    erpCode: s.erpCode,
    portIds: s.ports.map(portId),
  }));
  const supplierId = (key: string): number => {
    const i = SUPPLIERS.findIndex((s) => s.key === key);
    if (i < 0) throw new Error(`unknown supplier ${key}`);
    return i + 1;
  };

  const portFuelPrices: World["portFuelPrices"] = [];
  for (const p of ports) {
    for (const grade of FUEL_GRADES) {
      const [lo, hi] = PRICE_BANDS[grade];
      portFuelPrices.push({
        id: portFuelPrices.length + 1,
        portId: p.id,
        grade,
        // Half-dollar steps inside the band.
        priceUsdPerMt: lo + prngInt(prng, 0, (hi - lo) * 2) / 2,
        asOf: t(-3 * HOUR_MS),
        source: "seed",
      });
    }
  }

  const portCongestion: World["portCongestion"] = ports.map((p, i) => ({
    id: i + 1,
    portId: p.id,
    observedAt: t(-1 * HOUR_MS),
    anchoredCount: prngInt(prng, 2, 24),
    waitingHours: FIXED_WAITING_HOURS[p.unlocode] ?? prngInt(prng, 2, 20),
    source: "seed",
  }));

  const bunkerRequirements: World["bunkerRequirements"] = [
    {
      id: 1,
      voyageId: voyageId(DEMO_SCENARIO.voyageNo),
      grade: DEMO_SCENARIO.requirement.grade,
      qtyMt: DEMO_SCENARIO.requirement.qtyMt,
      status: "open",
      createdAt: t(-2 * HOUR_MS),
    },
    {
      id: 2,
      voyageId: voyageId("TS-2609"),
      grade: "LSMGO",
      qtyMt: 250,
      status: "ordered",
      createdAt: t(-6 * DAY_MS),
    },
    {
      id: 3,
      voyageId: voyageId("AM-2612"),
      grade: "VLSFO",
      qtyMt: 400,
      status: "ordered",
      createdAt: t(-5 * DAY_MS),
    },
  ];

  // History: two ordered quotes (with confirmed POs) and two expired competitors.
  const history = [
    {
      req: 2,
      supplier: "kestrel",
      port: "GRPIR",
      currency: "USD",
      barge: 2_500,
      status: "ordered",
      grade: "LSMGO",
      qty: 250,
      price: 745,
      daysAgo: 5,
    },
    {
      req: 2,
      supplier: "meridian",
      port: "GRPIR",
      currency: "USD",
      barge: 1_800,
      status: "expired",
      grade: "LSMGO",
      qty: 250,
      price: 752,
      daysAgo: 5,
    },
    {
      req: 3,
      supplier: "atlanticshelf",
      port: "PTSIE",
      currency: "USD",
      barge: 2_200,
      status: "ordered",
      grade: "VLSFO",
      qty: 400,
      price: 588,
      daysAgo: 4,
    },
    {
      req: 3,
      supplier: "nordwind",
      port: "ESALG",
      currency: "EUR",
      barge: 2_600,
      status: "expired",
      grade: "VLSFO",
      qty: 400,
      price: 548,
      daysAgo: 4,
    },
  ] as const;

  const quotes: World["quotes"] = [];
  const quoteLines: World["quoteLines"] = [];
  const purchaseOrders: World["purchaseOrders"] = [];
  const orderLines: World["orderLines"] = [];
  for (const h of history) {
    const received = -h.daysAgo * DAY_MS;
    const quote = {
      id: quotes.length + 1,
      supplierId: supplierId(h.supplier),
      portId: portId(h.port),
      requirementId: h.req,
      deliveryFrom: t(received + 1 * DAY_MS),
      deliveryTo: t(received + 3 * DAY_MS),
      validUntil: t(received + 1 * DAY_MS),
      currency: h.currency,
      bargeFee: h.barge,
      status: h.status,
      extractionId: null,
      receivedAt: t(received),
    };
    quotes.push(quote);
    quoteLines.push({
      id: quoteLines.length + 1,
      quoteId: quote.id,
      grade: h.grade,
      qtyMt: h.qty,
      pricePerMt: h.price,
    });
    if (h.status === "ordered") {
      const id = purchaseOrders.length + 1;
      purchaseOrders.push({
        id,
        quoteId: quote.id,
        recommendationId: null,
        status: "confirmed",
        erpPoNumber: `PO-2026-${String(410 + id * 4).padStart(4, "0")}`,
        erpSyncStatus: "synced",
        idempotencyKey: `seed-po-${id}`,
        createdAt: t(received + 6 * HOUR_MS),
      });
      orderLines.push({
        id: orderLines.length + 1,
        orderId: id,
        grade: h.grade,
        qtyMt: h.qty,
        pricePerMt: h.price,
      });
    }
  }

  const referenceRates: World["referenceRates"] = [
    {
      id: 1,
      kind: "fx",
      key: "EURUSD",
      value: REFERENCE_RATES.EURUSD,
      asOf: t(-12 * HOUR_MS),
      source: "seed",
    },
    {
      id: 2,
      kind: "eua",
      key: "EUA",
      value: REFERENCE_RATES.EUA_EUR,
      asOf: t(-12 * HOUR_MS),
      source: "seed",
    },
  ];

  return {
    suppliers,
    portFuelPrices,
    portCongestion,
    bunkerRequirements,
    quotes,
    quoteLines,
    purchaseOrders,
    orderLines,
    referenceRates,
  };
}
