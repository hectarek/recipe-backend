import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import { COLLECTION_PREFIX_REGEX, DATABASE_ID_HEX_REGEX } from "../const.js";
import { logger } from "../logger.js";
import { formatRecipeTime, parseServings } from "../parsers/recipe-parser.js";
import type {
  FoodLookupItem,
  MatchedIngredient,
  NotionGateway,
  NotionGatewayOptions,
  RecipePropertyNames,
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
  recipeInstructions: undefined,
  recipeTime: "Time",
  recipeMeal: "Meal",
  recipeCoverImage: "Cover Image",
  recipeTags: "Tags",
  ingredientRecipeRelation: "Recipe",
  ingredientFoodRelation: "Food",
  ingredientQuantity: "Qty",
  ingredientUnit: "Unit",
  ingredientName: "Name",
  foodName: "Name",
  foodAliases: "Aliases",
  foodReviewed: "Reviewed",
} as const;

const normalizeDatabaseIdForUrl = (value: string): string => {
  if (!value) {
    throw new Error("Database ID is required.");
  }

  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(COLLECTION_PREFIX_REGEX, "");
  const hexOnly = withoutPrefix.replace(/[^0-9a-fA-F]/g, "");
  const match = hexOnly.match(DATABASE_ID_HEX_REGEX);
  if (!match) {
    throw new Error(
      "Database ID must contain at least 32 hexadecimal characters."
    );
  }

  const canonical = match[0].toLowerCase();

  return [
    canonical.slice(0, 8),
    canonical.slice(8, 12),
    canonical.slice(12, 16),
    canonical.slice(16, 20),
    canonical.slice(20),
  ].join("-");
};

const uniqueStrings = (values: string[] | undefined): string[] => {
  if (!values?.length) {
    return [];
  }

  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) {
      set.add(trimmed);
    }
  }

  return Array.from(set);
};

const buildInstructionBlocks = (instructions: string | undefined) => {
  if (!instructions) {
    return [];
  }

  return instructions
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        rich_text: [
          {
            type: "text" as const,
            text: { content: line },
          },
        ],
      },
    }));
};

const buildRecipeTags = (recipe: ScrapedRecipe): string[] =>
  uniqueStrings(recipe.cuisines);

const buildRecipeMeals = (recipe: ScrapedRecipe): string[] =>
  uniqueStrings(recipe.categories);

const buildCoverImageFiles = (
  imageUrl: string | undefined,
  title: string
): Array<{
  name: string;
  external: { url: string };
}> | null => {
  if (!imageUrl) {
    return null;
  }

  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return null;
  }

  const nameFragment = (() => {
    try {
      const url = new URL(trimmed);
      const pathname = url.pathname.split("/").filter(Boolean).pop();
      return pathname ?? title;
    } catch {
      return title;
    }
  })();

  return [
    {
      name: nameFragment || title,
      external: { url: trimmed },
    },
  ];
};

const buildRecipePropertyValues = (
  recipe: ScrapedRecipe,
  names: RecipePropertyNames
): {
  properties: Record<string, unknown>;
  coverImageUrl?: string;
} => {
  const properties: Record<string, unknown> = {
    [names.name]: {
      title: [
        {
          text: { content: recipe.title },
        },
      ],
    },
  };

  if (recipe.sourceUrl && names.sourceUrl) {
    properties[names.sourceUrl] = {
      url: recipe.sourceUrl,
    };
  }

  const servings = parseServings(recipe.yield);
  if (servings !== null && names.servings) {
    properties[names.servings] = {
      number: servings,
    };
  }

  if (recipe.instructions && names.instructions) {
    properties[names.instructions] = {
      rich_text: [
        {
          text: { content: recipe.instructions },
        },
      ],
    };
  }

  const formattedTime = formatRecipeTime(recipe.time);
  if (formattedTime && names.time) {
    properties[names.time] = {
      select: {
        name: formattedTime,
      },
    };
  }

  const recipeMeals = buildRecipeMeals(recipe);
  if (recipeMeals.length > 0 && names.meal) {
    properties[names.meal] = {
      multi_select: recipeMeals.map((meal) => ({
        name: meal,
      })),
    };
  }

  const recipeTags = buildRecipeTags(recipe);
  if (recipeTags.length > 0 && names.tags) {
    properties[names.tags] = {
      multi_select: recipeTags.map((tag) => ({
        name: tag,
      })),
    };
  }

  let coverImageUrl: string | undefined;
  const coverImageFiles = buildCoverImageFiles(recipe.image, recipe.title);
  if (coverImageFiles) {
    if (names.coverImage) {
      properties[names.coverImage] = {
        files: coverImageFiles,
      };
    }
    coverImageUrl = coverImageFiles[0]?.external.url;
  }

  return { properties, coverImageUrl };
};

