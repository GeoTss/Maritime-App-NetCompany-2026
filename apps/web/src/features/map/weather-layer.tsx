/**
 * Waves and wind from one `WeatherView` forecast step, as soft darts pointing the way each
 * travels. A dart grows, brightens and firms up with the wave height or the wind speed; a wave
 * dart turns storm-coloured at the planning limit the API sends (`heavyWeatherWaveM`). The stops
 * below are a drawing scale, not results: the routing maths never reads them.
 */
import type { WeatherView } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { MapColors } from "./basemap-style";
import { DART_IMAGE, dartFeatures } from "./weather-darts";

/** Wind speeds (kn) where the wind dart steps up: breeze, fresh, strong, gale. */
const WIND_STOPS = [0, 10, 20, 34] as const;

const softDart = {
  "icon-rotate": ["get", "dir"] as never,
  "icon-rotation-alignment": "map" as const,
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
};

export function WeatherLayer({
  weather,
  colors,
  show,
}: {
  weather: WeatherView;
  colors: MapColors;
  show: { waves: boolean; wind: boolean };
}) {
  const waves = useMemo(() => dartFeatures(weather, "waves"), [weather]);
  const wind = useMemo(() => dartFeatures(weather, "wind"), [weather]);
  const limit = weather.heavyWeatherWaveM;
  // The ramps must rise: a limit at or under 4 m would break `interpolate`, so the storm stop sits
  // just above the last wave stop then.
  const top = Math.max(limit, 4.01);

  const waveColor = [
    "step",
    ["get", "v"],
    [
      "interpolate",
      ["linear"],
      ["get", "v"],
      0,
      colors.waveDart0,
      1,
      colors.waveDart1,
      2.5,
      colors.waveDart2,
      4,
      colors.waveDart3,
    ],
    limit,
    colors.storm,
  ] as never;
  const windColor = [
    "interpolate",
    ["linear"],
    ["get", "v"],
    WIND_STOPS[0],
    colors.wind0,
    WIND_STOPS[1],
    colors.wind1,
    WIND_STOPS[2],
    colors.wind2,
    WIND_STOPS[3],
    colors.wind3,
  ] as never;

  return (
    <>
      {show.waves ? (
        <Source id="weather-waves" type="geojson" data={waves}>
          <Layer
            id="weather-waves"
            type="symbol"
            layout={{
              ...softDart,
              "icon-image": DART_IMAGE.wave,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["get", "v"],
                0,
                0.45,
                2,
                0.65,
                4,
                0.9,
                top,
                1.15,
              ] as never,
            }}
            paint={{
              "icon-color": waveColor,
              "icon-opacity": [
                "interpolate",
                ["linear"],
                ["get", "v"],
                0,
                0.45,
                2,
                0.65,
                4,
                0.85,
                top,
                1,
              ] as never,
              "icon-halo-color": waveColor,
              "icon-halo-width": 1,
              "icon-halo-blur": 1.5,
            }}
          />
        </Source>
      ) : null}
      {show.wind ? (
        <Source id="weather-wind" type="geojson" data={wind}>
          <Layer
            id="weather-wind"
            type="symbol"
            layout={{
              ...softDart,
              "icon-image": DART_IMAGE.wind,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["get", "v"],
                0,
                0.4,
                10,
                0.55,
                20,
                0.75,
                34,
                0.95,
                48,
                1.15,
              ] as never,
            }}
            paint={{
              "icon-color": windColor,
              "icon-opacity": ["interpolate", ["linear"], ["get", "v"], 0, 0.45, 34, 1] as never,
              "icon-halo-color": windColor,
              "icon-halo-width": 0.5,
              "icon-halo-blur": 1,
            }}
          />
        </Source>
      ) : null}
    </>
  );
}
