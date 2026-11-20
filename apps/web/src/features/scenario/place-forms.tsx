/**
 * The Hazards and Weather tabs: what is placed now (synthetic hazards and weather areas can be
 * removed; hazards reported on AIS stay), and a form to place another, by typing a position or
 * picking it on the map. While a form holds a valid centre and radius the map draws it, dashed.
 */
import {
  type NavHazardView,
  ScenarioHazardInput,
  type ScenarioWeatherArea,
  ScenarioWeatherAreaInput,
} from "@pharos/shared";
import { useEffect, useState } from "react";
import { DataTag } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { UntrustedText } from "@/components/untrusted-text";
import { formatUtc } from "@/lib/format";
import { useSimClock } from "@/lib/queries";
import {
  coordText,
  DateTimeField,
  fromUtcInput,
  NumberField,
  num,
  PickOnMap,
  type PickRequest,
  TextField,
  utcInput,
} from "./fields";
import type { ScenarioPreview } from "./scenario-data";

interface PlaceProps {
  saving: boolean;
  onPickRequest: PickRequest;
  onPreview: (preview: ScenarioPreview | null) => void;
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="col-span-3 text-xs text-alarm">
      {text}
    </p>
  ) : null;
}

const firstIssue = (issues: { path: PropertyKey[]; message: string }[]) => {
  const i = issues[0];
  return i ? `${i.path.join(".")}: ${i.message}` : "A value is not valid.";
};

/** The placed thing's centre and radius, for the dashed preview, while both are numbers. */
function usePreview(
  kind: ScenarioPreview["kind"],
  lat: string,
  lon: string,
  radius: string,
  onPreview: PlaceProps["onPreview"],
) {
  useEffect(() => {
    const [a, o, r] = [num(lat), num(lon), num(radius)];
    onPreview(
      a !== undefined && o !== undefined && r !== undefined && r > 0
        ? { kind, center: { lat: a, lon: o }, radiusNm: r }
        : null,
    );
  }, [kind, lat, lon, radius, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
}

export function HazardForm({
  hazards,
  onAdd,
  onRemove,
  ...place
}: PlaceProps & {
  hazards: NavHazardView[];
  onAdd: (input: ScenarioHazardInput) => void;
  onRemove: (id: string) => void;
}) {
  const [label, setLabel] = useState("Container adrift");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("10");
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  usePreview("hazard", lat, lon, radius, place.onPreview);
  const synthetic = hazards.filter((h) => h.source === "synthetic");
  const reported = hazards.length - synthetic.length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col" aria-label="Synthetic hazards">
        {synthetic.map((h) => (
          <li key={h.id} className="flex items-center gap-2 border-b border-line py-1 text-xs">
            <DataTag kind="synthetic" />
            <span className="min-w-0 flex-1 truncate text-text-1">
              <UntrustedText text={h.label} />
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={place.saving}
              onClick={() => onRemove(h.id)}
              aria-label={`Remove hazard ${h.label}`}
            >
              Remove
            </Button>
          </li>
        ))}
        {synthetic.length === 0 ? (
          <li className="text-xs text-text-2">No synthetic hazards.</li>
        ) : null}
      </ul>
      {reported > 0 ? (
        <p className="text-2xs text-text-3">
          Hazards reported on AIS stay; they are not demo data.
        </p>
      ) : null}
      <form
        className="grid grid-cols-3 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = ScenarioHazardInput.safeParse({
            label,
            lat: num(lat),
            lon: num(lon),
            radiusNm: num(radius),
          });
          if (!parsed.success) return setProblem(firstIssue(parsed.error.issues));
          setProblem(null);
          onAdd(parsed.data);
        }}
      >
        <div className="col-span-3">
          <TextField label="Label" value={label} onChange={setLabel} />
        </div>
        <NumberField label="Latitude" value={lat} onChange={setLat} />
        <NumberField label="Longitude" value={lon} onChange={setLon} />
        <NumberField label="Radius (nm)" value={radius} onChange={setRadius} />
        <PickOnMap
          picking={picking}
          onPickingChange={setPicking}
          onPickRequest={place.onPickRequest}
          onPicked={(p) => {
            setLat(coordText(p.lat));
            setLon(coordText(p.lon));
          }}
        />
        <Problem text={problem} />
        <Button type="submit" size="sm" className="col-span-3 w-fit" disabled={place.saving}>
          Add hazard
        </Button>
      </form>
    </div>
  );
}

