import fs from "fs";
import path from "path";
import type { ParsedDocument } from "./types.js";
import { parseMarkdown } from "./markdown.js";
import { parsePdf } from "./pdf.js";
import { parseDocx } from "./docx.js";
import { parseHtml } from "./html.js";

export type SupportedExtension = ".md" | ".pdf" | ".docx" | ".html" | ".htm";

export const SUPPORTED_EXTENSIONS = new Set<string>([".md", ".pdf", ".docx", ".html", ".htm"]);

export async function parseFile(filePath: string): Promise<ParsedDocument | null> {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const mtime = stat.mtimeMs;

  try {
    switch (ext) {
      case ".md": {
        const content = fs.readFileSync(filePath, "utf8");
        return parseMarkdown(filePath, content, mtime);
      }
      case ".pdf": {
        const buffer = fs.readFileSync(filePath);
        return await parsePdf(filePath, buffer, mtime);
      }
      case ".docx": {
        const buffer = fs.readFileSync(filePath);
        return await parseDocx(filePath, buffer, mtime);
      }
      case ".html":
      case ".htm": {
        const content = fs.readFileSync(filePath, "utf8");
        return await parseHtml(filePath, content, mtime);
      }
      default:
        return null;
    }
  } catch (err) {
    console.warn(`[Anamnesis] Parse error for ${filePath}:`, err);
    return null;
  }
}
