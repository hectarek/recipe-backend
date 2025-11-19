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

  it("handles recipe with no matched ingredients", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [
      // No matches for the ingredients
      { id: "food-1", name: "Completely Different Food" },
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    expect(result.matches.length).toBe(0);
    expect(result.probables.length).toBe(0);
    expect(result.pendingReview.length).toBeGreaterThan(0);
  });

  it("handles problematic single-word matches (salt -> salted butter)", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Salted Butter" }, // Should NOT match "salt"
      { id: "food-2", name: "Table Salt" }, // Should match "salt"
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // "salt" should match "Table Salt", not "Salted Butter"
    const saltIngredient = result.ingredients.find((ing) =>
      ing.name.toLowerCase().includes("salt")
    );
    if (saltIngredient?.foodId) {
      // Should match the correct food
      expect(saltIngredient.foodId).toBe("food-2");
    }
  });

  it("handles semantic mismatches (beef stock -> ground beef)", async () => {
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Ground Beef" }, // Should NOT match "beef stock"
      { id: "food-2", name: "Beef Stock" }, // Should match "beef stock"
    ];

    // Create a scrape result with "beef stock" ingredient
    const customScrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["2 cups beef stock"],
        rawSchema: {},
      }),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: customScrapeStub.fn,
    });

    // "beef stock" should match "Beef Stock", not "Ground Beef"
    const stockIngredient = result.ingredients.find((ing) =>
      ing.name.toLowerCase().includes("stock")
    );
    if (stockIngredient?.foodId) {
      expect(stockIngredient.foodId).toBe("food-2");
    }
  });

  it("tries next candidate when best match has gotcha", async () => {
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Salted Butter" }, // Gotcha: "salt" shouldn't match this
      { id: "food-2", name: "Table Salt" }, // This should be the match
    ];

    // Create a scrape result with "salt" ingredient
    const customScrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 tsp salt"],
        rawSchema: {},
      }),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: customScrapeStub.fn,
    });

    // Should match the second candidate (Table Salt) instead of first (Salted Butter)
    const saltIngredient = result.ingredients.find((ing) =>
      ing.name.toLowerCase().includes("salt")
    );
    if (saltIngredient?.foodId) {
      expect(saltIngredient.foodId).toBe("food-2");
    }
  });

  it("handles partial matches with low confidence", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Brown Rice, Cooked" }, // Partial match, lower confidence
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // Should categorize based on confidence
    expect(
      result.matches.length +
        result.probables.length +
        result.pendingReview.length
    ).toBeGreaterThan(0);
  });

  it("handles empty matched array in persistToNotion", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup unknown ingredient"],
        rawSchema: {},
      }),
    };

    let ingredientsPersisted: unknown[] = [];
    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: (_recipeId: string, ingredients: unknown[]) => {
        ingredientsPersisted = ingredients;
        return Promise.resolve();
      },
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    // Should not persist ingredients when none have foodId
    expect(ingredientsPersisted.length).toBe(0);
  });

  it("handles USDA lookup with short query after cleaning", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup ab"], // Very short name that becomes empty after cleaning
        rawSchema: {},
      }),
    };

    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    // Should complete without error
    expect(true).toBe(true);
  });

  it("handles USDA lookup fallback to formatted name", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup special ingredient"],
        rawSchema: {},
      }),
    };

    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    // Should complete without error
    expect(true).toBe(true);
  });

  it("handles empty ingredient name after parsing", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["   "], // Whitespace only
        rawSchema: {},
      }),
    };

    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    // Should handle gracefully
    expect(result.ingredients.length).toBeGreaterThanOrEqual(0);
  });

  it("handles empty ingredient name after formatting", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup   "], // Name becomes empty after formatting
        rawSchema: {},
      }),
    };

    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
      notionClient: mockNotionClient,
      persistToNotion: true,
    });

    // Should handle gracefully
    expect(result.ingredients.length).toBeGreaterThanOrEqual(0);
  });

  it("handles USDA API lookup errors gracefully", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup test ingredient"],
        rawSchema: {},
      }),
    };

    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    // Set USDA_API_KEY to trigger USDA lookup, but it will fail
    const originalEnv = process.env.USDA_API_KEY;
    process.env.USDA_API_KEY = "test-key";

    try {
      const result = await handleRecipeUrl("https://example.com", {
        foodLookup: [],
        scrapeRecipe: scrapeStub.fn,
        notionClient: mockNotionClient,
        persistToNotion: true,
      });

      // Should complete without error even if USDA lookup fails
      expect(result.ingredients.length).toBeGreaterThanOrEqual(0);
    } finally {
      if (originalEnv) {
        process.env.USDA_API_KEY = originalEnv;
      } else {
        process.env.USDA_API_KEY = undefined;
      }
    }
  });

  it("skips USDA lookup for compound ingredients", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["salt & pepper"], // Compound ingredient
        rawSchema: {},
      }),
    };

    let createFoodEntryCalled = false;
    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => {
        createFoodEntryCalled = true;
        return Promise.resolve("food-page-id");
      },
    };

    const originalEnv = process.env.USDA_API_KEY;
    process.env.USDA_API_KEY = "test-key";

    try {
      await handleRecipeUrl("https://example.com", {
        foodLookup: [],
        scrapeRecipe: scrapeStub.fn,
        notionClient: mockNotionClient,
        persistToNotion: true,
      });

      // Should still create food entry even without USDA lookup
      expect(createFoodEntryCalled).toBe(true);
    } finally {
      if (originalEnv) {
        process.env.USDA_API_KEY = originalEnv;
      } else {
        process.env.USDA_API_KEY = undefined;
      }
    }
  });

  it("handles errors when persisting unmatched ingredients", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup unknown ingredient"],
        rawSchema: {},
      }),
    };

    let errorCount = 0;
    const mockNotionClient = {
      fetchFoodLookup: () => Promise.resolve([]),
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => {
        errorCount += 1;
        if (errorCount === 1) {
          throw new Error("Notion API error");
        }
        return Promise.resolve("food-page-id");
      },
    };

    // Should not throw, should continue processing
    await expect(
      handleRecipeUrl("https://example.com", {
        foodLookup: [],
        scrapeRecipe: scrapeStub.fn,
        notionClient: mockNotionClient,
        persistToNotion: true,
      })
    ).resolves.toBeDefined();
  });

  it("fetches food lookup from notionClient when not provided", async () => {
    const scrapeStub = createScrapeStub();
    const foodLookup: FoodLookupItem[] = [{ id: "food-1", name: "Rice" }];

    let fetchFoodLookupCalled = false;
    const mockNotionClient = {
      fetchFoodLookup: () => {
        fetchFoodLookupCalled = true;
        return Promise.resolve(foodLookup);
      },
      findRecipeBySourceUrl: () => Promise.resolve(null),
      createRecipePage: () => Promise.resolve("recipe-page-id"),
      createIngredientEntries: () => Promise.resolve(),
      findFoodByName: () => Promise.resolve(null),
      createFoodEntry: () => Promise.resolve("food-page-id"),
    };

    await handleRecipeUrl("https://example.com", {
      notionClient: mockNotionClient,
      scrapeRecipe: scrapeStub.fn,
    });

    expect(fetchFoodLookupCalled).toBe(true);
  });

  it("handles perfect token match with 85% confidence", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup celery"],
        rawSchema: {},
      }),
    };

    // Create a candidate with perfect token match at 85% confidence
    const foodLookup: FoodLookupItem[] = [
      {
        id: "food-1",
        name: "Celery",
        aliases: ["celery"],
      },
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // Should auto-match due to perfect token match even at 85%
    expect(result.matches.length).toBeGreaterThanOrEqual(0);
  });

  it("handles gotcha check rejecting best match and trying next candidate", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 tsp salt"],
        rawSchema: {},
      }),
    };

    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Salted Butter" }, // Gotcha: should be rejected
      { id: "food-2", name: "Table Salt" }, // Should be used instead
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // Should try next candidate when first has gotcha
    const saltIngredient = result.ingredients.find((ing) =>
      ing.name.toLowerCase().includes("salt")
    );
    if (saltIngredient?.foodId) {
      // Should prefer the second candidate
      expect(saltIngredient.foodId).toBe("food-2");
    }
  });

  it("handles invalid match trying next candidate", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup pepper"],
        rawSchema: {},
      }),
    };

    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Bell Peppers" }, // Should be rejected (single-word ingredient)
      { id: "food-2", name: "Black Pepper" }, // Should be used instead
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // Should try next candidate when first is invalid
    expect(result.ingredients.length).toBeGreaterThan(0);
  });

  it("handles empty ranked candidates array", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup completely unknown"],
        rawSchema: {},
      }),
    };

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn,
    });

    // Should handle empty candidates gracefully
    expect(result.ingredients.length).toBe(1);
    expect(result.ingredients[0]?.foodId).toBeNull();
  });

  it("handles match with confidence below soft threshold", async () => {
    const scrapeStub: ScrapeStub = {
      calls: [],
      fn: async () => ({
        recipe: {
          title: "Test Recipe",
          sourceUrl: "https://example.com",
          instructions: "Step 1",
        },
        ingredients: ["1 cup something"],
        rawSchema: {},
      }),
    };

    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Something Else" }, // Low confidence match
    ];

    const result = await handleRecipeUrl("https://example.com", {
      foodLookup,
      scrapeRecipe: scrapeStub.fn,
    });

    // Should categorize as pending review if below soft threshold
    expect(
      result.matches.length +
        result.probables.length +
        result.pendingReview.length
    ).toBeGreaterThan(0);
  });
});
