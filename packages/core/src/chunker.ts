export interface Chunk {
  text: string;
  heading: string;
  context_path: string;
  chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 64;

export function splitMarkdown(
  content: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): Chunk[] {
  const chunks: Chunk[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let currentHeading = "";

  const blocks: { heading: string; context_path: string; text: string }[] = [];
  let buffer: string[] = [];

  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (buffer.length > 0) {
        blocks.push({
          heading: currentHeading,
          context_path: headingStack.map((h) => h.text).join(" > "),
          text: buffer.join("\n"),
        });
        buffer = [];
      }
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });
      currentHeading = text;
    }
    buffer.push(line);
  }

  if (buffer.length > 0) {
    blocks.push({
      heading: currentHeading,
      context_path: headingStack.map((h) => h.text).join(" > "),
      text: buffer.join("\n"),
    });
  }

  let chunkIndex = 0;
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;

    if (text.length <= chunkSize) {
      chunks.push({ text, heading: block.heading, context_path: block.context_path, chunkIndex: chunkIndex++ });
    } else {
      for (const sub of splitText(text, chunkSize, overlap)) {
        chunks.push({ text: sub, heading: block.heading, context_path: block.context_path, chunkIndex: chunkIndex++ });
      }
    }
  }

  return chunks;
}

function splitText(text: string, chunkSize: number, overlap: number): string[] {
  return recursiveSplit(text, ["\n\n", "\n", ". ", " "], chunkSize, overlap);
}

function recursiveSplit(text: string, separators: string[], chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) return [text];
  if (separators.length === 0) {
    const result: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) result.push(text.slice(i, i + chunkSize));
    return result;
  }

  const [sep, ...rest] = separators;
  const parts = text.split(sep);
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current) chunks.push(current.trim());
      if (part.length > chunkSize) {
        chunks.push(...recursiveSplit(part, rest, chunkSize, overlap));
        current = "";
      } else {
        current = part;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
