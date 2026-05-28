import fs from "fs";
import path from "path";
import os from "os";
import { z } from "zod";

export const ConfigSchema = z.object({
  watchDirs: z.array(z.string()).default([]),
  embeddingProvider: z.enum(["local", "openai"]).default("local"),
  localModelName: z.string().default("Xenova/all-MiniLM-L6-v2"),
  openaiApiKey: z.string().default(""),
  openaiModelName: z.string().default("text-embedding-3-small"),
  chunkSize: z.number().int().min(64).max(4096).default(512),
  chunkOverlap: z.number().int().min(0).max(512).default(64),
  excludePatterns: z.array(z.string()).default([".git", "node_modules", ".obsidian"]),
  autoIndexOnChange: z.boolean().default(true),
  indexingDebounceMs: z.number().int().min(500).max(300_000).default(5_000),
  fileTypes: z.object({
    markdown: z.boolean().default(true),
    pdf: z.boolean().default(true),
    docx: z.boolean().default(true),
    html: z.boolean().default(false),
  }).default({ markdown: true, pdf: true, docx: true, html: false }),
  hybridSearch: z.boolean().default(true),
  importanceWeight: z.number().min(0).max(1).default(0.05),
  mcpEnabled: z.boolean().default(true),
  mcpPort: z.number().int().min(1024).max(65535).default(8868),
  dataDir: z.string().default(""),
  indexedVectorDim: z.number().int().default(0),
  initialIndexDone: z.boolean().default(false),
  schemaVersion: z.string().default("2"),
});

export type AnamnesisConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".config", "anamnesis", "config.json");

export function loadConfig(configPath = DEFAULT_CONFIG_PATH): AnamnesisConfig {
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
      console.warn(`[Anamnesis] Could not parse config at ${configPath}:`, err);
    }
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[Anamnesis] Config validation errors:", parsed.error.issues);
    return ConfigSchema.parse({});
  }

  const config = parsed.data;
  if (!config.dataDir) {
    config.dataDir = path.join(path.dirname(configPath), "data");
  }
  return config;
}

export function saveConfig(config: AnamnesisConfig, configPath = DEFAULT_CONFIG_PATH): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}