export function WeatherForm({
  areas,
  onAdd,
  onRemove,
  ...place
}: PlaceProps & {
  areas: ScenarioWeatherArea[];
  onAdd: (input: ScenarioWeatherAreaInput) => void;
  onRemove: (id: number) => void;
}) {
  const [label, setLabel] = useState("Gale");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("150");
  const [wave, setWave] = useState("7");
  const [waveDir, setWaveDir] = useState("270");
  const [wind, setWind] = useState("40");
  const [windDir, setWindDir] = useState("270");
  // From the simulated now, for five days, until the presenter says otherwise.
  const clock = useSimClock();
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  useEffect(() => {
    const now = clock.data?.now;
    if (!now || from !== "") return;
    const start = Math.floor(Date.parse(now) / 3_600_000) * 3_600_000;
    setFrom(utcInput(new Date(start).toISOString()));
    setUntil(utcInput(new Date(start + 5 * 24 * 3_600_000).toISOString()));
  }, [clock.data?.now, from]);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  usePreview("weather", lat, lon, radius, place.onPreview);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col" aria-label="Weather areas">
        {areas.map((a) => (
          <li key={a.id} className="flex items-center gap-2 border-b border-line py-1 text-xs">
            <DataTag kind="synthetic" />
            <span className="min-w-0 flex-1 truncate text-text-1">
              <UntrustedText text={a.label} />
              <span className="block text-2xs text-text-2">
                {a.from ? formatUtc(a.from) : "From the start"} to{" "}
                {a.until ? formatUtc(a.until) : "no end set"}
              </span>
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={place.saving}
              onClick={() => onRemove(a.id)}
              aria-label={`Remove weather area ${a.label}`}
            >
              Remove
            </Button>
          </li>
        ))}
        {areas.length === 0 ? <li className="text-xs text-text-2">No weather areas.</li> : null}
      </ul>
      <form
        className="grid grid-cols-3 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = ScenarioWeatherAreaInput.safeParse({
            label,
            center: { lat: num(lat), lon: num(lon) },
            radiusNm: num(radius),
            waveHeightM: num(wave),
            waveDirDeg: num(waveDir),
            windSpeedKn: num(wind),
            windDirDeg: num(windDir),
            from: fromUtcInput(from),
            until: fromUtcInput(until),
          });
          if (!parsed.success) return setProblem(firstIssue(parsed.error.issues));
          setProblem(null);
          onAdd(parsed.data);
        }}
      >
        <div className="col-span-3">
          <TextField label="Label" value={label} onChange={setLabel} />
        </div>
        <NumberField label="Latitude" value={lat} onChange={setLat} />
        <NumberField label="Longitude" value={lon} onChange={setLon} />
        <NumberField label="Radius (nm)" value={radius} onChange={setRadius} />
        <NumberField label="Wave height (m)" value={wave} onChange={setWave} />
        <NumberField label="Waves from (°)" value={waveDir} onChange={setWaveDir} step="1" />
        <span />
        <NumberField label="Wind speed (kn)" value={wind} onChange={setWind} />
        <NumberField label="Wind from (°)" value={windDir} onChange={setWindDir} step="1" />
        <span />
        <div className="col-span-3 grid grid-cols-2 gap-2">
          <DateTimeField label="Starts (UTC)" value={from} onChange={setFrom} />
          <DateTimeField label="Ends (UTC)" value={until} onChange={setUntil} />
        </div>
        <PickOnMap
          picking={picking}
          onPickingChange={setPicking}
          onPickRequest={place.onPickRequest}
          onPicked={(p) => {
            setLat(coordText(p.lat));
            setLon(coordText(p.lon));
          }}
        />
        <p className="col-span-3 text-2xs text-text-3">
          It holds from its start to its end, past the forecast too. A route meeting waves over the
          heavy-weather limit while it is on goes round it; one passing after it ends is told so.
        </p>
        <Problem text={problem} />
        <Button type="submit" size="sm" className="col-span-3 w-fit" disabled={place.saving}>
          Add weather area
        </Button>
      </form>
    </div>
  );
}
