import mammoth from "mammoth";
import TurndownService from "turndown";
import path from "path";
import type { ParsedDocument } from "./types.js";
import { parseMarkdown } from "./markdown.js";

const turndown = new TurndownService({ headingStyle: "atx" });

export async function parseDocx(filePath: string, buffer: Buffer, mtime: number): Promise<ParsedDocument> {
  const title = path.basename(filePath, ".docx");
  // mammoth.convertToHtml preserves heading structure; turndown converts to markdown
  const result = await mammoth.convertToHtml({ buffer });
  const markdown = turndown.turndown(result.value);
  const doc = parseMarkdown(filePath, markdown, mtime);
  return { ...doc, title };
}
