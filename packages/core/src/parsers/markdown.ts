import matter from "gray-matter";
import path from "path";
import type { ParsedDocument } from "./types.js";

export function parseMarkdown(filePath: string, content: string, mtime: number): ParsedDocument {
  const { data: fm, content: body } = matter(content);
  const title = path.basename(filePath, path.extname(filePath));

  const rawTags: unknown = fm["tags"];
  const tags = Array.isArray(rawTags)
    ? (rawTags as unknown[]).map(String)
    : typeof rawTags === "string"
      ? rawTags.split(/[\s,]+/).filter(Boolean)
      : [];

  // Extract heading-delimited sections for context building
  const sections: { heading: string; text: string }[] = [];
  let currentHeading = "";
  let buffer: string[] = [];

  for (const line of body.split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      if (buffer.length > 0) sections.push({ heading: currentHeading, text: buffer.join("\n") });
      currentHeading = m[2].trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0) sections.push({ heading: currentHeading, text: buffer.join("\n") });

  return { title, text: body, sections, tags, mtime };
}
