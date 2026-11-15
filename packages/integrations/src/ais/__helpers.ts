/** Hand-built messages in the AISStream shape, for tests. */
export const position = (
  mmsi: number,
  lat: number,
  lon: number,
  extra: Record<string, unknown> = {},
  time = "2026-11-15 10:00:00.123456789 +0000 UTC",
) => ({
  MessageType: "PositionReport",
  MetaData: { MMSI: mmsi, ShipName: "  TEST ONE  ", latitude: lat, longitude: lon, time_utc: time },
  Message: {
    PositionReport: {
      UserID: mmsi,
      Latitude: lat,
      Longitude: lon,
      Sog: 0.1,
      Cog: 90,
      NavigationalStatus: 1,
      ...extra,
    },
  },
});

export const staticData = (mmsi: number, extra: Record<string, unknown> = {}) => ({
  MessageType: "ShipStaticData",
  MetaData: {
    MMSI: mmsi,
    ShipName: "STATIC NAME",
    time_utc: "2026-11-15 10:00:00.000000000 +0000 UTC",
  },
  Message: {
    ShipStaticData: {
      UserID: mmsi,
      Name: "STATIC NAME@@",
      Destination: "PIRAEUS ",
      Type: 81,
      ...extra,
    },
  },
});
