/**
 * Demo scenario weather: waves and wind laid over a forecast grid inside circles, from a start to
 * an end the presenter sets. A grid point within an area's radius takes its four values at the
 * steps inside the window, is marked synthetic, and carries the window, so it holds past the
 * forecast's last step too; a later area wins where two overlap.
 */

import type { Sql } from "@pharos/db";
import { greatCircleNm, scenarioOn } from "@pharos/domain";
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
  const stepMs = grid.stepHours * 3_600_000;
  const start = Date.parse(grid.startAt);
  const on = (a: ScenarioWeatherArea, k: number) =>
    scenarioOn({ from: a.from, until: a.until }, new Date(start + k * stepMs));
  return {
    ...grid,
    points: grid.points.map((p) => {
      const area = areas.findLast((a) => inside(p, a));
      if (!area) return p;
      const at = <T>(series: T[], value: T) => series.map((v, k) => (on(area, k) ? value : v));
      return {
        ...p,
        waveHeightM: at(p.waveHeightM, area.waveHeightM),
        waveDirDeg: at(p.waveDirDeg, area.waveDirDeg),
        windSpeedKn: at(p.windSpeedKn, area.windSpeedKn),
        windDirDeg: at(p.windDirDeg, area.windDirDeg),
        synthetic: true as const,
        // The window rides along: sampling holds it past the forecast's last step too.
        scenario: {
          from: area.from,
          until: area.until,
          waveHeightM: area.waveHeightM,
          waveDirDeg: area.waveDirDeg,
          windSpeedKn: area.windSpeedKn,
          windDirDeg: area.windDirDeg,
        },
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
      active_from: Date | string | null;
      active_until: Date | string | null;
    }[]
  >`select id, label, lat, lon, radius_nm, wave_height_m, wave_dir_deg, wind_speed_kn, wind_dir_deg,
      active_from, active_until
    from scenario_weather_areas order by id`;
  const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    center: { lat: r.lat, lon: r.lon },
    radiusNm: r.radius_nm,
    waveHeightM: r.wave_height_m,
    waveDirDeg: r.wave_dir_deg,
    windSpeedKn: r.wind_speed_kn,
    windDirDeg: r.wind_dir_deg,
    from: iso(r.active_from),
    until: iso(r.active_until),
  }));
}
