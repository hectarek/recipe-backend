import { normalizeIngredientName } from "../normalizers/ingredient-normalizer.js";
import type { EmbeddingCache } from "../services/embedding-gateway.js";
import type {
  FoodLookupItem,
  FoodMatchCandidate,
  IndexedFood,
  ParsedIngredient,
} from "../types.js";
import { scoreCandidate } from "./scoring.js";

const buildIndex = (foods: FoodLookupItem[]): IndexedFood[] =>
  foods.map((food) => {
    const normalizedNameData = normalizeIngredientName(food.name);
    const baseName =
      normalizedNameData.baseName || food.name.toLowerCase().trim();
    const tokenSet = new Set(
      normalizedNameData.tokens.length > 0
        ? normalizedNameData.tokens
        : baseName.split(" ").filter((token) => token.length > 0)
    );

    const aliasBaseNames: string[] = [];
    const aliasTokenSets: Set<string>[] = [];

    for (const alias of food.aliases ?? []) {
      const normalizedAlias = normalizeIngredientName(alias);
      if (normalizedAlias.baseName) {
        aliasBaseNames.push(normalizedAlias.baseName);
      }
      if (normalizedAlias.tokens.length > 0) {
        aliasTokenSets.push(new Set(normalizedAlias.tokens));
      }
    }

    return {
      ...food,
      normalizedName: baseName,
      tokenSet,
      aliasSet: new Set(aliasBaseNames),
      aliasTokenSets,
    };
  });

type RankOptions = {
  embeddingCache?: EmbeddingCache | null;
};

export const rankFoodCandidates = async (
  ingredient: ParsedIngredient,
  foods: FoodLookupItem[],
  options: RankOptions = {}
): Promise<FoodMatchCandidate[]> => {
  if (!foods.length) {
    return [];
  }

  const indexed = buildIndex(foods);
  const scored: FoodMatchCandidate[] = [];
  const ingredientEmbedding = options.embeddingCache
    ? await options.embeddingCache.embedIngredient(ingredient)
    : null;

  for (const candidate of indexed) {
    let candidateEmbedding: number[] | null = null;
    if (options.embeddingCache) {
      candidateEmbedding = await options.embeddingCache.embedFood(candidate);
    }

    const result = scoreCandidate(ingredient, candidate, {
      ingredientEmbedding,
      candidateEmbedding,
    });
    if (result) {
      scored.push(result);
    }
  }

  return scored.sort((a, b) => b.confidence - a.confidence);
};

export const matchIngredientToFood = async (
  ingredient: ParsedIngredient,
  foods: FoodLookupItem[],
  options?: RankOptions
): Promise<FoodMatchCandidate | null> => {
  const ranked = await rankFoodCandidates(ingredient, foods, options ?? {});
  return ranked[0] ?? null;
};
