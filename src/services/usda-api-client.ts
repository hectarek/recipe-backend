/**
 * USDA FoodData Central API Client
 *
 * Searches for foods in the USDA database by name.
 * API Documentation: https://fdc.nal.usda.gov/api-guide.html
 */

import { logger } from "../logger.js";

const USDA_API_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

// Regex patterns defined at module level for performance
const WORD_SPLIT_REGEX = /\s+/;
const DESCRIPTION_SPLIT_REGEX = /[\s,]+/;

export type UsdaFoodItem = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory?: {
    id: number;
    code: string;
    description: string;
  };
};

export type UsdaSearchResponse = {
  foods: UsdaFoodItem[];
  totalHits: number;
  currentPage: number;
  totalPages: number;
};

export class UsdaApiClient {
  private readonly apiKey: string | null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.USDA_API_KEY ?? null;
  }

  /**
   * Search for foods by name
   * @param query Food name to search for
   * @param limit Maximum number of results (default: 10)
   * @returns Search results or null if API key is not configured
   */
  async searchFoods(
    query: string,
    limit = 10
  ): Promise<UsdaSearchResponse | null> {
    if (!this.apiKey) {
      logger.debug("USDA API key not configured, skipping food search");
      return null;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return null;
    }

    try {
      const url = new URL(`${USDA_API_BASE_URL}/foods/search`);
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("query", trimmedQuery);
      url.searchParams.set("pageSize", limit.toString());
      url.searchParams.set("dataType", "Foundation,SR Legacy"); // Focus on standard foods

      const response = await fetch(url.toString());

      if (!response.ok) {
        logger.warn(
          {
            status: response.status,
            statusText: response.statusText,
            query,
          },
          "USDA API search failed"
        );
        return null;
      }

      const data = (await response.json()) as UsdaSearchResponse;
      logger.debug(
        {
          query,
          totalHits: data.totalHits,
          resultsReturned: data.foods.length,
        },
        "USDA API search completed"
      );

      return data;
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : error,
          query,
        },
        "USDA API search error"
      );
      return null;
    }
  }

  /**
   * Validates if a USDA result is a reasonable match for the search query
   */
  private isValidMatch(searchQuery: string, usdaItem: UsdaFoodItem): boolean {
    const queryLower = searchQuery.toLowerCase();
    const descriptionLower = usdaItem.description.toLowerCase();

    // Extract meaningful words from search query (remove stop words)
    const queryWords = queryLower
      .split(WORD_SPLIT_REGEX)
      .filter((word) => word.length > 2)
      .filter(
        (word) => !["the", "and", "or", "with", "without"].includes(word)
      );

    // Check if at least one meaningful word from query appears in description
    const hasMatchingWord = queryWords.some((word) =>
      descriptionLower.includes(word)
    );

    if (!hasMatchingWord) {
      return false;
    }

    // Filter out obviously wrong categories
    const wrongCategories = [
      "beverage",
      "energy drink",
      "soda",
      "juice",
      "coffee",
      "tea",
      "alcohol",
      "beer",
      "wine",
      "liquor",
    ];

    const descriptionLowerWords = descriptionLower.split(
      DESCRIPTION_SPLIT_REGEX
    );
    const hasWrongCategory = wrongCategories.some((category) =>
      descriptionLowerWords.includes(category)
    );

    if (hasWrongCategory) {
      return false;
    }

    // Check similarity - if description is very different, likely wrong
    // Simple heuristic: if query words don't appear prominently, skip
    const matchingWordCount = queryWords.filter((word) =>
      descriptionLower.includes(word)
    ).length;
    const matchRatio = matchingWordCount / queryWords.length;

    // Require at least 50% of meaningful words to match
    return matchRatio >= 0.5;
  }

  /**
   * Find the best matching food for a given ingredient name
   * Returns the first valid result if found, null otherwise
   */
  async findBestMatch(foodName: string): Promise<UsdaFoodItem | null> {
    const results = await this.searchFoods(foodName, 10); // Get more results to validate
    if (!results || results.foods.length === 0) {
      return null;
    }

    // Find first valid match
    for (const food of results.foods) {
      if (this.isValidMatch(foodName, food)) {
        return food;
      }
    }

    // No valid matches found
    return null;
  }
}
