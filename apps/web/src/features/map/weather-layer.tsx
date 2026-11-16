/**
 * Wave height and direction from one `WeatherView` forecast step. Dot size and brightness follow
 * the wave height; a tick shows the direction the waves travel. The tick's length is drawing
 * geometry, not a result.
 */
import type { WeatherView } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { MapColors } from "./basemap-style";

/** Degrees of latitude a direction tick spans on the map. */
const TICK_DEG = 0.7;

export function WeatherLayer({ weather, colors }: { weather: WeatherView; colors: MapColors }) {
  const { dots, ticks } = useMemo(() => {
    const dotFeatures = [];
    const tickFeatures = [];
    for (const p of weather.points) {
      if (p.waveHeightM === null) continue;
      dotFeatures.push({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { h: p.waveHeightM },
      });
      if (p.waveDirDeg !== null) {
        // Wave direction is where waves come from; the tick points the way they travel.
        const rad = ((p.waveDirDeg + 180) * Math.PI) / 180;
        const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
        tickFeatures.push({
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [p.lon, p.lat],
              [p.lon + (Math.sin(rad) * TICK_DEG) / cosLat, p.lat + Math.cos(rad) * TICK_DEG],
            ],
          },
          properties: { h: p.waveHeightM },
        });
      }
    }
    return {
      dots: { type: "FeatureCollection" as const, features: dotFeatures },
      ticks: { type: "FeatureCollection" as const, features: tickFeatures },
    };
  }, [weather]);

  return (
    <>
      <Source id="weather-ticks" type="geojson" data={ticks}>
        <Layer
          id="weather-ticks"
          type="line"
          paint={{
            "line-color": colors.beacon,
            "line-width": 1,
            "line-opacity": ["interpolate", ["linear"], ["get", "h"], 0.5, 0.4, 4, 1],
          }}
        />
      </Source>
      <Source id="weather-dots" type="geojson" data={dots}>
        <Layer
          id="weather-points"
          type="circle"
          paint={{
            "circle-color": colors.beacon,
            "circle-radius": ["interpolate", ["linear"], ["get", "h"], 0, 1.5, 2, 4, 5, 8],
            "circle-opacity": ["interpolate", ["linear"], ["get", "h"], 0.5, 0.45, 4, 1],
          }}
        />
      </Source>
    </>
  );
}
