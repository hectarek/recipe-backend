import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Client } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { NotionClient } from "../../src/services/notion-client.js";
import type { ScrapedRecipe } from "../../src/types.js";

// Mock the Notion client (currently unused but kept for future mocking)
const _createMockNotionClient = () => {
  const mockPages: Record<string, PageObjectResponse> = {};
  const mockDataSources: Record<string, PageObjectResponse[]> = {};
  const mockDatabases: Record<string, PageObjectResponse[]> = {};

  const client = {
    dataSources: {
      query: (args: { data_source_id: string; start_cursor?: string }) => {
        const pages = mockDataSources[args.data_source_id] ?? [];
        return Promise.resolve({
          results: pages,
          has_more: false,
          next_cursor: null,
        });
      },
    },
    databases: {
      query: (args: {
        database_id: string;
        filter?: unknown;
        page_size?: number;
      }) => {
        const pages = mockDatabases[args.database_id] ?? [];
        // Simple filter simulation
        if (args.filter && typeof args.filter === "object") {
          const filter = args.filter as {
            property: string;
            title?: { equals: string };
            url?: { equals: string };
          };
          if (filter.title?.equals) {
            const titleEquals = filter.title.equals;
            const filtered = pages.filter((page) => {
              const props = (page as PageObjectResponse).properties;
              const nameProp = props[filter.property];
              if (nameProp?.type === "title") {
                return nameProp.title[0]?.plain_text === titleEquals;
              }
              return false;
            });
            return Promise.resolve({
              results: filtered.slice(0, args.page_size ?? 1),
            });
          }
          if (filter.url?.equals) {
            const urlEquals = filter.url.equals;
            const filtered = pages.filter((page) => {
              const props = (page as PageObjectResponse).properties;
              const urlProp = props[filter.property];
              if (urlProp?.type === "url") {
                return urlProp.url === urlEquals;
              }
              return false;
            });
            return Promise.resolve({
              results: filtered.slice(0, args.page_size ?? 1),
            });
          }
        }
        return Promise.resolve({
          results: pages.slice(0, args.page_size ?? 1),
        });
      },
    },
    pages: {
      create: (args: {
        parent: { database_id: string };
        properties: Record<string, unknown>;
      }) => {
        const pageId = `page-${Date.now()}`;
        const mockPage: PageObjectResponse = {
          id: pageId,
          object: "page",
          created_time: new Date().toISOString(),
          last_edited_time: new Date().toISOString(),
          created_by: { object: "user", id: "user-1" },
          last_edited_by: { object: "user", id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id", database_id: args.parent.database_id },
          archived: false,
          in_trash: false,
          is_locked: false,
          properties: args.properties as PageObjectResponse["properties"],
          url: `https://notion.so/${pageId}`,
          public_url: null,
        };
        mockPages[pageId] = mockPage;
        return Promise.resolve(mockPage);
      },
    },
  } as unknown as Client;

  return { client, mockPages, mockDataSources, mockDatabases };
};

describe("NotionClient", () => {
  let mockEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    mockEnv = { ...process.env };
    process.env.NOTION_API_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env = mockEnv;
  });

  describe("fetchFoodLookup", () => {
    it("returns empty list when foodDataSourceId not configured", async () => {
      const client = new NotionClient({});
      const result = await client.fetchFoodLookup();
      expect(result).toEqual([]);
    });

    it("filters out unreviewed items", async () => {
      // This test would require mocking the dataSources.query method
      // For now, we'll test the behavior when no data source is configured
      const client = new NotionClient({});
      const result = await client.fetchFoodLookup();
      expect(result).toEqual([]);
    });
  });

  describe("findRecipeBySourceUrl", () => {
    it("returns null when sourceUrl is empty", async () => {
      const client = new NotionClient({});
      const result = await client.findRecipeBySourceUrl("");
      expect(result).toBeNull();
    });

    it("returns null when recipeDataSourceId not configured", async () => {
      const client = new NotionClient({});
      const result = await client.findRecipeBySourceUrl("https://example.com");
      expect(result).toBeNull();
    });
  });

  describe("findFoodByName", () => {
    it("returns null when name is empty", async () => {
      const client = new NotionClient({});
      const result = await client.findFoodByName("");
      expect(result).toBeNull();
    });

    it("returns null when foodDataSourceId not configured", async () => {
      const client = new NotionClient({});
      const result = await client.findFoodByName("Rice");
      expect(result).toBeNull();
    });
  });

  describe("createFoodEntry", () => {
    it("throws error when foodDataSourceId not configured", async () => {
      const client = new NotionClient({});
      await expect(client.createFoodEntry("Rice")).rejects.toThrow();
    });
  });

  describe("createRecipePage", () => {
    it("throws error when recipeDataSourceId not configured", async () => {
      const client = new NotionClient({});
      const recipe: ScrapedRecipe = {
        title: "Test Recipe",
        sourceUrl: "https://example.com",
        instructions: "Step 1",
      };
      await expect(client.createRecipePage(recipe)).rejects.toThrow();
    });
  });

  describe("createIngredientEntries", () => {
    it("throws error when ingredientDataSourceId not configured", async () => {
      const client = new NotionClient({});
      await expect(
        client.createIngredientEntries("recipe-id", [])
      ).rejects.toThrow();
    });
  });
});
