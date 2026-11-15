/** AISStream wire format (loose envelope) and the normalised observation the worker stores. */
import { z } from "zod";
import { IsoDateTime, LatLon } from "../primitives.js";

export const AisPositionReport = z
  .object({
    UserID: z.number().int(),
    Latitude: z.number(),
    Longitude: z.number(),
    Sog: z.number().nullish(),
    Cog: z.number().nullish(),
    NavigationalStatus: z.number().int().nullish(),
    TrueHeading: z.number().nullish(),
  })
  .loose();
export type AisPositionReport = z.infer<typeof AisPositionReport>;

export const AisShipStaticData = z
  .object({
    UserID: z.number().int(),
    Name: z.string().nullish(),
    Destination: z.string().nullish(),
    Type: z.number().int().nullish(),
    ImoNumber: z.number().int().nullish(),
  })
  .loose();
export type AisShipStaticData = z.infer<typeof AisShipStaticData>;

/** Message types 12 and 14 (addressed and broadcast safety text). */
export const AisSafetyMessage = z.object({ UserID: z.number().int(), Text: z.string() }).loose();
/** Message type 21 (aid to navigation). */
export const AisAidsToNavigationReport = z
  .object({
    UserID: z.number().int(),
    Name: z.string().nullish(),
    Latitude: z.number(),
    Longitude: z.number(),
    VirtualAtoN: z.boolean().nullish(),
  })
  .loose();
/** Message type 9 (search-and-rescue aircraft position). */
export const AisSarAircraftReport = z
  .object({ UserID: z.number().int(), Latitude: z.number(), Longitude: z.number() })
  .loose();

export const AisStreamMessage = z
  .object({
    MessageType: z.string().min(1),
    MetaData: z
      .object({
        MMSI: z.number().int().nullish(),
        ShipName: z.string().nullish(),
        latitude: z.number().nullish(),
        longitude: z.number().nullish(),
        time_utc: z.string().nullish(),
      })
      .loose(),
    Message: z
      .object({
        PositionReport: AisPositionReport.optional(),
        ShipStaticData: AisShipStaticData.optional(),
        SafetyBroadcastMessage: AisSafetyMessage.optional(),
        AddressedSafetyMessage: AisSafetyMessage.optional(),
        AidsToNavigationReport: AisAidsToNavigationReport.optional(),
        StandardSearchAndRescueAircraftReport: AisSarAircraftReport.optional(),
      })
      .loose(),
  })
  .loose();
export type AisStreamMessage = z.infer<typeof AisStreamMessage>;

const Mmsi = z.string().regex(/^\d{9}$/);

export const AisObservation = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("position"),
      mmsi: Mmsi,
      name: z.string().nullable(),
      lat: LatLon.shape.lat,
      lon: LatLon.shape.lon,
      sogKn: z.number().nullable(),
      cogDeg: z.number().nullable(),
      navStatus: z.string().nullable(),
      ts: IsoDateTime,
    })
    .strict(),
  z
    .object({
      kind: z.literal("static"),
      mmsi: Mmsi,
      name: z.string().nullable(),
      shipType: z.enum(["cargo", "tanker", "passenger", "other"]).nullable(),
      destination: z.string().nullable(),
      ts: IsoDateTime,
    })
    .strict(),
  z
    .object({ kind: z.literal("safety"), mmsi: Mmsi, text: z.string().min(1), ts: IsoDateTime })
    .strict(),
  z
    .object({
      kind: z.literal("aton"),
      mmsi: Mmsi,
      name: z.string().nullable(),
      lat: LatLon.shape.lat,
      lon: LatLon.shape.lon,
      virtual: z.boolean(),
      ts: IsoDateTime,
    })
    .strict(),
  z
    .object({
      kind: z.literal("sar"),
      mmsi: Mmsi,
      lat: LatLon.shape.lat,
      lon: LatLon.shape.lon,
      ts: IsoDateTime,
    })
    .strict(),
  /** A position report from an AIS-SART, man-overboard or EPIRB-AIS device (MMSI 970, 972, 974). */
  z
    .object({
      kind: z.literal("distress"),
      mmsi: Mmsi,
      lat: LatLon.shape.lat,
      lon: LatLon.shape.lon,
      ts: IsoDateTime,
    })
    .strict(),
]);
export type AisObservation = z.infer<typeof AisObservation>;

/** One line of the recorded capture file: the raw message and its offset from the start. */
export const AisCaptureLine = z
  .object({ offsetMs: z.number().int().nonnegative(), message: z.unknown() })
  .strict();
export type AisCaptureLine = z.infer<typeof AisCaptureLine>;
