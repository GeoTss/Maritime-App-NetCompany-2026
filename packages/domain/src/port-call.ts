/**
 * The port call around a stop: what the voyage needs (provisions, waste delivery, charts and
 * publications), what the port can do, what it costs and how long it takes, and the notices due
 * before arrival. Pure: `now` and every input come in as arguments.
 */
import {
  type CostLine,
  FUEL_GRADES,
  type GradeAmounts,
  type LatLon,
  type NauticalItem,
  type OnBoardItem,
  type OutdatedItem,
  type PortCallJob,
  type PortCallResult,
  type PortCallTerms,
  type PreArrivalNotice,
  type StopPlanReason,
  type VesselStores,
} from "@pharos/shared";
import type { AreaPass } from "./areas.js";
import { inArea } from "./areas.js";
import {
  NOTICE_LEAD_HOURS,
  PROVISIONS_RESERVE_DAYS,
  PROVISIONS_TARGET_DAYS,
  SEWAGE_M3_PER_PERSON_DAY,
  SLUDGE_M3_PER_MT,
  WASTE_MAX_FILL,
} from "./constants.js";

const HOUR_MS = 3_600_000;

/** Days of provisions left after `hours`: one person-day per crew member per day. */
export function provisionsDaysLeft(stores: VesselStores, hours: number): number {
  return (stores.provisionsPersonDays - (stores.crew * hours) / 24) / stores.crew;
}

/** Purifier sludge (m³) left by burning `fuelMt`. */
export function sludgeGeneratedM3(fuelMt: GradeAmounts): number {
  let m3 = 0;
  for (const g of FUEL_GRADES) m3 += fuelMt[g] * SLUDGE_M3_PER_MT[g];
  return m3;
}

/** Sewage (m³) into the holding tank over `portHours` in port or at anchor. */
export function sewageGeneratedM3(crew: number, portHours: number): number {
  return (crew * SEWAGE_M3_PER_PERSON_DAY * portHours) / 24;
}

/**
 * The notices due before arriving at `arriveAt`: the agent's appointment and security information
 * always, the advance waste notification at EU ports. Due `NOTICE_LEAD_HOURS` before arrival;
 * overdue when that is before `now`.
 */
export function preArrivalNotices(
  arriveAt: Date,
  portIsEu: boolean,
  now: Date,
): PreArrivalNotice[] {
  const kinds: PreArrivalNotice["kind"][] = ["agent_appointment", "security_pre_arrival"];
  if (portIsEu) kinds.push("eu_waste_notification");
  return kinds.map((kind) => {
    const due = arriveAt.getTime() - NOTICE_LEAD_HOURS[kind] * HOUR_MS;
    return { kind, dueAt: new Date(due).toISOString(), overdue: due < now.getTime() };
  });
}

/**
 * Charts and publications the route needs (it enters their area) that are missing on board or
 * older than the current edition. In time when the stop comes before the area, or lies inside it.
 * In catalogue order.
 */
export function outdatedItems(
  onBoard: OnBoardItem[],
  catalogue: NauticalItem[],
  passes: AreaPass[],
  stop: { nm: number; position: LatLon },
  timeAtNm: (nm: number) => string,
): OutdatedItem[] {
  const enter = new Map(passes.map((p) => [p.areaId, p.enterNm]));
  const held = new Map(onBoard.map((o) => [o.itemId, o]));
  const out: OutdatedItem[] = [];
  for (const item of catalogue) {
    const enterNm = enter.get(item.itemId);
    if (enterNm === undefined) continue;
    const mine = held.get(item.itemId);
    if (mine && mine.editionDate >= item.editionDate) continue;
    out.push({
      itemId: item.itemId,
      kind: item.kind,
      title: item.title,
      onBoardEdition: mine ? mine.edition : null,
      currentEdition: item.edition,
      priceUsd: item.priceUsd,
      neededAt: timeAtNm(enterNm),
      inTime: stop.nm <= enterNm || inArea(stop.position, item.coverage),
    });
  }
  return out;
}

/** Catalogue items missing on board or held at an older edition, wherever the vessel sails. */
export function outdatedOnBoard(onBoard: OnBoardItem[], catalogue: NauticalItem[]): NauticalItem[] {
  const held = new Map(onBoard.map((o) => [o.itemId, o.editionDate]));
  return catalogue.filter((i) => {
    const mine = held.get(i.itemId);
    return mine === undefined || mine < i.editionDate;
  });
}

export interface PortCallArgs {
  stores: VesselStores;
  terms: PortCallTerms;
  portIsEu: boolean;
  now: Date;
  arriveAt: Date;
  /** Hours from the start to arrival at the stop. */
  hoursToStop: number;
  /** Hours from the start to arrival at the destination. */
  hoursToEta: number;
  /** Hours at the stop (waiting, clearance, weather, service). */
  stayHours: number;
  /** Fuel burned before reaching the stop, and over the whole voyage. */
  fuelToStopMt: GradeAmounts;
  fuelTotalMt: GradeAmounts;
  outdated: OutdatedItem[];
  bunkeringHours: number;
}

