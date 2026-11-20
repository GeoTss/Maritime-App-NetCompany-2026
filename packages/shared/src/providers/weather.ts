/** Open-Meteo response shapes (marine and forecast APIs), series allowing nulls. */
import { z } from "zod";

const Series = z.array(z.number().nullable());

const location = <T extends z.ZodRawShape>(series: T) =>
  z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      hourly: z.object({ time: z.array(z.string()), ...series }).loose(),
    })
    .loose();

const oneOrMany = <T extends z.ZodType>(item: T) => z.union([item, z.array(item)]);

export const OpenMeteoMarineLocation = location({
  wave_height: Series.optional(),
  wave_direction: Series.optional(),
  ocean_current_velocity: Series.optional(),
  ocean_current_direction: Series.optional(),
});
export const OpenMeteoMarineResponse = oneOrMany(OpenMeteoMarineLocation);
export type OpenMeteoMarineResponse = z.infer<typeof OpenMeteoMarineResponse>;

export const OpenMeteoForecastLocation = location({
  wind_speed_10m: Series.optional(),
  wind_direction_10m: Series.optional(),
});
export const OpenMeteoForecastResponse = oneOrMany(OpenMeteoForecastLocation);
export type OpenMeteoForecastResponse = z.infer<typeof OpenMeteoForecastResponse>;
