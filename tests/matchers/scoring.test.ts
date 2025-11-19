import { describe, expect, it } from "bun:test";
import { scoreCandidate } from "../../src/matchers/scoring.js";
import { normalizeIngredientName } from "../../src/normalizers/ingredient-normalizer.js";
import type { IndexedFood, ParsedIngredient } from "../../src/types.js";

const createIndexedFood = (
  name: string,
  aliases: string[] = []
): IndexedFood => {
  const normalizedNameData = normalizeIngredientName(name);
  const baseName = normalizedNameData.baseName || name.toLowerCase().trim();
  const tokenSet = new Set(
    normalizedNameData.tokens.length > 0
      ? normalizedNameData.tokens
      : baseName.split(" ").filter((token) => token.length > 0)
  );

  const aliasBaseNames: string[] = [];
  const aliasTokenSets: Set<string>[] = [];

  for (const alias of aliases) {
    const normalizedAlias = normalizeIngredientName(alias);
    if (normalizedAlias.baseName) {
      aliasBaseNames.push(normalizedAlias.baseName);
    }
    if (normalizedAlias.tokens.length > 0) {
      aliasTokenSets.push(new Set(normalizedAlias.tokens));
    }
  }

  return {
    id: `food-${name}`,
    name,
    aliases: aliases.length > 0 ? aliases : undefined,
    normalizedName: baseName,
    tokenSet,
    aliasSet: new Set(aliasBaseNames),
    aliasTokenSets,
  };
};

const createIngredient = (name: string): ParsedIngredient => ({
  raw: `1 cup ${name}`,
  qty: 1,
  unit: "cup",
  name,
  normalizedTokens: name.toLowerCase().split(" ").filter(Boolean),
});

describe("scoreCandidate", () => {
  it("scores exact name match as 100", () => {
    const ingredient = createIngredient("chicken breast");
    const food = createIndexedFood("Chicken Breast");

    const result = scoreCandidate(ingredient, food);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(100);
    expect(result?.reasons.some((r) => r.type === "exact-name")).toBe(true);
  });

  it("scores alias exact match highly", () => {
    const ingredient = createIngredient("chicken breast");
    const food = createIndexedFood("Chicken Breast, Cooked", [
      "chicken breast",
    ]);

    const result = scoreCandidate(ingredient, food);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBeGreaterThanOrEqual(95);
    expect(result?.reasons.some((r) => r.type === "alias-exact")).toBe(true);
  });

  it("scores perfect token match as 100", () => {
    const ingredient = createIngredient("celery");
    const food = createIndexedFood("Celery");

    const result = scoreCandidate(ingredient, food);

    expect(result).not.toBeNull();
    const tokenOverlapReason = result?.reasons.find(
      (r) => r.type === "token-overlap" && r.meta?.perfectMatch === true
    );
    expect(tokenOverlapReason).toBeDefined();
    expect(result?.confidence).toBe(100);
  });

  it("scores token overlap", () => {
    // Use tokens that will actually match after normalization
    const ingredient: ParsedIngredient = {
      raw: "1 cup brown rice",
      qty: 1,
      unit: "cup",
      name: "brown rice",
      normalizedTokens: ["brown", "rice"], // Explicitly set matching tokens
    };
    const food = createIndexedFood("Rice, Brown, Cooked");

    const result = scoreCandidate(ingredient, food);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBeGreaterThan(0);
    expect(result?.reasons.some((r) => r.type === "token-overlap")).toBe(true);
  });

  it("does not apply prefix match without good token overlap", () => {
    const ingredient = createIngredient("salt");
    const food = createIndexedFood("Salted Butter");

    const result = scoreCandidate(ingredient, food);

    // "salt" doesn't match "salted" token, so no match
    // This test verifies that prefix matching requires good token overlap
    if (result) {
      const prefixReason = result.reasons.find(
        (r) => r.type === "prefix-match"
      );
      if (prefixReason) {
        // If prefix match exists, token overlap should be good
        const tokenReason = result.reasons.find(
          (r) => r.type === "token-overlap"
        );
        expect(tokenReason?.meta?.coverage).toBeGreaterThanOrEqual(0.6);
      }
    } else {
      // No match is acceptable - demonstrates that prefix matching requires token overlap
      expect(result).toBeNull();
    }
  });

  it("returns null for no match", () => {
    const ingredient = createIngredient("dragon fruit");
    const food = createIndexedFood("Apple");

    const result = scoreCandidate(ingredient, food);

    expect(result).toBeNull();
  });

  it("combines multiple match reasons", () => {
    const ingredient = createIngredient("olive oil");
    const food = createIndexedFood("Extra Virgin Olive Oil", ["olive oil"]);

    const result = scoreCandidate(ingredient, food);

    expect(result).not.toBeNull();
    expect(result?.reasons.length).toBeGreaterThan(1);
  });
});
