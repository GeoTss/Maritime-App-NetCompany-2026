/**
 * Deterministic PDFs for golden emails. pdf-lib with `updateMetadata: false` writes no dates or
 * producer strings, so the same input always gives the same bytes. Text PDFs carry a real text
 * layer (one drawText per cell; cells on one row share a baseline, so unpdf reads them as one
 * line). The image-only PDF is a raster with no text layer at all, like a scanned page.
 */
import { crc32 } from "node:zlib";
import { PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";

/** One printed row: a single text, or cells at x offsets (points from the left margin). */
export type PdfRow =
  | { text: string; bold?: boolean; size?: number }
  | { cells: { text: string; x: number; bold?: boolean }[]; size?: number }
  | { gap: number };

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const LINE = 15;

/** A text PDF, one A4 page. Only WinAnsi characters (ASCII, €, ±, en dash) are allowed. */
export async function buildTextPdf(rows: PdfRow[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(PAGE);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = (b?: boolean): PDFFont => (b ? bold : regular);
  let y = PAGE[1] - MARGIN;
  for (const row of rows) {
    if ("gap" in row) {
      y -= row.gap;
      continue;
    }
    const size = row.size ?? 10;
    if ("text" in row) {
      page.drawText(row.text, { x: MARGIN, y, size, font: font(row.bold) });
    } else {
      for (const c of row.cells) {
        page.drawText(c.text, { x: MARGIN + c.x, y, size, font: font(c.bold) });
      }
    }
    y -= size > 10 ? size + 6 : LINE;
    if (y < MARGIN) throw new Error("golden PDF content does not fit on one page");
  }
  return doc.save();
}

// ---------- image-only PDF ----------

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream of stored (uncompressed) deflate blocks: independent of any zlib build. */
function zlibStored(data: Uint8Array): Uint8Array {
  const chunks: number[] = [0x78, 0x01];
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  for (let i = 0; i < blocks; i++) {
    const block = data.subarray(i * 65535, Math.min((i + 1) * 65535, data.length));
    const len = block.length;
    chunks.push(i === blocks - 1 ? 1 : 0, len & 0xff, (len >> 8) & 0xff);
    chunks.push(~len & 0xff, (~len >> 8) & 0xff);
    for (const byte of block) chunks.push(byte);
  }
  const adler = adler32(data);
  chunks.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Uint8Array.from(chunks);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(Buffer.from(type, "ascii"), 0);
  typeAndData.set(data, 4);
  out.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData));
  return out;
}

/** 8-bit greyscale PNG from rows of pixel values. */
function greyPng(width: number, height: number, pixel: (x: number, y: number) => number) {
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 0, 0, 0, 0], 8); // bit depth 8, greyscale, deflate, no filter, no interlace
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStored(raw)),
    pngChunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

/** A "scanned" page as a PNG: grey paper with dark bars where lines of text would be. */
export function scannedPagePng(): Uint8Array {
  const width = 240;
  const height = 320;
  const bars = [18, 30, 52, 64, 76, 88, 100, 112, 124, 148, 160, 172, 196, 208, 260, 272];
  return greyPng(width, height, (x, y) => {
    const bar = bars.find((top) => y >= top && y < top + 6);
    if (bar === undefined) return 236;
    const length = 60 + ((bar * 37) % 140);
    return x >= 20 && x < 20 + length ? 40 : 236;
  });
}

/**
 * The scanned page embedded in a PDF. No text layer, so text extraction returns nothing (the
 * image-only hard case).
 */
export async function buildImageOnlyPdf(): Promise<Uint8Array> {
  const png = scannedPagePng();
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(PAGE);
  const image = await doc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: PAGE[0], height: PAGE[1] });
  return doc.save();
}
