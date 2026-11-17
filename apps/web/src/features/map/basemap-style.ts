/**
 * The map's offline style, built in code: background = sea, fill = land, line = coast, from the
 * bundled Natural Earth land. No `glyphs`, no `sprite`, no tile URL: every label is an HTML marker.
 * Colours come from the CSS tokens at runtime so the map follows the design system.
 */
import type { StyleSpecification } from "maplibre-gl";

export interface MapColors {
  sea: string;
  land: string;
  coast: string;
  traffic: string;
  wave0: string;
  wave1: string;
  wave2: string;
  wave3: string;
  plan: string;
  alarm: string;
  beacon: string;
  caution: string;
  text: string;
}

/** CSS custom property behind each map colour. */
const TOKEN: Record<keyof MapColors, string> = {
  sea: "--map-sea",
  land: "--map-land",
  coast: "--map-coast",
  traffic: "--map-traffic",
  wave0: "--wave-0",
  wave1: "--wave-1",
  wave2: "--wave-2",
  wave3: "--wave-3",
  plan: "--plan",
  alarm: "--alarm",
  beacon: "--beacon",
  caution: "--caution",
  text: "--text-1",
};

/** Used only where the stylesheet is not loaded (tests): a neutral grey, never a design colour. */
const UNSET = "rgb(128 128 128)";

export function readMapColors(root: Element = document.documentElement): MapColors {
  const style = getComputedStyle(root);
  const read = (key: keyof MapColors) => style.getPropertyValue(TOKEN[key]).trim() || UNSET;
  return Object.fromEntries(
    (Object.keys(TOKEN) as (keyof MapColors)[]).map((k) => [k, read(k)]),
  ) as unknown as MapColors;
}

export const LAND_PATH = "/basemap.generated.geojson";

export function buildBasemapStyle(colors: MapColors, landUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: { land: { type: "geojson", data: landUrl } },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": colors.sea } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": colors.land } },
      {
        id: "coast",
        type: "line",
        source: "land",
        paint: { "line-color": colors.coast, "line-width": 0.8 },
      },
    ],
  };
}

/** The demo region and the opening frame: the Mediterranean, with the managed fleet in view. */
export const DEMO_BOUNDS: [[number, number], [number, number]] = [
  [-20, 25],
  [45, 66],
];

export const DEMO_VIEW = { longitude: 20, latitude: 36, zoom: 4.2 } as const;
