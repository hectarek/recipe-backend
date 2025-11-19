import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Pinecone } from "@pinecone-database/pinecone";
import type OpenAI from "openai";
import {
  cosineSimilarity,
  createEmbeddingGateway,
  EmbeddingCache,
  NullEmbeddingGateway,
  OpenAIPineconeEmbeddingGateway,
} from "../../src/services/embedding-gateway.js";
import type { FoodLookupItem, ParsedIngredient } from "../../src/types.js";

describe("cosineSimilarity", () => {
  it("calculates cosine similarity correctly", () => {
    const a: number[] = [1, 0, 0];
    const b: number[] = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(1);
  });

  it("handles orthogonal vectors", () => {
    const a: number[] = [1, 0];
    const b: number[] = [0, 1];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("handles empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("handles different length vectors", () => {
    const a: number[] = [1, 2, 3];
    const b: number[] = [1, 2];
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe("NullEmbeddingGateway", () => {
  it("returns null for embedIngredient", async () => {
    const gateway = new NullEmbeddingGateway();
    const ingredient: ParsedIngredient = {
      raw: "1 cup rice",
      qty: 1,
      unit: "cup",
      name: "rice",
    };
    const result = await gateway.embedIngredient(ingredient);
    expect(result).toBeNull();
  });

  it("returns null for embedFood", async () => {
    const gateway = new NullEmbeddingGateway();
    const food: FoodLookupItem = { id: "food-1", name: "Rice" };
    const result = await gateway.embedFood(food);
    expect(result).toBeNull();
  });
});

describe("EmbeddingCache", () => {
  it("caches food embeddings", async () => {
    let callCount = 0;
    const mockGateway = {
      embedFood: () => {
        callCount += 1;
        return Promise.resolve([1, 2, 3]);
      },
      embedIngredient: () => Promise.resolve(null),
    };

    const cache = new EmbeddingCache(mockGateway);
    const food: FoodLookupItem = { id: "food-1", name: "Rice" };

    const first = await cache.embedFood(food);
    const second = await cache.embedFood(food);

    expect(callCount).toBe(1);
    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
  });

  it("caches ingredient embeddings", async () => {
    let callCount = 0;
    const mockGateway = {
      embedIngredient: () => {
        callCount += 1;
        return Promise.resolve([1, 2, 3]);
      },
      embedFood: () => Promise.resolve(null),
    };

    const cache = new EmbeddingCache(mockGateway);
    const ingredient: ParsedIngredient = {
      raw: "1 cup rice",
      qty: 1,
      unit: "cup",
      name: "rice",
    };

    const first = await cache.embedIngredient(ingredient);
    const second = await cache.embedIngredient(ingredient);

    expect(callCount).toBe(1);
    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
  });

  it("handles null embeddings", async () => {
    const mockGateway = {
      embedFood: () => Promise.resolve(null),
      embedIngredient: () => Promise.resolve(null),
    };

    const cache = new EmbeddingCache(mockGateway);
    const food: FoodLookupItem = { id: "food-1", name: "Rice" };

    const result = await cache.embedFood(food);
    expect(result).toBeNull();
  });
});

describe("OpenAIPineconeEmbeddingGateway", () => {
  let mockOpenAI: OpenAI;
  let mockPineconeIndex: {
    fetch: (
      ids: string[]
    ) => Promise<{ records: Record<string, { values: number[] }> }>;
    upsert: (vectors: Array<{ id: string; values: number[] }>) => Promise<void>;
  };

  beforeEach(() => {
    mockPineconeIndex = {
      fetch: () => Promise.resolve({ records: {} }),
      upsert: () => Promise.resolve(),
    };

    mockOpenAI = {
      embeddings: {
        create: () =>
          Promise.resolve({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
      },
    } as unknown as OpenAI;
  });

  it("generates embeddings for ingredients", async () => {
    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: mockOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const ingredient: ParsedIngredient = {
      raw: "1 cup rice",
      qty: 1,
      unit: "cup",
      name: "rice",
    };

    const result = await gateway.embedIngredient(ingredient);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("generates embeddings for food", async () => {
    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: mockOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const food: FoodLookupItem = { id: "food-1", name: "Rice" };
    const result = await gateway.embedFood(food);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("fetches cached embeddings from Pinecone", async () => {
    const cachedEmbedding = [0.4, 0.5, 0.6];
    mockPineconeIndex.fetch = (ids: string[]) => {
      const firstId = ids[0];
      if (!firstId) {
        return Promise.resolve({ records: {} });
      }
      return Promise.resolve({
        records: {
          [firstId]: { values: cachedEmbedding },
        },
      });
    };

    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: mockOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const food: FoodLookupItem = { id: "food-1", name: "Rice" };
    const result = await gateway.embedFood(food);
    expect(result).toEqual(cachedEmbedding);
  });

  it("handles empty text gracefully", async () => {
    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: mockOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const ingredient: ParsedIngredient = {
      raw: "",
      qty: null,
      unit: null,
      name: "",
    };

    const result = await gateway.embedIngredient(ingredient);
    expect(result).toBeNull();
  });

  it("handles OpenAI API errors gracefully", async () => {
    const errorOpenAI = {
      embeddings: {
        create: () => Promise.reject(new Error("API error")),
      },
    } as unknown as OpenAI;

    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: errorOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const food: FoodLookupItem = { id: "food-1", name: "Rice" };
    const result = await gateway.embedFood(food);
    // Should return null on error, not throw
    expect(result).toBeNull();
  });

  it("handles Pinecone fetch errors gracefully", async () => {
    mockPineconeIndex.fetch = () => Promise.reject(new Error("Pinecone error"));

    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: mockOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const food: FoodLookupItem = { id: "food-1", name: "Rice" };
    // Should fall back to generating new embedding
    const result = await gateway.embedFood(food);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("handles Pinecone upsert errors gracefully", async () => {
    mockPineconeIndex.upsert = () => Promise.reject(new Error("Upsert error"));

    const gateway = new OpenAIPineconeEmbeddingGateway({
      openai: mockOpenAI,
      index: mockPineconeIndex as unknown as ReturnType<Pinecone["Index"]>,
      model: "text-embedding-3-small",
    });

    const food: FoodLookupItem = { id: "food-1", name: "Rice" };
    // Should still return embedding even if upsert fails
    const result = await gateway.embedFood(food);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("createEmbeddingGateway", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when OpenAI key is missing", () => {
    process.env.OPENAI_API_KEY = undefined;
    process.env.PINECONE_API_KEY = undefined;
    process.env.PINECONE_INDEX = undefined;

    const gateway = createEmbeddingGateway();
    expect(gateway).toBeNull();
  });

  it("returns null when Pinecone key is missing", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = undefined;
    process.env.PINECONE_INDEX = undefined;

    const gateway = createEmbeddingGateway();
    expect(gateway).toBeNull();
  });

  it("returns null when Pinecone index name is missing", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = undefined;
    process.env.PINECONE_INDEX_NAME = undefined;

    const gateway = createEmbeddingGateway();
    expect(gateway).toBeNull();
  });

  it("creates gateway when all required env vars are present", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = "test-index";

    const gateway = createEmbeddingGateway();
    expect(gateway).not.toBeNull();
    expect(gateway).toBeInstanceOf(OpenAIPineconeEmbeddingGateway);
  });

  it("uses PINECONE_INDEX_NAME when PINECONE_INDEX is not set", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = undefined;
    process.env.PINECONE_INDEX_NAME = "test-index";

    const gateway = createEmbeddingGateway();
    expect(gateway).not.toBeNull();
  });

  it("handles PINECONE_INDEX_HOST when provided", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = "test-index";
    process.env.PINECONE_INDEX_HOST = "https://test-host.pinecone.io";

    const gateway = createEmbeddingGateway();
    expect(gateway).not.toBeNull();
  });

  it("recovers when PINECONE_INDEX contains host URL", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = "https://test-host.pinecone.io";
    process.env.PINECONE_INDEX_NAME = "test-index";

    const gateway = createEmbeddingGateway();
    expect(gateway).not.toBeNull();
  });

  it("uses custom model when OPENAI_EMBED_MODEL is set", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = "test-index";
    process.env.OPENAI_EMBED_MODEL = "text-embedding-ada-002";

    const gateway = createEmbeddingGateway();
    expect(gateway).not.toBeNull();
  });

  it("handles PINECONE_NAMESPACE when provided", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PINECONE_API_KEY = "test-key";
    process.env.PINECONE_INDEX = "test-index";
    process.env.PINECONE_NAMESPACE = "test-namespace";

    const gateway = createEmbeddingGateway();
    expect(gateway).not.toBeNull();
  });
});
