import { extractText, getDocumentProxy } from "unpdf";

/** Plain text per page, joined with page markers so the LLM fallback can cite pages. */
export async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return {
    text: pages.map((t, i) => `[page ${i + 1}]\n${t}`).join("\n\n"),
    pages: totalPages,
  };
}
