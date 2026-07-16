export interface LocalModelInfo {
  dim: number;
  fastembedEnum: string;
}

export const LOCAL_MODELS: Record<string, LocalModelInfo> = {
  "Xenova/all-MiniLM-L6-v2": { dim: 384, fastembedEnum: "AllMiniLML6V2" },
  "Xenova/paraphrase-MiniLM-L3-v2": { dim: 384, fastembedEnum: "AllMiniLML6V2" },
  "Xenova/all-mpnet-base-v2": { dim: 768, fastembedEnum: "BGEBaseENV15" },
  "BAAI/bge-base-en-v1.5": { dim: 768, fastembedEnum: "BGEBaseENV15" },
  "BAAI/bge-small-en-v1.5": { dim: 384, fastembedEnum: "BGESmallENV15" },
  "sentence-transformers/all-MiniLM-L6-v2": { dim: 384, fastembedEnum: "AllMiniLML6V2" },
};
