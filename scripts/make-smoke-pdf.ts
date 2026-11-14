// Generates fixtures/smoke/sample-quote.pdf — a tiny bunker quote used to prove PDF text
// extraction works on the host and inside the container. Deterministic output.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const lines = [
  "Mediterranean Bunkering Ltd - Fuel Offer",
  "Vessel: MV Aegean Pioneer (IMO 9700001)",
  "Port: Gibraltar   Delivery: 2026-11-20 to 2026-11-22",
  "Product: LSMGO 0.1%S   Quantity: 420 mt   Price: USD 742.50 per mt",
  "Barge fee: USD 1,800 lump sum   Valid until: 2026-11-16 17:00 UTC",
];

const doc = await PDFDocument.create({ updateMetadata: false });
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([595, 842]);
lines.forEach((text, i) => {
  page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font });
});
const bytes = await doc.save({ useObjectStreams: false });
const out = join(import.meta.dirname, "../fixtures/smoke/sample-quote.pdf");
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);
