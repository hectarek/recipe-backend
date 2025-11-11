import type { FoodLookupItem, ParsedIngredient } from "../types.js";

type IndexedFood = FoodLookupItem & {
  normalizedName: string;
  tokenSet: Set<string>;
  aliasSet: Set<string>;
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string): Set<string> =>
  new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 0)
  );

const scoreAliasExact = 90;
const scoreStartsWith = 75;
const scoreTokenMatch = 60;

const buildIndex = (foods: FoodLookupItem[]): IndexedFood[] =>
  foods.map((food) => {
    const normalizedName = normalize(food.name);
    const aliasSet = new Set(
      (food.aliases ?? [])
        .map((alias) => normalize(alias))
        .filter((alias) => alias.length > 0)
    );
    return {
      ...food,
      normalizedName,
      tokenSet: tokenize(food.name),
      aliasSet,
    };
  });

const bestCandidate = (
  ingredient: ParsedIngredient,
  indexedFoods: IndexedFood[]
): FoodLookupItem | null => {
  const normalizedIngredient = normalize(ingredient.name);
  if (!normalizedIngredient) {
    return null;
  }

  let bestScore = 0;
  let bestMatch: FoodLookupItem | null = null;
  const ingredientTokens = tokenize(ingredient.name);

  for (const candidate of indexedFoods) {
    if (candidate.normalizedName === normalizedIngredient) {
      return candidate;
    }

    if (
      candidate.aliasSet.has(normalizedIngredient) &&
      scoreAliasExact > bestScore
    ) {
      bestScore = scoreAliasExact;
      bestMatch = candidate;
      continue;
    }

    if (
      candidate.normalizedName.startsWith(normalizedIngredient) &&
      scoreStartsWith > bestScore
    ) {
      bestScore = scoreStartsWith;
      bestMatch = candidate;
      continue;
    }

    const ingredientTokensAllPresent = [...ingredientTokens].every((token) =>
      candidate.tokenSet.has(token)
    );

    if (ingredientTokensAllPresent && scoreTokenMatch > bestScore) {
      bestScore = scoreTokenMatch;
      bestMatch = candidate;
    }
  }

  return bestMatch;
};

export const matchIngredientToFood = (
  ingredient: ParsedIngredient,
  foods: FoodLookupItem[]
): FoodLookupItem | null => {
  if (!foods.length) {
    return null;
  }

  const indexed = buildIndex(foods);
  return bestCandidate(ingredient, indexed);
};
