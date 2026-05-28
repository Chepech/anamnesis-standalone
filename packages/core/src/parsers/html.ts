import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import path from "path";
import type { ParsedDocument } from "./types.js";
import { parseMarkdown } from "./markdown.js";

const turndown = new TurndownService({ headingStyle: "atx" });

export async function parseHtml(filePath: string, content: string, mtime: number): Promise<ParsedDocument> {
  const title = path.basename(filePath, path.extname(filePath));

  // Readability extracts the main article content, stripping nav/ads
  const dom = new JSDOM(content, { url: `file://${filePath}` });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const html = article?.content ?? content;
  const markdown = turndown.turndown(html);
  const doc = parseMarkdown(filePath, markdown, mtime);
  return { ...doc, title: article?.title ?? title };
}
