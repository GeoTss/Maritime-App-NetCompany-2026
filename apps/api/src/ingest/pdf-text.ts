import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extracts the text layer of a PDF, pages joined by newlines. Used to verify that every value
 * the model extracts really appears in the document. Image-only PDFs return an empty string.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // unpdf/pdf.js may transfer (detach) the buffer it is given, so pass a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.join("\n");
}
