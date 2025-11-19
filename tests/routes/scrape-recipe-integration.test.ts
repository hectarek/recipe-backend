import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createScrapeRecipeHandler } from "../../src/routes/scrape-recipe.js";
import type { FoodLookupItem } from "../../src/types.js";

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

describe("POST /scrape-recipe - Integration Tests", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear Notion env vars to prevent real API calls
    process.env.NOTION_API_TOKEN = undefined;
    process.env.NOTION_FOOD_DATA_SOURCE_ID = undefined;
    process.env.NOTION_RECIPES_DATA_SOURCE_ID = undefined;
    process.env.NOTION_INGREDIENTS_DATA_SOURCE_ID = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("handles request with food lookup provided", async () => {
    const handler = createScrapeRecipeHandler();
    const foodLookup: FoodLookupItem[] = [
      { id: "food-1", name: "Rice", aliases: ["rice"] },
      { id: "food-2", name: "Olive Oil" },
    ];

    const res = await invokeRoute(handler, {
      url: "https://example.com",
      foodLookup,
    });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
  });

  it("handles persistToNotion=false gracefully", async () => {
    const handler = createScrapeRecipeHandler();

    const res = await invokeRoute(handler, {
      url: "https://example.com",
      persistToNotion: false,
    });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
  });

  it("returns error when persistToNotion=true but Notion not configured", async () => {
    const handler = createScrapeRecipeHandler();

    const res = await invokeRoute(handler, {
      url: "https://example.com",
      persistToNotion: true,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("persistToNotion=true requires");
  });
});
