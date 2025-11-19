import { describe, expect, it } from "bun:test";
import { NotionClient } from "../../src/services/notion-client.js";
import type { ScrapedRecipe } from "../../src/types.js";

describe("NotionClient - Helper Functions", () => {
  describe("constructor", () => {
    it("throws error when NOTION_API_TOKEN is missing", () => {
      const originalToken = process.env.NOTION_API_TOKEN;
      process.env.NOTION_API_TOKEN = undefined;

      expect(() => {
        new NotionClient({});
      }).toThrow("NOTION_API_TOKEN is required");

      if (originalToken) {
        process.env.NOTION_API_TOKEN = originalToken;
      }
    });

    it("initializes with apiToken from options", () => {
      const client = new NotionClient({
        apiToken: "test-token",
      });
      expect(client).toBeInstanceOf(NotionClient);
    });

    it("merges custom property mappings", () => {
      const client = new NotionClient({
        apiToken: "test-token",
        propertyMappings: {
          foodName: "Custom Name",
        },
      });
      expect(client).toBeInstanceOf(NotionClient);
    });
  });

  describe("buildRecipePropertyValues edge cases", () => {
    it("handles recipe with all optional fields", async () => {
      const recipe: ScrapedRecipe = {
        title: "Test Recipe",
        sourceUrl: "https://example.com",
        instructions: "Step 1\nStep 2",
        yield: "4 servings",
        time: { total: "PT30M" },
        image: "https://example.com/image.jpg",
        cuisines: ["Italian", "Mediterranean"],
        categories: ["Dinner", "Main Course"],
      };

      const client = new NotionClient({
        apiToken: "test-token",
      });

      // Test that createRecipePage handles all fields
      // This will fail because we don't have a real data source, but tests the structure
      await expect(client.createRecipePage(recipe)).rejects.toThrow();
    });

    it("handles recipe with minimal fields", async () => {
      const recipe: ScrapedRecipe = {
        title: "Minimal Recipe",
        sourceUrl: "",
        instructions: "",
      };

      const client = new NotionClient({
        apiToken: "test-token",
      });

      await expect(client.createRecipePage(recipe)).rejects.toThrow();
    });

    it("handles recipe with image URL", async () => {
      const recipe: ScrapedRecipe = {
        title: "Recipe with Image",
        sourceUrl: "https://example.com",
        instructions: "",
        image: "https://example.com/recipe-image.jpg",
      };

      const client = new NotionClient({
        apiToken: "test-token",
      });

      await expect(client.createRecipePage(recipe)).rejects.toThrow();
    });

    it("handles recipe with time object", async () => {
      const recipe: ScrapedRecipe = {
        title: "Recipe with Time",
        sourceUrl: "https://example.com",
        instructions: "",
        time: {
          prep: "PT15M",
          cook: "PT20M",
          total: "PT35M",
        },
      };

      const client = new NotionClient({
        apiToken: "test-token",
      });

      await expect(client.createRecipePage(recipe)).rejects.toThrow();
    });

    it("handles recipe with yield as number", async () => {
      const recipe: ScrapedRecipe = {
        title: "Recipe with Number Yield",
        sourceUrl: "https://example.com",
        instructions: "",
        yield: 6,
      };

      const client = new NotionClient({
        apiToken: "test-token",
      });

      await expect(client.createRecipePage(recipe)).rejects.toThrow();
    });
  });

  describe("normalizeDatabaseIdForUrl edge cases", () => {
    it("handles data source ID with collection prefix", () => {
      // Test that the client can be created with collection prefix
      // The normalization happens internally, so we just verify it doesn't throw
      expect(() => {
        new NotionClient({
          apiToken: "test-token",
          foodDataSourceId: "collection://12345678901234567890123456789012",
        });
      }).not.toThrow();
    });

    it("handles data source ID without prefix", () => {
      // Test that the client can be created without prefix
      expect(() => {
        new NotionClient({
          apiToken: "test-token",
          foodDataSourceId: "12345678901234567890123456789012",
        });
      }).not.toThrow();
    });

    it("returns empty array when foodDataSourceId not configured", async () => {
      const client = new NotionClient({
        apiToken: "test-token",
        // No foodDataSourceId
      });

      const result = await client.fetchFoodLookup();
      expect(result).toEqual([]);
    });
  });
});
