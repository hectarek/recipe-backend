import { describe, expect, it } from 'bun:test';
import { handleRecipeUrl } from '../../src/services/recipeIntakeService.js';
import type { FoodLookupItem, RecipeScrapeResult } from '../../src/types.js';

const buildMockScrapeResult = (url: string): RecipeScrapeResult => ({
  recipe: {
    title: 'Mock Recipe',
    sourceUrl: url,
    instructions: 'Step 1\nStep 2'
  },
  ingredients: ['1 cup rice', '2 tbsp olive oil'],
  rawSchema: { mock: true }
});

type ScrapeStub = {
  fn: (url: string) => Promise<RecipeScrapeResult>;
  calls: string[];
};

const createScrapeStub = (): ScrapeStub => {
  const calls: string[] = [];

  return {
    calls,
    fn: async (url: string) => {
      calls.push(url);
      return buildMockScrapeResult(url);
    }
  };
};

describe('handleRecipeUrl', () => {
  const foodLookup: FoodLookupItem[] = [
    { id: 'food-1', name: 'Rice, brown, cooked', aliases: ['rice'] },
    { id: 'food-2', name: 'Olive oil' }
  ];

  it('scrapes recipe, parses ingredients, and matches foods', async () => {
    const scrapeStub = createScrapeStub();

    const result = await handleRecipeUrl('https://example.com', {
      foodLookup,
      scrapeRecipe: scrapeStub.fn
    });

    expect(scrapeStub.calls).toEqual(['https://example.com']);
    expect(result.ingredients).toHaveLength(2);
    expect(result.unmatched).toHaveLength(0);
    const [firstIngredient] = result.ingredients;
    expect(firstIngredient?.foodId).toBe('food-1');
    expect(result.rawSchema).toBeDefined();
  });

  it('includes unmatched ingredients when no match found', async () => {
    const scrapeStub = createScrapeStub();

    const result = await handleRecipeUrl('https://example.com', {
      foodLookup: [],
      scrapeRecipe: scrapeStub.fn
    });

    expect(scrapeStub.calls).toEqual(['https://example.com']);
    expect(result.ingredients.filter((item) => item.foodId === null)).toHaveLength(2);
    expect(result.unmatched).toHaveLength(2);
  });
});
