import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { logger } from "../logger.js";
import type {
  EmbeddingGateway,
  EmbeddingVector,
  FoodLookupItem,
  ParsedIngredient,
} from "../types.js";

const normalizeKey = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

export const cosineSimilarity = (
  a: EmbeddingVector,
  b: EmbeddingVector
): number => {
  const length = Math.min(a.length, b.length);
  if (length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < length; i += 1) {
    const valueA = a[i] ?? 0;
    const valueB = b[i] ?? 0;
    dotProduct += valueA * valueB;
    magnitudeA += valueA * valueA;
    magnitudeB += valueB * valueB;
  }

  const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
};

export class NullEmbeddingGateway implements EmbeddingGateway {
  embedIngredient(
    _ingredient: ParsedIngredient
  ): Promise<EmbeddingVector | null> {
    return Promise.resolve(null);
  }

  embedFood(_food: FoodLookupItem): Promise<EmbeddingVector | null> {
    return Promise.resolve(null);
  }
}

const cacheKey = (prefix: string, value: string | undefined): string =>
  `${prefix}:${normalizeKey(value ?? "")}`;

export class EmbeddingCache {
  private readonly foodCache = new Map<string, EmbeddingVector | null>();
  private readonly ingredientCache = new Map<string, EmbeddingVector | null>();
  private readonly gateway: EmbeddingGateway;

  constructor(gateway: EmbeddingGateway) {
    this.gateway = gateway;
  }

  private async cacheLookup(
    cache: Map<string, EmbeddingVector | null>,
    key: string,
    resolver: () => Promise<EmbeddingVector | null>
  ): Promise<EmbeddingVector | null> {
    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }

    const embedding = await resolver();
    cache.set(key, embedding ?? null);
    return embedding ?? null;
  }

  embedFood(food: FoodLookupItem): Promise<EmbeddingVector | null> {
    const key = cacheKey("food", food.id ?? food.name);
    return this.cacheLookup(this.foodCache, key, () =>
      this.gateway.embedFood(food)
    );
  }

  embedIngredient(
    ingredient: ParsedIngredient
  ): Promise<EmbeddingVector | null> {
    const key = cacheKey("ingredient", ingredient.name);
    return this.cacheLookup(this.ingredientCache, key, () =>
      this.gateway.embedIngredient(ingredient)
    );
  }
}

const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";

const buildFoodEmbeddingText = (food: FoodLookupItem): string =>
  [food.name, ...(food.aliases ?? [])].join(" | ");

const buildIngredientEmbeddingText = (ingredient: ParsedIngredient): string => {
  const descriptors = ingredient.descriptors?.join(", ");
  return descriptors ? `${ingredient.name} (${descriptors})` : ingredient.name;
};

export class OpenAIPineconeEmbeddingGateway implements EmbeddingGateway {
  private readonly openai: OpenAI;
  private readonly index: ReturnType<Pinecone["Index"]>;
  private readonly model: string;

  constructor(options: {
    openai: OpenAI;
    index: ReturnType<Pinecone["Index"]>;
    model: string;
    namespace?: string;
  }) {
    this.openai = options.openai;
    this.model = options.model;
    this.index =
      options.namespace !== undefined
        ? (options.index.namespace(options.namespace) as ReturnType<
            Pinecone["Index"]
          >)
        : options.index;
  }

  embedIngredient(
    ingredient: ParsedIngredient
  ): Promise<EmbeddingVector | null> {
    const text = buildIngredientEmbeddingText(ingredient);
    return this.embedText(text);
  }

  async embedFood(food: FoodLookupItem): Promise<EmbeddingVector | null> {
    const id = this.buildVectorId(food);
    const cached = await this.fetchVector(id);
    if (cached) {
      logger.trace({ id }, "Pinecone cache hit for food embedding");
      return cached;
    }

    const text = buildFoodEmbeddingText(food);
    const embedding = await this.embedText(text);
    if (!embedding) {
      logger.debug({ id }, "OpenAI returned empty embedding for food");
      return null;
    }

    try {
      await this.index.upsert([
        {
          id,
          values: embedding,
          metadata: {
            name: food.name,
            aliases: food.aliases ?? [],
          },
        },
      ]);
      logger.debug({ id }, "Upserted food embedding into Pinecone");
    } catch (error) {
      logger.warn(
        { id, err: error instanceof Error ? error.message : error },
        "Failed to upsert food embedding to Pinecone"
      );
    }

    return embedding;
  }

  private buildVectorId(food: FoodLookupItem): string {
    return food.id ? normalizeKey(food.id) : normalizeKey(food.name);
  }

  private async embedText(text: string): Promise<EmbeddingVector | null> {
    if (!text.trim()) {
      return null;
    }

    try {
      const response = await this.openai.embeddings.create({
        input: text,
        model: this.model,
      });
      return response.data[0]?.embedding ?? null;
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : error },
        "OpenAI embedding request failed"
      );
      return null;
    }
  }

  private async fetchVector(id: string): Promise<EmbeddingVector | null> {
    try {
      const response = await this.index.fetch([id]);
      const record = response?.records?.[id];
      if (!record?.values?.length) {
        return null;
      }
      return record.values as EmbeddingVector;
    } catch (error) {
      logger.debug(
        { id, err: error instanceof Error ? error.message : error },
        "Pinecone fetch failed"
      );
      return null;
    }
  }
}

export const createEmbeddingGateway = (): EmbeddingGateway | null => {
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  let pineconeIndexName =
    process.env.PINECONE_INDEX ?? process.env.PINECONE_INDEX_NAME;
  let pineconeIndexHost = process.env.PINECONE_INDEX_HOST;

  // User provided the host in PINECONE_INDEX; try to recover
  if (pineconeIndexName?.startsWith("http") && !pineconeIndexHost) {
    pineconeIndexHost = pineconeIndexName;
    pineconeIndexName = process.env.PINECONE_INDEX_NAME;
  }

  if (!(openaiKey && pineconeKey && pineconeIndexName)) {
    logger.debug(
      "Embedding gateway disabled: missing OPENAI_API_KEY, PINECONE_API_KEY, or PINECONE_INDEX (index name)."
    );
    return null;
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const pinecone = new Pinecone({ apiKey: pineconeKey });

  const baseIndex = pineconeIndexHost
    ? pinecone.Index(pineconeIndexName, pineconeIndexHost)
    : pinecone.Index(pineconeIndexName);

  if (pineconeIndexHost) {
    logger.debug(
      { pineconeIndexName, pineconeIndexHost },
      "Configured Pinecone index with explicit host."
    );
  } else {
    logger.debug(
      { pineconeIndexName },
      "Configured Pinecone index; host will be resolved automatically."
    );
  }

  const namespace = process.env.PINECONE_NAMESPACE;
  const model = process.env.OPENAI_EMBED_MODEL ?? DEFAULT_OPENAI_MODEL;

  return new OpenAIPineconeEmbeddingGateway({
    openai,
    index: baseIndex,
    model,
    namespace,
  });
};
