/**
 * Demo scenario weather: stationary waves and wind laid over a forecast grid inside circles, the
 * way the labelled synthetic storm is (`withSyntheticStorm`). A grid point within an area's radius
 * takes its four values at every step and is marked synthetic; a later area wins where two overlap.
 */

import type { Sql } from "@pharos/db";
import { greatCircleNm } from "@pharos/domain";
import type { ScenarioWeatherArea, WeatherGrid } from "@pharos/shared";

const inside = (p: { lat: number; lon: number }, a: ScenarioWeatherArea) =>
  greatCircleNm(p, a.center) <= a.radiusNm;

/** How many grid points an area holds (an area holding none changes nothing). */
export function pointsInArea(grid: WeatherGrid, area: ScenarioWeatherArea): number {
  return grid.points.filter((p) => inside(p, area)).length;
}

export function withWeatherAreas(
  grid: WeatherGrid,
  areas: readonly ScenarioWeatherArea[],
): WeatherGrid {
  if (areas.length === 0) return grid;
  return {
    ...grid,
    points: grid.points.map((p) => {
      const area = areas.findLast((a) => inside(p, a));
      if (!area) return p;
      return {
        ...p,
        waveHeightM: p.waveHeightM.map(() => area.waveHeightM),
        waveDirDeg: p.waveDirDeg.map(() => area.waveDirDeg),
        windSpeedKn: p.windSpeedKn.map(() => area.windSpeedKn),
        windDirDeg: p.windDirDeg.map(() => area.windDirDeg),
        synthetic: true as const,
      };
    }),
  };
}

/** The scenario's weather areas, oldest first (so a later one wins). */
export async function loadWeatherAreas(sql: Sql): Promise<ScenarioWeatherArea[]> {
  const rows = await sql<
    {
      id: number;
      label: string;
      lat: number;
      lon: number;
      radius_nm: number;
      wave_height_m: number;
      wave_dir_deg: number;
      wind_speed_kn: number;
      wind_dir_deg: number;
    }[]
  >`select id, label, lat, lon, radius_nm, wave_height_m, wave_dir_deg, wind_speed_kn, wind_dir_deg
    from scenario_weather_areas order by id`;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    center: { lat: r.lat, lon: r.lon },
    radiusNm: r.radius_nm,
    waveHeightM: r.wave_height_m,
    waveDirDeg: r.wave_dir_deg,
    windSpeedKn: r.wind_speed_kn,
    windDirDeg: r.wind_dir_deg,
  }));
}
