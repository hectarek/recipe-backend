import { beforeEach, describe, expect, it } from "bun:test";
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
  setResponse: (response: RecipeIntakeResponse) => void;
};

const createHandleStub = (): HandleStub => {
  const calls: HandleCall[] = [];
  let nextResponse: RecipeIntakeResponse = {
    recipe: {
      title: "Stub",
      sourceUrl: "",
      instructions: "",
    },
    ingredients: [],
    unmatched: [],
    rawSchema: {},
  };

  return {
    calls,
    setResponse: (response: RecipeIntakeResponse) => {
      nextResponse = response;
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

  beforeEach(() => {
    handleStub = createHandleStub();
    handler = createScrapeRecipeHandler({ handleRecipe: handleStub.fn });
  });

  it("returns 200 with structured payload", async () => {
    handleStub.setResponse({
      recipe: {
        title: "Test",
        sourceUrl: "https://example.com",
        instructions: "Step 1",
      },
      ingredients: [],
      unmatched: [],
      rawSchema: {},
    });

    const res = await invokeRoute(handler, { url: "https://example.com" });
    const body = (await res.json()) as { recipe: { title: string } };

    expect(res.status).toBe(200);
    expect(body.recipe.title).toBe("Test");
    expect(handleStub.calls).toHaveLength(1);
    expect(handleStub.calls[0]?.url).toBe("https://example.com");
  });

  it("returns 400 for invalid payload", async () => {
    const res = await invokeRoute(handler, { url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(handleStub.calls).toHaveLength(0);
  });
});
