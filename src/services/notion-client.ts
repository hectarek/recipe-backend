import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import type {
  FoodLookupItem,
  MatchedIngredient,
  NotionGateway,
  NotionGatewayOptions,
  ScrapedRecipe,
} from "../types.js";

const isFullPage = (
  page: PageObjectResponse | PartialPageObjectResponse
): page is PageObjectResponse => "properties" in page;

const getPlainText = (
  value: { plain_text: string }[] | undefined
): string | undefined =>
  value
    ?.map((item) => item.plain_text)
    .join("")
    .trim() || undefined;

const defaultPropertyMappings = {
  recipeName: "Name",
  recipeSourceUrl: "Source URL",
  recipeServings: "Servings",
  recipeInstructions: "Instructions",
  ingredientRecipeRelation: "Recipe",
  ingredientFoodRelation: "Food",
  ingredientQuantity: "Qty",
  ingredientUnit: "Unit",
  ingredientName: "Name",
  foodName: "Name",
  foodAliases: "Aliases",
} as const;

export class NotionClient implements NotionGateway {
  private readonly client: Client;
  private readonly options: NotionGatewayOptions;

  private get databaseQuery() {
    return (
      this.client.databases as unknown as {
        query: (args: {
          database_id: string;
          start_cursor?: string;
        }) => Promise<{
          results: Array<PageObjectResponse | PartialPageObjectResponse>;
          has_more: boolean;
          next_cursor: string | null;
        }>;
      }
    ).query;
  }

  constructor(options: NotionGatewayOptions) {
    const apiToken = options.apiToken ?? process.env.NOTION_API_TOKEN;
    if (!apiToken) {
      throw new Error(
        "NOTION_API_TOKEN is required to initialize NotionClient."
      );
    }

    this.client = new Client({ auth: apiToken });
    this.options = {
      ...options,
      propertyMappings: {
        ...defaultPropertyMappings,
        ...(options.propertyMappings ?? {}),
      },
    };
  }

  async fetchFoodLookup(): Promise<FoodLookupItem[]> {
    if (!this.options.foodDatabaseId) {
      return [];
    }

    const items: FoodLookupItem[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.databaseQuery({
        database_id: this.options.foodDatabaseId,
        start_cursor: cursor,
      });

      for (const result of response.results) {
        if (!isFullPage(result)) {
          continue;
        }

        const mapped = this.mapFoodPage(result);
        if (mapped) {
          items.push(mapped);
        }
      }

      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);

    return items;
  }

  private mapFoodPage(page: PageObjectResponse): FoodLookupItem | null {
    const properties = page.properties;
    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    const namePropertyKey =
      mappings.foodName ?? defaultPropertyMappings.foodName;
    const fallbackNameProperty =
      "Name" in properties ? properties.Name : undefined;
    const nameProperty = properties[namePropertyKey] ?? fallbackNameProperty;

    if (!nameProperty || nameProperty.type !== "title") {
      return null;
    }

    const name = getPlainText(nameProperty.title);
    if (!name) {
      return null;
    }

    const aliasesPropertyKey =
      mappings.foodAliases ?? defaultPropertyMappings.foodAliases;
    const aliasesProperty = properties[aliasesPropertyKey];
    const aliases: string[] = [];

    if (aliasesProperty?.type === "multi_select") {
      aliases.push(...aliasesProperty.multi_select.map((item) => item.name));
    } else if (aliasesProperty?.type === "rich_text") {
      const text = getPlainText(aliasesProperty.rich_text);
      if (text) {
        aliases.push(
          ...text
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        );
      }
    }

    return {
      id: page.id,
      name,
      aliases: aliases.length ? aliases : undefined,
    };
  }

  async createRecipePage(recipe: ScrapedRecipe): Promise<string> {
    if (!this.options.recipeDatabaseId) {
      throw new Error("recipeDatabaseId is not configured.");
    }

    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;

    const recipeNameProperty =
      mappings.recipeName ?? defaultPropertyMappings.recipeName;
    const recipeSourceUrlProperty =
      mappings.recipeSourceUrl ?? defaultPropertyMappings.recipeSourceUrl;
    const recipeServingsProperty =
      mappings.recipeServings ?? defaultPropertyMappings.recipeServings;
    const recipeInstructionsProperty =
      mappings.recipeInstructions ?? defaultPropertyMappings.recipeInstructions;

    const properties: Record<string, unknown> = {
      [recipeNameProperty]: {
        title: [
          {
            text: { content: recipe.title },
          },
        ],
      },
    };

    if (recipe.sourceUrl) {
      properties[recipeSourceUrlProperty] = {
        url: recipe.sourceUrl,
      };
    }

    if (recipe.yield) {
      properties[recipeServingsProperty] = {
        rich_text: [
          {
            text: { content: String(recipe.yield) },
          },
        ],
      };
    }

    if (recipe.instructions) {
      properties[recipeInstructionsProperty] = {
        rich_text: [
          {
            text: { content: recipe.instructions },
          },
        ],
      };
    }

    const response = await this.client.pages.create({
      parent: { database_id: this.options.recipeDatabaseId },
      properties: properties as Parameters<
        Client["pages"]["create"]
      >[0]["properties"],
    });

    if (!isFullPage(response)) {
      throw new Error("Failed to create recipe page in Notion.");
    }

    return response.id;
  }

  private buildIngredientProperties(
    recipePageId: string,
    ingredient: MatchedIngredient,
    mapping: {
      recipeRelation: string;
      foodRelation: string;
      quantity: string | null;
      unit: string | null;
      name: string;
    }
  ): Parameters<Client["pages"]["create"]>[0]["properties"] {
    const properties: Record<string, unknown> = {
      [mapping.recipeRelation]: {
        relation: [{ id: recipePageId }],
      },
      [mapping.name]: {
        title: [
          {
            text: { content: ingredient.name },
          },
        ],
      },
    };

    if (ingredient.foodId) {
      properties[mapping.foodRelation] = {
        relation: [{ id: ingredient.foodId }],
      };
    }

    if (mapping.quantity) {
      properties[mapping.quantity] = {
        number: ingredient.qty,
      };
    }

    if (mapping.unit) {
      properties[mapping.unit] = {
        rich_text: ingredient.unit
          ? [
              {
                text: { content: ingredient.unit },
              },
            ]
          : [],
      };
    }

    return properties as Parameters<Client["pages"]["create"]>[0]["properties"];
  }

  async createIngredientEntries(
    recipePageId: string,
    ingredients: MatchedIngredient[]
  ) {
    if (!this.options.ingredientDatabaseId) {
      throw new Error("ingredientDatabaseId is not configured.");
    }

    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    const resolvedMappings = {
      recipeRelation:
        mappings.ingredientRecipeRelation ??
        defaultPropertyMappings.ingredientRecipeRelation,
      foodRelation:
        mappings.ingredientFoodRelation ??
        defaultPropertyMappings.ingredientFoodRelation,
      quantity:
        mappings.ingredientQuantity ??
        defaultPropertyMappings.ingredientQuantity ??
        null,
      unit:
        mappings.ingredientUnit ??
        defaultPropertyMappings.ingredientUnit ??
        null,
      name: mappings.ingredientName ?? defaultPropertyMappings.ingredientName,
    };

    for (const ingredient of ingredients) {
      await this.client.pages.create({
        parent: { database_id: this.options.ingredientDatabaseId },
        properties: this.buildIngredientProperties(
          recipePageId,
          ingredient,
          resolvedMappings
        ),
      });
    }
  }
}
