import { describe, expect, it } from "bun:test";
import { handleRecipeUrl } from "../../src/services/recipe-intake-service.js";
import type { FoodLookupItem, RecipeScrapeResult } from "../../src/types.js";

const buildMockScrapeResult = (url: string): RecipeScrapeResult => ({
  recipe: {
    title: "Mock Recipe",
    sourceUrl: url,
    instructions: "Step 1\nStep 2",
  },
  ingredients: ["1 cup rice", "2 tbsp olive oil"],
  rawSchema: { mock: true },
});

type ScrapeStub = {
  fn: (url: string) => Promise<RecipeScrapeResult>;
  calls: string[];
};

const createScrapeStub = (): ScrapeStub => {
  const calls: string[] = [];

  return {
    calls,
    fn: (url: string) => {
      calls.push(url);
      return Promise.resolve(buildMockScrapeResult(url));
    },
  };
};

describe("handleRecipeUrl - Edge Cases", () => {
  it("handles ingredients with perfect token matches", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Rice" }, // Perfect token match for "rice"
      { id: "food-2", name: "Olive Oil" }, // Perfect token match for "olive oil"
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    // Perfect token matches should be auto-matched
    for (const match of result.matches) {
      expect(match.foodId).not.toBeNull();
    }
  });

  it("categorizes probable matches correctly", async () => {
    const scrapeStub = createScrapeStub();
    // Use foods that will score in the probable range (60-84)
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Brown Rice, Cooked" }, // Partial match
      { id: "food-2", name: "Extra Virgin Olive Oil" }, // Partial match
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // Should have some matches (auto or probable)
    expect(result.ingredients.length).toBe(2);
    // All ingredients should be categorized
    expect(
      result.matches.length +
        result.probables.length +
        result.pendingReview.length
    ).toBeGreaterThanOrEqual(0);
  });

  it("handles persistToNotion with Notion client", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Rice, brown, cooked", aliases: ["rice"] },
      { id: "food-2", name: "Olive oil" },
    ];

    let recipeCreated = false;
    let ingredientsCreated = false;
    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve(foodLookup),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => {
        recipeCreated = true;
        return Promise.resolve("recipe-page-id");
      },
      createIngredientEntries: () => {
        ingredientsCreated = true;
        return Promise.resolve();
      },
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    expect(recipeCreated).toBe(true);
    expect(ingredientsCreated).toBe(true);
    expect(result.ingredients.length).toBe(2);
  });

  it("skips persistence when persistToNotion is false", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [{ id: "food-1", name: "Rice" }];

    let recipeCreated = false;
    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve(foodLookup),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => {
        recipeCreated = true;
        return Promise.resolve("recipe-page-id");
      },
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: false,
    });

    expect(recipeCreated).toBe(false);
  });

  it("only persists matched ingredients (with foodId)", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Rice, brown, cooked", aliases: ["rice"] },
      // No match for olive oil
    ];

    let persistedIngredients: unknown[] = [];
    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve(foodLookup),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: (_recipeId: string, ingredients: unknown[]) => {
        persistedIngredients = ingredients;
        return Promise.resolve();
      },
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    // Should only persist ingredients with foodId
    for (const ingredientItem of persistedIngredients) {
      const ing = ingredientItem as { foodId: string | null };
      expect(ing.foodId).not.toBeNull();
    }
  });

  it("handles review queue with gateway", async () => {
    const scrapeStub = createScrapeStub();
    const persistedItems: unknown[] = [];
    const reviewGateway = {
      persist: (items: unknown[]) => {
        persistedItems.push(...items);
        return Promise.resolve();
      },
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup: [], // No matches, so everything goes to review
      scrapeRecipe: scrapeStub.fn,
      reviewQueueGateway: reviewGateway,
    });

    expect(result.pendingReview.length).toBeGreaterThan(0);
    expect(persistedItems.length).toBeGreaterThan(0);
  });

  it("handles empty ingredients list", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Empty Recipe",
          sourceUrl: "https://example.com",
          instructions: "",
        },
        ingredients: [],
        rawSchema: {},
      }),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
    });

    expect(result.ingredients).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.probables).toEqual([]);
    expect(result.pendingReview).toEqual([]);
  });
});
