/**
 * Stable JSON text for golden files: key order as given (callers pass Zod-parsed objects, whose
 * keys follow the schema), two-space indent, trailing newline, and the same layout Biome's
 * formatter produces (objects expanded; arrays of primitives inline when they fit in 100
 * columns, else one item per line), so `npm run lint` and `--check` agree byte for byte.
 */

const LINE_WIDTH = 100;

const isPlain = (v: unknown): boolean => v === null || typeof v !== "object";

function format(value: unknown, indent: number, prefix: number, suffix: number): string {
  if (isPlain(value)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("non-finite number in golden JSON");
    }
    if (value === undefined) throw new TypeError("undefined in golden JSON");
    return JSON.stringify(value);
  }
  const pad = " ".repeat(indent + 2);
  const close = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPlain)) {
      const inline = `[${value.map((v) => format(v, 0, 0, 0)).join(", ")}]`;
      if (prefix + inline.length + suffix <= LINE_WIDTH) return inline;
      if (value.every((v) => typeof v === "number")) {
        throw new RangeError("long number arrays are not supported (Biome fills them)");
      }
    }
    const items = value.map(
      (v, i) => `${pad}${format(v, indent + 2, indent + 2, i < value.length - 1 ? 1 : 0)}`,
    );
    return `[\n${items.join(",\n")}\n${close}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return "{}";
  const items = entries.map(([k, v], i) => {
    const key = `${JSON.stringify(k)}: `;
    const last = i === entries.length - 1;
    return `${pad}${key}${format(v, indent + 2, indent + 2 + key.length, last ? 0 : 1)}`;
  });
  return `{\n${items.join(",\n")}\n${close}}`;
}

export function stableJson(value: unknown): string {
  return `${format(value, 0, 0, 0)}\n`;
}
