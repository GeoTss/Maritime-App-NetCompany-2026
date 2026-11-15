/** AISStream bounding boxes as [[lat, lon], [lat, lon]] corner pairs (latitude first). */
export type AisBox = [[number, number], [number, number]];

export const AIS_BOXES: Record<string, AisBox[]> = {
  demo: [
    [
      [35.7, -6.0],
      [36.4, -5.0],
    ], // Gibraltar strait
    [
      [51.7, 3.2],
      [52.3, 4.6],
    ], // Rotterdam approaches
    [
      [35.6, 14.0],
      [36.2, 14.9],
    ], // Malta
    [
      [37.6, 23.3],
      [38.1, 23.9],
    ], // Saronic Gulf
    [
      [31.1, 32.1],
      [31.6, 32.6],
    ], // Port Said
  ],
};
