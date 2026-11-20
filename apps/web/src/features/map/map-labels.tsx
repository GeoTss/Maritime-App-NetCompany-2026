/**
 * Map labels are HTML markers (the basemap has no glyphs). A label normally sits to the right of
 * its point; near the right edge of the visible canvas (the canvas edge, or the left edge of a
 * panel drawn over it) it flips to the left so it is never clipped. A callout drawn above its
 * point drops below it near the top edge. Display geometry only.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";

/** Screen pixels the overlays take: the side panel (right), the route tray (bottom), the layer
 * switches (top). */
export const MapInsetContext = createContext<{ right: number; bottom: number; top: number }>({
  right: 0,
  bottom: 0,
  top: 0,
});

const GAP_PX = 8;

/**
 * Label priority for decluttering: a label that would overlap a higher one (or a vessel's dot or
 * ripple) is hidden until the map is zoomed in far enough to separate them.
 */
export const LABEL_PRIORITY = { hazard: 4, flagged: 3, vessel: 2, port: 1 } as const;

const overlaps = (a: DOMRect, b: DOMRect, pad: number) =>
  a.left < b.right + pad &&
  b.left < a.right + pad &&
  a.top < b.bottom + pad &&
  b.top < a.bottom + pad;

/**
 * Hides (`data-decluttered`) every `[data-map-label]` under `root` that overlaps a label of higher
 * or equal priority placed before it, or a `[data-map-obstacle]` (vessel dots and ripples).
 * Display only: it reads rendered boxes, never data.
 */
export function declutterLabels(root: HTMLElement): void {
  const labels = [...root.querySelectorAll<HTMLElement>("[data-map-label]")];
  for (const el of labels) el.removeAttribute("data-decluttered");
  const placed = [...root.querySelectorAll<HTMLElement>("[data-map-obstacle]")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0);
  const ranked = labels
    .map((el, i) => ({ el, i, rank: Number(el.dataset.mapLabel) || 0 }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i);
  for (const { el, rank } of ranked) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || getComputedStyle(el).visibility === "hidden") continue;
    // The hazard callout is an honesty signal: it is always shown.
    if (rank < LABEL_PRIORITY.hazard && placed.some((p) => overlaps(p, box, 2))) {
      el.setAttribute("data-decluttered", "");
      continue;
    }
    placed.push(box);
  }
}

/**
 * Where the label of the point (lon, lat) goes. `flip`: left of the point instead of right.
 * `below`: under the point instead of above (only meaningful for a callout drawn above). The
 * label element is measured through `ref`; the answer is checked again after every pan, zoom or
 * resize.
 */
export function useFlipLabel<E extends HTMLElement>(lon: number, lat: number, extraPx = 0) {
  const { current: map } = useMap();
  const inset = useContext(MapInsetContext);
  const ref = useRef<E>(null);
  const [side, setSide] = useState({ flip: false, below: false, offscreen: false });
  useEffect(() => {
    if (!map) return;
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const right = map.getContainer().clientWidth - inset.right;
      const { x, y } = map.project([lon, lat]);
      const width = el.offsetWidth + extraPx + GAP_PX;
      const height = el.offsetHeight + GAP_PX;
      setSide({
        // Flip only when the other side has the room this side lacks.
        flip: x + width > right && x - width >= 0,
        below: y - height < inset.top,
        // A point off the left or right edge would leave a clipped fragment of its label.
        offscreen: x < 0 || x > map.getContainer().clientWidth,
      });
    };
    check();
    map.on("moveend", check);
    map.on("resize", check);
    return () => {
      map.off("moveend", check);
      map.off("resize", check);
    };
  }, [map, lon, lat, inset.right, inset.top, extraPx]);
  return { ref, ...side };
}
