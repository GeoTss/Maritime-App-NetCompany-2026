import { readFileSync } from "node:fs";
import { SeaNetwork } from "@pharos/shared";

let cached: SeaNetwork | undefined;

/** The committed sea-route network, parsed once per process. */
export function loadSeaNetwork(): SeaNetwork {
  cached ??= SeaNetwork.parse(
    JSON.parse(
      readFileSync(new URL("./sea-network.generated.json", import.meta.url), "utf8"),
    ) as unknown,
  );
  return cached;
}
