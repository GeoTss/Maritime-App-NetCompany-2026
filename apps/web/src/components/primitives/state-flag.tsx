/**
 * ICS code flags as state glyphs, in their true pigments (the `--flag-*` tokens) with a hairline
 * outline. Always rendered beside the word they stand for, so they are `aria-hidden`.
 */
import { cn } from "@/lib/utils";

export type FlagKind = "K" | "V" | "U" | "C" | "N";

/** The status words each flag stands beside. */
export const FLAG_MEANING: Record<FlagKind, string> = {
  K: "needs you",
  V: "vessel alert",
  U: "hazard",
  C: "approved",
  N: "rejected",
};

const RED = "var(--flag-red)";
const YELLOW = "var(--flag-yellow)";
const BLUE = "var(--flag-blue)";
const WHITE = "var(--flag-white)";

function Pattern({ kind }: { kind: FlagKind }) {
  switch (kind) {
    case "K": // yellow hoist half, blue fly half
      return (
        <>
          <rect width="7" height="10" fill={YELLOW} />
          <rect x="7" width="7" height="10" fill={BLUE} />
        </>
      );
    case "V": // red saltire on white
      return (
        <>
          <rect width="14" height="10" fill={WHITE} />
          <path d="M0 0 14 10M14 0 0 10" stroke={RED} strokeWidth="2.4" />
        </>
      );
    case "U": // red and white quarters
      return (
        <>
          <rect width="14" height="10" fill={WHITE} />
          <rect width="7" height="5" fill={RED} />
          <rect x="7" y="5" width="7" height="5" fill={RED} />
        </>
      );
    case "C": // blue, white, red, white, blue
      return (
        <>
          <rect width="14" height="10" fill={WHITE} />
          <rect width="14" height="2" fill={BLUE} />
          <rect y="4" width="14" height="2" fill={RED} />
          <rect y="8" width="14" height="2" fill={BLUE} />
        </>
      );
    case "N": // blue and white chequer, 4 x 4
      return (
        <>
          <rect width="14" height="10" fill={WHITE} />
          {[0, 1, 2, 3].flatMap((c) =>
            [0, 1, 2, 3]
              .filter((r) => (c + r) % 2 === 0)
              .map((r) => (
                <rect
                  key={`${c}-${r}`}
                  x={c * 3.5}
                  y={r * 2.5}
                  width="3.5"
                  height="2.5"
                  fill={BLUE}
                />
              )),
          )}
        </>
      );
  }
}

export function StateFlag({ kind, className }: { kind: FlagKind; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-flag={kind}
      viewBox="0 0 14 10"
      width="14"
      height="10"
      className={cn("inline-block shrink-0", className)}
    >
      <Pattern kind={kind} />
      <rect
        x="0.5"
        y="0.5"
        width="13"
        height="9"
        fill="none"
        stroke="var(--flag-outline)"
        strokeWidth="1"
      />
    </svg>
  );
}