export class NotionClient implements NotionGateway {
  private readonly client: Client;
  private readonly options: NotionGatewayOptions;
  private cachedFoodDataSourceId?: string | null;
  private cachedFoodDatabaseId?: string | null;
  private cachedRecipeDataSourceId?: string | null;
  private cachedRecipeDatabaseId?: string | null;
  private cachedIngredientDataSourceId?: string | null;
  private cachedIngredientDatabaseId?: string | null;

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

  private resolveDataSourceId(
    dataSourceId: string | undefined,
    cacheKey: "food" | "recipe" | "ingredient"
  ): string | null {
    const cacheMap = {
      food: () => this.cachedFoodDataSourceId,
      recipe: () => this.cachedRecipeDataSourceId,
      ingredient: () => this.cachedIngredientDataSourceId,
    };

    const cached = cacheMap[cacheKey]();
    if (cached !== undefined) {
      return cached;
    }

    if (!dataSourceId) {
      const cacheSetter = {
        food: (v: string | null) => {
          this.cachedFoodDataSourceId = v;
        },
        recipe: (v: string | null) => {
          this.cachedRecipeDataSourceId = v;
        },
        ingredient: (v: string | null) => {
          this.cachedIngredientDataSourceId = v;
        },
      };
      cacheSetter[cacheKey](null);
      return null;
    }

    const normalized = normalizeDatabaseIdForUrl(dataSourceId);
    logger.debug(
      { [`${cacheKey}DataSourceId`]: normalized },
      `Resolved ${cacheKey} data source ID.`
    );

    const cacheSetter = {
      food: (v: string | null) => {
        this.cachedFoodDataSourceId = v;
      },
      recipe: (v: string | null) => {
        this.cachedRecipeDataSourceId = v;
      },
      ingredient: (v: string | null) => {
        this.cachedIngredientDataSourceId = v;
      },
    };
    cacheSetter[cacheKey](normalized);
    return normalized;
  }

  private async resolveDatabaseIdFromDataSource(
    dataSourceId: string | null,
    cacheKey: "food" | "recipe" | "ingredient"
  ): Promise<string | null> {
    const cacheMap = {
      food: () => this.cachedFoodDatabaseId,
      recipe: () => this.cachedRecipeDatabaseId,
      ingredient: () => this.cachedIngredientDatabaseId,
    };

    const cacheSetter = {
      food: (v: string | null) => {
        this.cachedFoodDatabaseId = v;
      },
      recipe: (v: string | null) => {
        this.cachedRecipeDatabaseId = v;
      },
      ingredient: (v: string | null) => {
        this.cachedIngredientDatabaseId = v;
      },
    };

    // If already cached, return cached value
    const cached = cacheMap[cacheKey]();
    if (cached !== undefined) {
      return cached;
    }

    if (!dataSourceId) {
      cacheSetter[cacheKey](null);
      return null;
    }

    try {
      const response = await this.queryDataSource({
        dataSourceId,
        startCursor: undefined,
      });

      // Get the database ID from the first page's parent
      const firstPage = response.results[0];
      if (firstPage && isFullPage(firstPage)) {
        const parent = firstPage.parent;
        if (parent && "type" in parent && parent.type === "database_id") {
          const databaseId = parent.database_id;
          logger.debug(
            { databaseId, dataSourceId, type: cacheKey },
            `Resolved ${cacheKey} database ID from data source`
          );
          cacheSetter[cacheKey](databaseId);
          return databaseId;
        }
      }

      logger.warn(
        { dataSourceId, type: cacheKey },
        `Could not resolve ${cacheKey} database ID from data source - no pages found or invalid parent`
      );
      cacheSetter[cacheKey](null);
      return null;
    } catch (error) {
      logger.warn(
        { err: error, dataSourceId, type: cacheKey },
        `Failed to resolve ${cacheKey} database ID from data source`
      );
      cacheSetter[cacheKey](null);
      return null;
    }
  }

  private resolveFoodDataSourceId(): string | null {
    return this.resolveDataSourceId(this.options.foodDataSourceId, "food");
  }

