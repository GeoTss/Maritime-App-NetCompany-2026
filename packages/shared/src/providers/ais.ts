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
]);
export type AisObservation = z.infer<typeof AisObservation>;

/** One line of the recorded capture file: the raw message and its offset from the start. */
export const AisCaptureLine = z
  .object({ offsetMs: z.number().int().nonnegative(), message: z.unknown() })
  .strict();
export type AisCaptureLine = z.infer<typeof AisCaptureLine>;
