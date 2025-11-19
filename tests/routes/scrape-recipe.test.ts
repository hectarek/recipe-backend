import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createScrapeRecipeHandler } from "../../src/routes/scrape-recipe.js";
import type {
  RecipeIntakeOptions,
  RecipeIntakeResponse,
} from "../../src/types.js";

type HandleCall = {
  url: string;
  options: RecipeIntakeOptions;
};

type HandleStub = {
  fn: (
    url: string,
    options?: RecipeIntakeOptions
  ) => Promise<RecipeIntakeResponse>;
  calls: HandleCall[];
  setResponse: (response: Partial<RecipeIntakeResponse>) => void;
};

const createHandleStub = (): HandleStub => {
  const calls: HandleCall[] = [];
  const defaultResponse: RecipeIntakeResponse = {
    recipe: {
      title: "Stub",
      sourceUrl: "",
      instructions: "",
    },
    ingredients: [],
    unmatched: [],
    rawSchema: {},
    matches: [],
    probables: [],
    pendingReview: [],
  };
  let nextResponse: RecipeIntakeResponse = defaultResponse;

  return {
    calls,
    setResponse: (response: Partial<RecipeIntakeResponse>) => {
      nextResponse = {
        ...defaultResponse,
        ...response,
        matches: response.matches ?? defaultResponse.matches,
        probables: response.probables ?? defaultResponse.probables,
        pendingReview: response.pendingReview ?? defaultResponse.pendingReview,
      };
    },
    fn: (url: string, options: RecipeIntakeOptions = {}) => {
      calls.push({ url, options });
      return Promise.resolve(nextResponse);
    },
  };
};

const invokeRoute = (
  handler: (request: Request) => Promise<Response>,
  body: unknown
) => {
  const request = new Request("http://localhost/scrape-recipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return handler(request);
};

describe("POST /scrape-recipe", () => {
  let handleStub: HandleStub;
  let handler: (request: Request) => Promise<Response>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env and clear Notion env vars to prevent real API calls
    originalEnv = { ...process.env };
    process.env.NOTION_API_TOKEN = undefined;
    process.env.NOTION_FOOD_DATA_SOURCE_ID = undefined;
    process.env.NOTION_RECIPES_DATA_SOURCE_ID = undefined;
    process.env.NOTION_INGREDIENTS_DATA_SOURCE_ID = undefined;

    handleStub = createHandleStub();
    handler = createScrapeRecipeHandler({ handleRecipe: handleStub.fn });
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it("returns 200 with structured payload", async () => {
    handleStub.setResponse({
      recipe: {
        title: "Test Recipe",
        sourceUrl: "https://example.com",
        instructions: "Step 1",
      },
      ingredients: [
        {
          raw: "1 cup rice",
          qty: 1,
          unit: "cup",
          name: "rice",
          foodId: "food-1",
        },
      ],
      unmatched: [],
      matches: [],
      probables: [],
      pendingReview: [],
      rawSchema: {},
    });

    const res = await invokeRoute(handler, {
      url: "https://example.com/recipe",
    });
    const body = (await res.json()) as RecipeIntakeResponse & {
      persistedToNotion?: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.recipe.title).toBe("Test Recipe");
    expect(body.recipe.sourceUrl).toBe("https://example.com");
    expect(body.ingredients).toHaveLength(1);
    expect(body.persistedToNotion).toBe(false);
    expect(handleStub.calls).toHaveLength(1);
    expect(handleStub.calls[0]?.url).toBe("https://example.com/recipe");
  });

  it("returns 200 with provided food lookup", async () => {
    handleStub.setResponse({
      recipe: {
        title: "Test",
        sourceUrl: "https://example.com",
        instructions: "",
      },
      ingredients: [],
      unmatched: [],
      matches: [],
      probables: [],
      pendingReview: [],
    });

    const res = await invokeRoute(handler, {
      url: "https://example.com",
      foodLookup: [{ id: "food-1", name: "Rice" }],
    });

    expect(res.status).toBe(200);
    expect(handleStub.calls).toHaveLength(1);
    expect(handleStub.calls[0]?.options.foodLookup).toEqual([
      { id: "food-1", name: "Rice" },
    ]);
  });

  it("returns 400 for invalid URL", async () => {
    const res = await invokeRoute(handler, { url: "not-a-url" });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request body.");
    expect(handleStub.calls).toHaveLength(0);
  });

  it("returns 400 for invalid JSON", async () => {
    const request = new Request("http://localhost/scrape-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });

    const res = await handler(request);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body.");
    expect(handleStub.calls).toHaveLength(0);
  });

  it("returns 400 when persistToNotion=true but Notion not configured", async () => {
    const res = await invokeRoute(handler, {
      url: "https://example.com",
      persistToNotion: true,
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("persistToNotion=true requires");
    expect(handleStub.calls).toHaveLength(0);
  });

  it("handles recipe scraping errors", async () => {
    const errorStub: HandleStub = createHandleStub();
    errorStub.fn = () => {
      throw new Error("No recipe schema found in provided HTML.");
    };
    const errorHandler = createScrapeRecipeHandler({
      handleRecipe: errorStub.fn,
    });

    const res = await invokeRoute(errorHandler, {
      url: "https://example.com",
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("No recipe schema");
  });

  it("handles generic errors", async () => {
    const errorStub: HandleStub = {
      ...handleStub,
      fn: () => {
        throw new Error("Unexpected error");
      },
    };
    const errorHandler = createScrapeRecipeHandler({
      handleRecipe: errorStub.fn,
    });

    const res = await invokeRoute(errorHandler, {
      url: "https://example.com",
    });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to process recipe.");
  });
});
