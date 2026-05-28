import type { EmbeddingProvider } from "./bridge.js";

const OPENAI_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

const OPENAI_BATCH_SIZE = 128;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimension: number;

  private apiKey: string;
  private modelName: string;
  private client: import("openai").default | null = null;

  constructor(apiKey: string, modelName = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.dimension = OPENAI_DIMS[modelName] ?? 1536;
  }

  async initialize(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("openai") as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    this.client = new mod.default({ apiKey: this.apiKey }) as import("openai").default;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.client) throw new Error("OpenAIEmbeddingProvider not initialized");
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
      const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);
      const response = await this.client.embeddings.create({ model: this.modelName, input: batch });
      response.data.sort((a, b) => a.index - b.index).forEach((item) => results.push(item.embedding));
    }
    return results;
  }
}
