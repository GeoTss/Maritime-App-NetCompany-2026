#!/usr/bin/env bash
# Usage: scripts/check-scorecard.sh <report-dir-A> <report-dir-B>
# Exit 0 when the two reports' scorecards are identical except `latency` (replay timing);
# otherwise print the first differing key path and exit 1.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "usage: scripts/check-scorecard.sh <report-dir-A> <report-dir-B>" >&2
  exit 2
fi
for dir in "$1" "$2"; do
  if [ ! -f "$dir/scorecard.json" ]; then
    echo "no scorecard.json in '$dir'" >&2
    exit 2
  fi
done
node -e '
const { resolve } = require("node:path");
const load = (dir) => {
  const card = require(resolve(dir, "scorecard.json")).scorecard;
  delete card.latency;
  return card;
};
const diff = (a, b, path) => {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return path || "(root)";
  if (Array.isArray(a) !== Array.isArray(b)) return path || "(root)";
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const d = diff(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
};
const at = diff(load(process.argv[1]), load(process.argv[2]), "");
if (at) {
  console.log(`scorecards differ at ${at}`);
  process.exit(1);
}
console.log("scorecards identical (latency excluded)");
' "$1" "$2"
