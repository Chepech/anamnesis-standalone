export interface ParsedSection {
  heading: string;
  text: string;
}

export interface ParsedDocument {
  title: string;
  text: string;
  sections: ParsedSection[];
  tags: string[];
  mtime: number;
}
