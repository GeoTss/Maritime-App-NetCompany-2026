import { AisObservation, AisStreamMessage } from "@pharos/shared";

const NAV_STATUS: Record<number, string> = {
  0: "under way using engine",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by draught",
  5: "moored",
  6: "aground",
  7: "engaged in fishing",
  8: "under way sailing",
  11: "power-driven vessel towing astern",
  12: "power-driven vessel pushing ahead",
  14: "AIS-SART active",
};

function shipType(
  code: number | null | undefined,
): "cargo" | "tanker" | "passenger" | "other" | null {
  if (code == null) return null;
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  if (code >= 60 && code <= 69) return "passenger";
  return "other";
}

const cleanName = (v: string | null | undefined): string | null => {
  // AIS pads names with "@" and spaces.
  const t = (v ?? "").replace(/@+/g, " ").trim();
  return t === "" ? null : t;
};

/** AISStream sends "2026-11-15 10:00:00.123456789 +0000 UTC"; ISO strings are accepted too. */
function parseTime(v: string | null | undefined, fallback: Date): string {
  if (v) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))? \+0000 UTC$/.exec(v.trim());
    const ms = m
      ? Date.parse(`${m[1]}T${m[2]}.${(m[3] ?? "0").padEnd(3, "0").slice(0, 3)}Z`)
      : Date.parse(v);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return fallback.toISOString();
}

/** Raw AISStream message to a normalised observation; null for anything unusable. Never throws. */
export function normaliseAisMessage(raw: unknown, now: Date = new Date()): AisObservation | null {
  const parsed = AisStreamMessage.safeParse(raw);
  if (!parsed.success) return null;
  const { MessageType, MetaData, Message } = parsed.data;
  const ts = parseTime(MetaData.time_utc, now);

  if (MessageType === "PositionReport" && Message.PositionReport) {
    const p = Message.PositionReport;
    const mmsi = String(MetaData.MMSI ?? p.UserID);
    if (!Number.isFinite(p.Latitude) || p.Latitude < -90 || p.Latitude > 90) return null;
    if (!Number.isFinite(p.Longitude) || p.Longitude < -180 || p.Longitude > 180) return null;
    const sog = p.Sog;
    const cog = p.Cog;
    const status = p.NavigationalStatus;
    return validated({
      kind: "position",
      mmsi,
      name: cleanName(MetaData.ShipName),
      lat: p.Latitude,
      lon: p.Longitude,
      sogKn: sog == null || sog >= 102.3 || sog < 0 ? null : sog,
      cogDeg: cog == null || cog >= 360 || cog < 0 ? null : cog,
      navStatus: status == null ? null : (NAV_STATUS[status] ?? null),
      ts,
    });
  }

  if (MessageType === "ShipStaticData" && Message.ShipStaticData) {
    const s = Message.ShipStaticData;
    return validated({
      kind: "static",
      mmsi: String(MetaData.MMSI ?? s.UserID),
      name: cleanName(s.Name) ?? cleanName(MetaData.ShipName),
      shipType: shipType(s.Type),
      destination: cleanName(s.Destination),
      ts,
    });
  }
  return null;
}

function validated(o: unknown): AisObservation | null {
  const r = AisObservation.safeParse(o);
  return r.success ? r.data : null;
}
