import pdfParse from "pdf-parse";
import path from "path";
import type { ParsedDocument } from "./types.js";

export async function parsePdf(filePath: string, buffer: Buffer, mtime: number): Promise<ParsedDocument> {
  const title = path.basename(filePath, ".pdf");
  const data = await pdfParse(buffer);
  const fullText = data.text.trim();

  // Split on double-newlines as a heuristic for paragraph/section boundaries
  const paragraphs = fullText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sections = paragraphs.map((text, i) => ({ heading: `Section ${i + 1}`, text }));

  return { title, text: fullText, sections, tags: [], mtime };
}
