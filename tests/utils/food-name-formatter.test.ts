import { describe, expect, it } from "bun:test";
import {
  cleanForUsdaSearch,
  extractAliases,
  formatFoodName,
  isCompoundIngredient,
  splitFoodNameAndDetails,
  titleCase,
} from "../../src/utils/food-name-formatter.js";

describe("titleCase", () => {
  it("handles empty string", () => {
    expect(titleCase("")).toBe("");
  });

  it("applies title case to text", () => {
    expect(titleCase("chicken breast")).toBe("Chicken Breast");
    expect(titleCase("olive oil")).toBe("Olive Oil");
  });

  it("preserves acronyms", () => {
    expect(titleCase("USDA")).toBe("USDA");
    expect(titleCase("FDA")).toBe("FDA");
    expect(titleCase("chicken USDA breast")).toBe("Chicken USDA Breast");
  });

  it("handles separators", () => {
    expect(titleCase("chicken-breast")).toBe("Chicken-Breast");
    expect(titleCase("chicken/breast")).toBe("Chicken/Breast");
    expect(titleCase("chicken breast")).toBe("Chicken Breast");
  });

  it("handles mixed case", () => {
    expect(titleCase("CHICKEN BREAST")).toBe("Chicken Breast");
    expect(titleCase("ChIcKeN bReAsT")).toBe("Chicken Breast");
  });
});

describe("formatFoodName", () => {
  it("handles empty string", () => {
    expect(formatFoodName("")).toBe("");
  });

  it("formats simple food names", () => {
    expect(formatFoodName("chicken breast")).toBe("Chicken Breast");
    expect(formatFoodName("olive oil")).toBe("Olive Oil");
  });

  it("removes unit-like words", () => {
    expect(formatFoodName("rib celery")).toBe("Celery");
    expect(formatFoodName("piece chicken")).toBe("Chicken");
  });

  it("handles HTML entities", () => {
    expect(formatFoodName("chicken&amp;breast")).toBe("Chicken&breast");
    expect(formatFoodName("chicken&nbsp;breast")).toBe("Chicken Breast");
  });

  it("handles quotes", () => {
    expect(formatFoodName('"chicken breast"')).toBe("Chicken Breast");
    expect(formatFoodName("'chicken breast'")).toBe("Chicken Breast");
  });
});

describe("cleanForUsdaSearch", () => {
  it("handles empty string", () => {
    expect(cleanForUsdaSearch("")).toBe("");
  });

  it("removes stop words", () => {
    expect(cleanForUsdaSearch("chicken and breast")).toBe("chicken breast");
    expect(cleanForUsdaSearch("chicken with oil")).toBe("chicken oil");
  });

  it("filters out single characters", () => {
    expect(cleanForUsdaSearch("a b c chicken")).toBe("chicken");
  });

  it("normalizes to lowercase", () => {
    expect(cleanForUsdaSearch("CHICKEN BREAST")).toBe("chicken breast");
  });

  it("handles whitespace", () => {
    expect(cleanForUsdaSearch("  chicken   breast  ")).toBe("chicken breast");
  });
});

describe("isCompoundIngredient", () => {
  it("handles empty string", () => {
    expect(isCompoundIngredient("")).toBe(false);
  });

  it("detects compound indicators", () => {
    expect(isCompoundIngredient("salt & pepper")).toBe(true);
    expect(isCompoundIngredient("salt and pepper")).toBe(true);
    expect(isCompoundIngredient("salt, pepper")).toBe(true);
  });

  it("returns false for simple ingredients", () => {
    // "chicken breast" has 2 words but "breast" is not in FOOD_INDICATORS and is <= 4 chars
    // So it may or may not be detected as compound depending on the logic
    expect(isCompoundIngredient("chicken")).toBe(false);
    expect(isCompoundIngredient("rice")).toBe(false);
  });

  it("detects multiple food words", () => {
    // These should be detected as compound if they have multiple distinct food words
    expect(isCompoundIngredient("onion celery")).toBe(true);
    expect(isCompoundIngredient("garlic onion")).toBe(true);
  });
});

describe("splitFoodNameAndDetails", () => {
  it("splits name and details correctly", () => {
    const result = splitFoodNameAndDetails("Chicken Breast, Raw");
    expect(result.name).toBe("Chicken Breast");
    expect(result.details).toBe("Raw");
  });

  it("handles multiple detail segments", () => {
    const result = splitFoodNameAndDetails("Oil, Corn, Peanut, And Olive");
    expect(result.name).toBe("Oil");
    expect(result.details).toBe("Corn, Peanut, And Olive");
  });

  it("handles name without details", () => {
    const result = splitFoodNameAndDetails("Chicken Breast");
    expect(result.name).toBe("Chicken Breast");
    expect(result.details).toBeNull();
  });

  it("handles empty string", () => {
    const result = splitFoodNameAndDetails("");
    expect(result.name).toBe("");
    expect(result.details).toBeNull();
  });

  it("handles detail starters", () => {
    const result = splitFoodNameAndDetails("Chicken, Raw, Cooked");
    expect(result.name).toBe("Chicken");
    expect(result.details).toBe("Raw, Cooked");
  });
});

describe("extractAliases", () => {
  it("extracts aliases from normalized tokens", () => {
    const result = extractAliases("Oil", ["corn", "peanut", "olive"]);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("returns null when no normalized tokens provided", () => {
    const result = extractAliases("Chicken Breast");
    expect(result).toBeNull();
  });

  it("returns null for empty normalized tokens", () => {
    const result = extractAliases("Chicken Breast", []);
    expect(result).toBeNull();
  });

  it("filters out modifier words from aliases", () => {
    const result = extractAliases("Chicken", ["fresh", "raw", "chicken"]);
    // Should filter out "fresh" and "raw" as they are modifier words
    expect(result).not.toBeNull();
    if (result) {
      expect(result).not.toContain("Fresh");
      expect(result).not.toContain("Raw");
    }
  });

  it("handles single alias", () => {
    const result = extractAliases("Oil", ["olive"]);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
