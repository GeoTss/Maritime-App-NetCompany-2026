/**
 * The weather darts: one feature per forecast point that has both a value and a direction, and
 * the dart images the symbol layers draw. A dart points the way the field travels: the forecast
 * gives the direction waves and wind come from, so the dart turns 180° from it. Turning and the
 * image are drawing geometry, not results.
 */
import type { WeatherView } from "@pharos/shared";

export type DartField = "waves" | "wind";

export interface DartFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  /** `keep`: drawn when zoomed out too (every other grid point, as a checkerboard). */
  properties: { v: number; dir: number; keep: boolean };
}
export interface DartCollection {
  type: "FeatureCollection";
  features: DartFeature[];
}

export const DART_IMAGE = { wave: "dart-wave", wind: "dart-wind" } as const;

/** The grid's spacing (degrees): the smallest gap between two distinct latitudes or longitudes. */
function gridStep(points: WeatherView["points"]): number {
  let step = Number.POSITIVE_INFINITY;
  for (const axis of ["lat", "lon"] as const) {
    const values = [...new Set(points.map((p) => p[axis]))].sort((a, b) => a - b);
    for (let i = 1; i < values.length; i++) {
      step = Math.min(step, (values[i] as number) - (values[i - 1] as number));
    }
  }
  return Number.isFinite(step) && step > 0 ? step : 1;
}

export function dartFeatures(weather: WeatherView, field: DartField): DartCollection {
  const features: DartFeature[] = [];
  const step = gridStep(weather.points);
  for (const p of weather.points) {
    const v = field === "waves" ? p.waveHeightM : p.windSpeedKn;
    const from = field === "waves" ? p.waveDirDeg : p.windDirDeg;
    if (v === null || from === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        v,
        dir: (from + 180) % 360,
        keep: (Math.round(p.lat / step) + Math.round(p.lon / step)) % 2 === 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * A dart drawn white on transparent for an SDF image (MapLibre tints it with `icon-color`), tip up.
 * `wave` is a broad chevron with rounded corners; `wind` a slim kite. Null without a canvas (tests).
 */
export function drawDart(kind: "wave" | "wind", px = 48): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "white";
  ctx.strokeStyle = "white";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "wave") {
    ctx.lineWidth = px * 0.08;
    ctx.moveTo(px * 0.5, px * 0.14);
    ctx.lineTo(px * 0.84, px * 0.8);
    ctx.lineTo(px * 0.5, px * 0.62);
    ctx.lineTo(px * 0.16, px * 0.8);
  } else {
    ctx.lineWidth = px * 0.04;
    ctx.moveTo(px * 0.5, px * 0.08);
    ctx.lineTo(px * 0.64, px * 0.7);
    ctx.lineTo(px * 0.5, px * 0.92);
    ctx.lineTo(px * 0.36, px * 0.7);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}