  private async resolveFoodDatabaseId(): Promise<string | null> {
    const dataSourceId = this.resolveFoodDataSourceId();
    return await this.resolveDatabaseIdFromDataSource(dataSourceId, "food");
  }

  private resolveRecipeDataSourceId(): string | null {
    return this.resolveDataSourceId(this.options.recipeDataSourceId, "recipe");
  }

  private async resolveRecipeDatabaseId(): Promise<string | null> {
    const dataSourceId = this.resolveRecipeDataSourceId();
    return await this.resolveDatabaseIdFromDataSource(dataSourceId, "recipe");
  }

  private resolveIngredientDataSourceId(): string | null {
    return this.resolveDataSourceId(
      this.options.ingredientDataSourceId,
      "ingredient"
    );
  }

  private async resolveIngredientDatabaseId(): Promise<string | null> {
    const dataSourceId = this.resolveIngredientDataSourceId();
    return await this.resolveDatabaseIdFromDataSource(
      dataSourceId,
      "ingredient"
    );
  }

  private queryDataSource(args: {
    dataSourceId: string;
    startCursor?: string;
  }): Promise<{
    results: Array<PageObjectResponse | PartialPageObjectResponse>;
    has_more: boolean;
    next_cursor: string | null;
  }> {
    return this.client.dataSources.query({
      data_source_id: args.dataSourceId,
      start_cursor: args.startCursor,
    }) as Promise<{
      results: Array<PageObjectResponse | PartialPageObjectResponse>;
      has_more: boolean;
      next_cursor: string | null;
    }>;
  }

  async fetchFoodLookup(): Promise<FoodLookupItem[]> {
    if (!this.options.foodDataSourceId) {
      logger.debug(
        "fetchFoodLookup invoked without configured foodDataSourceId. Returning empty list."
      );
      return [];
    }

    const dataSourceId = this.resolveFoodDataSourceId();
    if (!dataSourceId) {
      logger.warn(
        "Failed to resolve food data source ID after normalization. Returning empty list."
      );
      return [];
    }

    const items: FoodLookupItem[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.queryDataSource({
        dataSourceId,
        startCursor: cursor,
      });

      logger.trace(
        {
          batchSize: response.results.length,
          nextCursor: response.next_cursor ?? null,
        },
        "Fetched food lookup batch from Notion data source."
      );

      for (const result of response.results) {
        if (!isFullPage(result)) {
          logger.debug(
            { pageId: result.id },
            "Skipping non-page result in food lookup fetch."
          );
          continue;
        }

        const mapped = this.mapFoodPage(result);
        if (mapped) {
          items.push(mapped);
        } else {
          logger.warn(
            { pageId: result.id },
            "Failed to map food lookup page due to missing properties."
          );
        }
      }

      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);

    return items;
  }

  private isFoodReviewed(
    properties: PageObjectResponse["properties"],
    mappings: { foodReviewed?: string }
  ): boolean {
    const reviewedPropertyKey =
      mappings.foodReviewed ?? defaultPropertyMappings.foodReviewed;
    const reviewedProperty = properties[reviewedPropertyKey];
    if (reviewedProperty?.type === "checkbox") {
      return reviewedProperty.checkbox;
    }
    if (reviewedProperty) {
      logger.debug(
        { reviewedPropertyType: reviewedProperty.type },
        "Food lookup Reviewed property is not a checkbox type."
      );
    }
    // If Reviewed property doesn't exist or isn't a checkbox, assume reviewed
    // This ensures items without the property are still included
    return true;
  }

