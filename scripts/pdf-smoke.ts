// Phase 0 gate: prove PDF text extraction works in this runtime (host or container).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfText } from "../apps/api/src/ingest/pdf-text.js";

const file = join(import.meta.dirname, "../fixtures/smoke/sample-quote.pdf");
const text = await extractPdfText(new Uint8Array(readFileSync(file)));
if (!text.includes("LSMGO") || !text.includes("420 mt")) {
  console.error("PDF smoke FAILED: expected text not found");
  process.exit(1);
}
console.log(`PDF smoke OK (node ${process.version}, ${text.length} chars)`);