/**
 * What the call does. A job is needed when the voyage would otherwise end with provisions under
 * the reserve, or a waste tank over `WASTE_MAX_FILL`, or when a chart or publication is out of
 * date. The port does it when it can (stores for provisions and charts, reception for waste); a
 * needed provisions or waste job it can't do makes the plan infeasible; charts it can't supply
 * stay listed, not done. Done jobs and the port dues (and the EU waste fee at EU ports) are the
 * cost lines; the jobs run alongside bunkering, so the service takes the longest of them.
 */
export function portCallPlan(
  a: PortCallArgs,
): PortCallResult & { reasons: StopPlanReason[]; serviceHours: number } {
  const { stores, terms } = a;
  const reasons: StopPlanReason[] = [];

  const provNeeded = provisionsDaysLeft(stores, a.hoursToEta) < PROVISIONS_RESERVE_DAYS;
  const provDone = provNeeded && terms.stores;
  const provQty = provNeeded
    ? Math.max(
        0,
        stores.crew * PROVISIONS_TARGET_DAYS -
          (stores.provisionsPersonDays - (stores.crew * a.hoursToStop) / 24),
      )
    : 0;
  if (provNeeded && !terms.stores) reasons.push("provisions_unavailable");

  const chartsNeeded = a.outdated.length > 0;
  const chartsDone = chartsNeeded && terms.stores;
  const chartsCost = a.outdated.reduce((s, o) => s + o.priceUsd, 0);

  const sludgeTotal = sludgeGeneratedM3(a.fuelTotalMt);
  const sludgeToStop = sludgeGeneratedM3(a.fuelToStopMt);
  const sludgeNeeded = stores.sludgeM3 + sludgeTotal > WASTE_MAX_FILL * stores.sludgeCapacityM3;
  const sludgeDone = sludgeNeeded && terms.wasteReception;
  const sludgeQty = sludgeNeeded ? stores.sludgeM3 + sludgeToStop : 0;

  const sewageStay = sewageGeneratedM3(stores.crew, a.stayHours);
  const sewageNeeded = stores.sewageM3 + sewageStay > WASTE_MAX_FILL * stores.sewageCapacityM3;
  const sewageDone = sewageNeeded && terms.wasteReception;
  const sewageQty = sewageNeeded ? stores.sewageM3 + sewageStay : 0;

  if ((sludgeNeeded || sewageNeeded) && !terms.wasteReception) {
    reasons.push("waste_reception_unavailable");
  }

  const storesHours = provDone || chartsDone ? terms.storesHours : 0;
  const wasteHours = sludgeDone || sewageDone ? terms.wasteHours : 0;
  const jobs: PortCallJob[] = [
    {
      kind: "provisions",
      needed: provNeeded,
      done: provDone,
      qty: provQty,
      unit: "person-days",
      costUsd: provDone ? provQty * terms.provisionsUsdPerPersonDay : 0,
      hours: provDone ? terms.storesHours : 0,
    },
    {
      kind: "charts",
      needed: chartsNeeded,
      done: chartsDone,
      qty: a.outdated.length,
      unit: "items",
      costUsd: chartsDone ? chartsCost : 0,
      hours: chartsDone ? terms.storesHours : 0,
    },
    {
      kind: "sludge",
      needed: sludgeNeeded,
      done: sludgeDone,
      qty: sludgeQty,
      unit: "m3",
      costUsd: sludgeDone ? sludgeQty * terms.sludgeUsdPerM3 : 0,
      hours: sludgeDone ? terms.wasteHours : 0,
    },
    {
      kind: "sewage",
      needed: sewageNeeded,
      done: sewageDone,
      qty: sewageQty,
      unit: "m3",
      costUsd: sewageDone ? sewageQty * terms.sewageUsdPerM3 : 0,
      hours: sewageDone ? terms.wasteHours : 0,
    },
  ];

  const costLines: CostLine[] = [{ kind: "port_dues", usd: terms.portDuesUsd }];
  for (const j of jobs) if (j.done) costLines.push({ kind: j.kind, usd: j.costUsd });
  if (a.portIsEu && terms.euWasteFeeUsd > 0) {
    costLines.push({ kind: "eu_waste_fee", usd: terms.euWasteFeeUsd });
  }

  const notices = preArrivalNotices(a.arriveAt, a.portIsEu, a.now);
  if (notices.some((n) => n.overdue)) reasons.push("notice_overdue");

  const afterStopHours = a.hoursToEta - a.hoursToStop;
  return {
    jobs,
    costLines,
    extraCostUsd: costLines.reduce((s, c) => s + c.usd, 0),
    notices,
    outdated: a.outdated,
    provisionsDaysAtEta: provDone
      ? PROVISIONS_TARGET_DAYS - afterStopHours / 24
      : provisionsDaysLeft(stores, a.hoursToEta),
    sludgeM3AtEta: sludgeDone ? sludgeTotal - sludgeToStop : stores.sludgeM3 + sludgeTotal,
    sewageM3AtEta: sewageDone ? 0 : stores.sewageM3 + sewageStay,
    reasons,
    serviceHours: Math.max(a.bunkeringHours, storesHours, wasteHours),
  };
}