  private extractFoodAliases(
    properties: PageObjectResponse["properties"],
    mappings: { foodAliases?: string },
    pageId: string
  ): string[] {
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
      } else {
        logger.trace(
          { pageId },
          "Food lookup aliases rich_text property empty."
        );
      }
    }

    return aliases;
  }

  private mapFoodPage(page: PageObjectResponse): FoodLookupItem | null {
    const properties = page.properties;
    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    const namePropertyKey =
      mappings.foodName ?? defaultPropertyMappings.foodName;
    const nameProperty = properties[namePropertyKey];

    if (!nameProperty || nameProperty.type !== "title") {
      logger.debug(
        { pageId: page.id, namePropertyKey },
        "Food lookup page missing title property or property is not a title type."
      );
      return null;
    }

    const name = getPlainText(nameProperty.title);
    if (!name) {
      logger.debug(
        { pageId: page.id },
        "Food lookup page title resolved to empty string."
      );
      return null;
    }

    // Check Reviewed status - only include items that are reviewed (checked)
    if (!this.isFoodReviewed(properties, mappings)) {
      logger.trace(
        { pageId: page.id, name },
        "Food lookup item not reviewed, skipping from lookup."
      );
      return null;
    }

    const aliases = this.extractFoodAliases(properties, mappings, page.id);

    return {
      id: page.id,
      name,
      aliases: aliases.length ? aliases : undefined,
    };
  }

  async findRecipeBySourceUrl(sourceUrl: string): Promise<string | null> {
    if (!sourceUrl) {
      return null;
    }

    const databaseId = await this.resolveRecipeDatabaseId();
    if (!databaseId) {
      logger.debug(
        "Cannot search for existing recipes: recipe database ID could not be resolved from data source."
      );
      return null;
    }

    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    const recipeSourceUrlProperty =
      mappings.recipeSourceUrl ?? defaultPropertyMappings.recipeSourceUrl;

    if (!recipeSourceUrlProperty) {
      logger.debug(
        "Cannot search for existing recipes: recipeSourceUrl property mapping is not configured."
      );
      return null;
    }

    try {
      // Use databases.query() for filtered queries (data sources don't support filters)
      const response = await (
        this.client.databases as unknown as {
          query: (args: {
            database_id: string;
            filter: {
              property: string;
              url: { equals: string };
            };
            page_size: number;
          }) => Promise<{
            results: Array<PageObjectResponse | PartialPageObjectResponse>;
          }>;
        }
      ).query({
        database_id: databaseId,
        filter: {
          property: recipeSourceUrlProperty,
          url: {
            equals: sourceUrl,
          },
        },
        page_size: 1,
      });

      const existingPage = response.results[0];
      if (existingPage && isFullPage(existingPage)) {
        logger.debug(
          { recipePageId: existingPage.id, sourceUrl },
          "Found existing recipe page by source URL"
        );
        return existingPage.id;
      }

      return null;
    } catch (error) {
      logger.warn(
        { err: error, sourceUrl },
        "Failed to query for existing recipe by source URL"
      );
      return null;
    }
  }

  async findFoodByName(name: string): Promise<string | null> {
    if (!name) {
      return null;
    }

    const databaseId = await this.resolveFoodDatabaseId();
    if (!databaseId) {
      logger.debug(
        "Cannot search for existing food: food database ID could not be resolved from data source."
      );
      return null;
    }

    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    const foodNameProperty =
      mappings.foodName ?? defaultPropertyMappings.foodName;

    if (!foodNameProperty) {
      logger.debug(
        "Cannot search for existing food: foodName property mapping is not configured."
      );
      return null;
    }

    try {
      // Use databases.query() for filtered queries (data sources don't support filters)
      const response = await (
        this.client.databases as unknown as {
          query: (args: {
            database_id: string;
            filter: {
              property: string;
              title: { equals: string };
            };
            page_size: number;
          }) => Promise<{
            results: Array<PageObjectResponse | PartialPageObjectResponse>;
          }>;
        }
      ).query({
        database_id: databaseId,
        filter: {
          property: foodNameProperty,
          title: {
            equals: name,
          },
        },
        page_size: 1,
      });

      const existingPage = response.results[0];
      if (existingPage && isFullPage(existingPage)) {
        logger.debug(
          { foodPageId: existingPage.id, name },
          "Found existing food page by name"
        );
        return existingPage.id;
      }

      return null;
    } catch (error) {
      logger.warn(
        { err: error, name },
        "Failed to query for existing food by name"
      );
      return null;
    }
  }

  async createFoodEntry(name: string, aliases?: string[]): Promise<string> {
    const databaseId = await this.resolveFoodDatabaseId();
    if (!databaseId) {
      throw new Error(
        "foodDatabaseId could not be resolved from foodDataSourceId. Ensure NOTION_FOOD_DATA_SOURCE_ID is configured and the data source contains at least one page."
      );
    }

    // Check for duplicates first
    const existingId = await this.findFoodByName(name);
    if (existingId) {
      logger.info(
        { foodPageId: existingId, name },
        "Food entry already exists, returning existing page ID"
      );
      return existingId;
    }

    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    const foodNameProperty =
      mappings.foodName ?? defaultPropertyMappings.foodName;
    const foodAliasesProperty =
      mappings.foodAliases ?? defaultPropertyMappings.foodAliases;
    const foodReviewedProperty =
      mappings.foodReviewed ?? defaultPropertyMappings.foodReviewed;

    const properties: Record<string, unknown> = {
      [foodNameProperty]: {
        title: [
          {
            text: { content: name },
          },
        ],
      },
      [foodReviewedProperty]: {
        checkbox: false, // Set Reviewed to unchecked
      },
    };

    // Add aliases if provided
    if (aliases && aliases.length > 0 && foodAliasesProperty) {
      // Use rich_text format for aliases (comma-separated)
      properties[foodAliasesProperty] = {
        rich_text: [
          {
            text: { content: aliases.join(", ") },
          },
        ],
      };
    }

    const response = await this.client.pages.create({
      parent: { database_id: databaseId },
      properties: properties as Parameters<
        Client["pages"]["create"]
      >[0]["properties"],
    });

    if (!isFullPage(response)) {
      throw new Error("Failed to create food page in Notion.");
    }

    logger.info(
      { foodPageId: response.id, name },
      "Created new food entry with Reviewed=false"
    );

    return response.id;
  }

  private async ensureRecipeNotExists(
    recipe: ScrapedRecipe
  ): Promise<string | null> {
    if (!recipe.sourceUrl) {
      return null;
    }
    const existingId = await this.findRecipeBySourceUrl(recipe.sourceUrl);
    if (existingId) {
      logger.info(
        { recipePageId: existingId, sourceUrl: recipe.sourceUrl },
        "Recipe already exists, returning existing page ID"
      );
      return existingId;
    }
    return null;
  }

  async createRecipePage(recipe: ScrapedRecipe): Promise<string> {
    const databaseId = await this.resolveRecipeDatabaseId();
    if (!databaseId) {
      throw new Error(
        "recipeDatabaseId could not be resolved from recipeDataSourceId. Ensure NOTION_RECIPES_DATA_SOURCE_ID is configured and the data source contains at least one page."
      );
    }

    // Check if recipe already exists by source URL
    const existingId = await this.ensureRecipeNotExists(recipe);
    if (existingId) {
      return existingId;
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
    const recipeTimeProperty =
      mappings.recipeTime ?? defaultPropertyMappings.recipeTime;
    const recipeMealProperty =
      mappings.recipeMeal ?? defaultPropertyMappings.recipeMeal;
    const recipeCoverImageProperty =
      mappings.recipeCoverImage ?? defaultPropertyMappings.recipeCoverImage;
    const recipeTagsProperty =
      mappings.recipeTags ?? defaultPropertyMappings.recipeTags;

    const { properties, coverImageUrl } = buildRecipePropertyValues(recipe, {
      name: recipeNameProperty,
      sourceUrl: recipeSourceUrlProperty,
      servings: recipeServingsProperty,
      instructions: recipeInstructionsProperty,
      time: recipeTimeProperty,
      meal: recipeMealProperty,
      coverImage: recipeCoverImageProperty,
      tags: recipeTagsProperty,
    });

    const instructionBlocks = buildInstructionBlocks(recipe.instructions);

    const createPayload: Parameters<Client["pages"]["create"]>[0] = {
      parent: { database_id: databaseId },
      properties: properties as Parameters<
        Client["pages"]["create"]
      >[0]["properties"],
      ...(instructionBlocks.length ? { children: instructionBlocks } : {}),
    };

    if (coverImageUrl) {
      createPayload.cover = {
        type: "external",
        external: { url: coverImageUrl },
      };
    }

    const response = await this.client.pages.create(createPayload);

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
      if (ingredient.unit) {
        properties[mapping.unit] = {
          select: {
            name: ingredient.unit,
          },
        };
      } else {
        properties[mapping.unit] = {
          select: null,
        };
      }
    }

    return properties as Parameters<Client["pages"]["create"]>[0]["properties"];
  }

  async createIngredientEntries(
    recipePageId: string,
    ingredients: MatchedIngredient[]
  ) {
    const databaseId = await this.resolveIngredientDatabaseId();
    if (!databaseId) {
      throw new Error(
        "ingredientDatabaseId could not be resolved from ingredientDataSourceId. Ensure NOTION_INGREDIENTS_DATA_SOURCE_ID is configured and the data source contains at least one page."
      );
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
      try {
        await this.client.pages.create({
          parent: { database_id: databaseId },
          properties: this.buildIngredientProperties(
            recipePageId,
            ingredient,
            resolvedMappings
          ),
        });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            ingredient: ingredient.name,
            unit: ingredient.unit,
          },
          "Failed to create ingredient entry in Notion"
        );
        // Re-throw to surface the error, but log context first
        throw error;
      }
    }
  }
}
