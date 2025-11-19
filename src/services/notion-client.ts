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
import { splitFoodNameAndDetails } from "../utils/food-name-formatter.js";

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
  recipeMissingIngredients: "Missing Ingredients",
  ingredientRecipeRelation: "Recipe",
  ingredientFoodRelation: "Food",
  ingredientQuantity: "Qty",
  ingredientUnit: "Unit",
  ingredientName: "Name",
  ingredientDetails: "Details",
  foodName: "Name",
  foodAliases: "Aliases",
  foodReviewed: "Reviewed",
  foodUsdaId: "USDA FDC ID",
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

const buildOptionalRecipeProperties = (
  recipe: ScrapedRecipe,
  names: RecipePropertyNames,
  hasMissingIngredients: boolean,
  properties: Record<string, unknown>
): string | undefined => {
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

  // Set Missing Ingredients checkbox if property is configured
  if (names.missingIngredients) {
    properties[names.missingIngredients] = {
      checkbox: hasMissingIngredients,
    };
  }

  const coverImageFiles = buildCoverImageFiles(recipe.image, recipe.title);
  if (coverImageFiles && names.coverImage) {
    properties[names.coverImage] = {
      files: coverImageFiles,
    };
    return coverImageFiles[0]?.external.url;
  }

  return;
};

const buildRecipePropertyValues = (
  recipe: ScrapedRecipe,
  names: RecipePropertyNames,
  hasMissingIngredients = false
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

  const coverImageUrl = buildOptionalRecipeProperties(
    recipe,
    names,
    hasMissingIngredients,
    properties
  );

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
    // If explicitly provided (fallback), use it
    if (this.options.foodDatabaseId) {
      const normalized = normalizeDatabaseIdForUrl(this.options.foodDatabaseId);
      logger.debug(
        { foodDatabaseId: normalized },
        "Using provided food database ID as fallback"
      );
      return normalized;
    }

    // Otherwise, resolve from data source
    const dataSourceId = this.resolveFoodDataSourceId();
    return await this.resolveDatabaseIdFromDataSource(dataSourceId, "food");
  }

  private resolveRecipeDataSourceId(): string | null {
    return this.resolveDataSourceId(this.options.recipeDataSourceId, "recipe");
  }

  private async resolveRecipeDatabaseId(): Promise<string | null> {
    // If explicitly provided (fallback), use it
    if (this.options.recipeDatabaseId) {
      const normalized = normalizeDatabaseIdForUrl(
        this.options.recipeDatabaseId
      );
      logger.debug(
        { recipeDatabaseId: normalized },
        "Using provided recipe database ID as fallback"
      );
      return normalized;
    }

    // Otherwise, resolve from data source
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
    // If explicitly provided (fallback), use it
    if (this.options.ingredientDatabaseId) {
      const normalized = normalizeDatabaseIdForUrl(
        this.options.ingredientDatabaseId
      );
      logger.debug(
        { ingredientDatabaseId: normalized },
        "Using provided ingredient database ID as fallback"
      );
      return normalized;
    }

    // Otherwise, resolve from data source
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

  private processFoodLookupPage(
    result: PageObjectResponse | PartialPageObjectResponse,
    items: FoodLookupItem[]
  ): void {
    if (!isFullPage(result)) {
      logger.debug(
        { pageId: result.id },
        "Skipping non-page result in food lookup fetch."
      );
      return;
    }

    const { item, reason } = this.mapFoodPage(result);
    if (item) {
      items.push(item);
    } else if (reason !== "not_reviewed") {
      // Only warn for actual errors, not for expected filtering (not_reviewed)
      logger.warn(
        { pageId: result.id, reason },
        "Failed to map food lookup page due to missing properties or empty name."
      );
    }
    // Silently skip not_reviewed items (expected behavior)
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
        this.processFoodLookupPage(result, items);
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

  private mapFoodPage(page: PageObjectResponse): {
    item: FoodLookupItem | null;
    reason: "success" | "missing_property" | "empty_name" | "not_reviewed";
  } {
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
      return { item: null, reason: "missing_property" };
    }

    const name = getPlainText(nameProperty.title);
    if (!name) {
      logger.debug(
        { pageId: page.id },
        "Food lookup page title resolved to empty string."
      );
      return { item: null, reason: "empty_name" };
    }

    // Check Reviewed status - only include items that are reviewed (checked)
    if (!this.isFoodReviewed(properties, mappings)) {
      logger.trace(
        { pageId: page.id, name },
        "Food lookup item not reviewed, skipping from lookup."
      );
      return { item: null, reason: "not_reviewed" };
    }

    const aliases = this.extractFoodAliases(properties, mappings, page.id);

    // Split name into name and details if it contains comma-separated details
    const { name: foodName, details: foodDetails } =
      splitFoodNameAndDetails(name);

    return {
      item: {
        id: page.id,
        name: foodName,
        details: foodDetails ?? null,
        aliases: aliases.length ? aliases : undefined,
      },
      reason: "success",
    };
  }

  private async findPageInDataSource(
    dataSourceId: string,
    matcher: (page: PageObjectResponse) => boolean
  ): Promise<string | null> {
    try {
      let cursor: string | undefined;
      do {
        const response = await this.queryDataSource({
          dataSourceId,
          startCursor: cursor,
        });

        for (const page of response.results) {
          if (!isFullPage(page)) {
            continue;
          }

          if (matcher(page)) {
            return page.id;
          }
        }

        cursor = response.has_more
          ? (response.next_cursor ?? undefined)
          : undefined;
      } while (cursor);

      return null;
    } catch (error) {
      logger.warn(
        { err: error, dataSourceId },
        "Failed to query data source for page"
      );
      return null;
    }
  }

  async findRecipeBySourceUrl(sourceUrl: string): Promise<string | null> {
    if (!sourceUrl) {
      return null;
    }

    const dataSourceId = this.resolveRecipeDataSourceId();
    if (!dataSourceId) {
      logger.debug(
        "Cannot search for existing recipes: recipe data source ID is not configured."
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

    const pageId = await this.findPageInDataSource(dataSourceId, (page) => {
      const properties = page.properties;
      const urlProperty = properties[recipeSourceUrlProperty];
      return urlProperty?.type === "url" && urlProperty.url === sourceUrl;
    });

    if (pageId) {
      logger.debug(
        { recipePageId: pageId, sourceUrl },
        "Found existing recipe page by source URL"
      );
    }

    return pageId;
  }

  async findFoodByName(name: string): Promise<string | null> {
    if (!name) {
      return null;
    }

    const dataSourceId = this.resolveFoodDataSourceId();
    if (!dataSourceId) {
      logger.debug(
        "Cannot search for existing food: food data source ID is not configured."
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

    const normalizedName = name.toLowerCase().trim();

    const pageId = await this.findPageInDataSource(dataSourceId, (page) => {
      const properties = page.properties;
      const nameProperty = properties[foodNameProperty];
      if (nameProperty?.type === "title") {
        const pageName = getPlainText(nameProperty.title);
        return pageName?.toLowerCase().trim() === normalizedName;
      }
      return false;
    });

    if (pageId) {
      logger.debug(
        { foodPageId: pageId, name },
        "Found existing food page by name"
      );
    }

    return pageId;
  }

  async createFoodEntry(
    name: string,
    aliases?: string[],
    _details: string | null = null,
    usdaId: number | null = null
  ): Promise<string> {
    // _details parameter is for future use when food lookup table supports details property
    const databaseId = await this.resolveFoodDatabaseId();
    if (!databaseId) {
      throw this.buildDatabaseIdError(
        "food",
        !!this.options.foodDataSourceId,
        !!this.options.foodDatabaseId
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
    const foodUsdaIdProperty =
      mappings.foodUsdaId ?? defaultPropertyMappings.foodUsdaId;

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

    // Add USDA ID if provided (as rich_text since Notion property is rich_text)
    if (usdaId !== null && usdaId !== undefined && foodUsdaIdProperty) {
      properties[foodUsdaIdProperty] = {
        rich_text: [
          {
            text: { content: String(usdaId) },
          },
        ],
      };
    }

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

  private buildDatabaseIdError(
    type: "recipe" | "food" | "ingredient",
    hasDataSourceId: boolean,
    hasDatabaseId: boolean
  ): Error {
    const envVarNames = {
      recipe: "NOTION_RECIPES_DATA_SOURCE_ID",
      food: "NOTION_FOOD_DATA_SOURCE_ID",
      ingredient: "NOTION_INGREDIENTS_DATA_SOURCE_ID",
    };
    const envVarName = envVarNames[type];

    if (hasDataSourceId && !hasDatabaseId) {
      return new Error(
        `${type}DatabaseId could not be resolved from ${type}DataSourceId. ` +
          "The data source may be empty (no pages exist yet). " +
          `Either add at least one page to the data source, or provide ${type}DatabaseId as a fallback option.`
      );
    }

    return new Error(
      `${type}DatabaseId is required. ` +
        `Provide either ${envVarName} (with at least one page) or ${type}DatabaseId as a fallback.`
    );
  }

  async createRecipePage(
    recipe: ScrapedRecipe,
    hasMissingIngredients = false
  ): Promise<string> {
    const databaseId = await this.resolveRecipeDatabaseId();
    if (!databaseId) {
      throw this.buildDatabaseIdError(
        "recipe",
        !!this.options.recipeDataSourceId,
        !!this.options.recipeDatabaseId
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
    const recipeMissingIngredientsProperty =
      mappings.recipeMissingIngredients ??
      defaultPropertyMappings.recipeMissingIngredients;

    const { properties, coverImageUrl } = buildRecipePropertyValues(
      recipe,
      {
        name: recipeNameProperty,
        sourceUrl: recipeSourceUrlProperty,
        servings: recipeServingsProperty,
        instructions: recipeInstructionsProperty,
        time: recipeTimeProperty,
        meal: recipeMealProperty,
        coverImage: recipeCoverImageProperty,
        tags: recipeTagsProperty,
        missingIngredients: recipeMissingIngredientsProperty,
      },
      hasMissingIngredients
    );

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
      details: string | null;
    }
  ): Parameters<Client["pages"]["create"]>[0]["properties"] {
    const properties: Record<string, unknown> = {
      [mapping.recipeRelation]: {
        relation: [{ id: recipePageId }],
      },
      [mapping.name]: {
        title: [
          {
            text: {
              content: ingredient.foodName ?? ingredient.name,
            },
          },
        ],
      },
    };

    if (ingredient.foodId) {
      properties[mapping.foodRelation] = {
        relation: [{ id: ingredient.foodId }],
      };
    }

    if (
      mapping.quantity &&
      ingredient.qty !== null &&
      ingredient.qty !== undefined
    ) {
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

    // Add details if available and property is configured
    if (mapping.details && ingredient.foodDetails) {
      properties[mapping.details] = {
        rich_text: [
          {
            text: { content: ingredient.foodDetails },
          },
        ],
      };
    }

    return properties as Parameters<Client["pages"]["create"]>[0]["properties"];
  }

  private deduplicateIngredients(
    recipePageId: string,
    ingredients: MatchedIngredient[]
  ): MatchedIngredient[] {
    const seen = new Set<string>();
    const uniqueIngredients: MatchedIngredient[] = [];

    for (const ingredient of ingredients) {
      // Create a unique key: recipe + food + quantity + unit
      const key = `${recipePageId}:${ingredient.foodId ?? ingredient.name}:${ingredient.qty ?? ""}:${ingredient.unit ?? ""}`;
      if (seen.has(key)) {
        logger.debug(
          {
            ingredient: ingredient.name,
            foodId: ingredient.foodId,
            qty: ingredient.qty,
            unit: ingredient.unit,
          },
          "Skipping duplicate ingredient entry"
        );
        continue;
      }
      seen.add(key);
      uniqueIngredients.push(ingredient);
    }

    return uniqueIngredients;
  }

  private matchesQuantity(
    properties: PageObjectResponse["properties"],
    quantityProperty: string | null,
    expectedQty: number | null
  ): boolean {
    if (!quantityProperty) {
      return true; // No quantity property means match
    }

    const qtyProp = properties[quantityProperty];
    if (qtyProp?.type === "number") {
      const pageQty = qtyProp.number;
      if (expectedQty !== null && expectedQty !== undefined) {
        return pageQty === expectedQty;
      }
      return pageQty === null;
    }

    return expectedQty === null || expectedQty === undefined;
  }

  private matchesUnit(
    properties: PageObjectResponse["properties"],
    unitProperty: string | null,
    expectedUnit: string | null
  ): boolean {
    if (!unitProperty) {
      return true; // No unit property means match
    }

    const unitProp = properties[unitProperty];
    if (unitProp?.type === "select") {
      const pageUnit = unitProp.select?.name ?? null;
      if (expectedUnit) {
        return pageUnit === expectedUnit;
      }
      return pageUnit === null;
    }

    return !expectedUnit;
  }

  private matchesFood(
    properties: PageObjectResponse["properties"],
    ingredient: MatchedIngredient,
    mappings: {
      foodRelation: string;
      name: string;
    }
  ): boolean {
    if (ingredient.foodId) {
      const foodRelationProp = properties[mappings.foodRelation];
      return (
        foodRelationProp?.type === "relation" &&
        foodRelationProp.relation.some((rel) => rel.id === ingredient.foodId)
      );
    }

    // Match by name if no foodId
    const nameProp = properties[mappings.name];
    if (nameProp?.type === "title") {
      const pageName = getPlainText(nameProp.title);
      const ingredientName = ingredient.foodName ?? ingredient.name;
      return (
        pageName?.toLowerCase().trim() === ingredientName.toLowerCase().trim()
      );
    }

    return false;
  }

  private matchesRecipeRelation(
    properties: PageObjectResponse["properties"],
    recipeRelationProperty: string,
    recipePageId: string
  ): boolean {
    const recipeRelationProp = properties[recipeRelationProperty];
    return (
      recipeRelationProp?.type === "relation" &&
      recipeRelationProp.relation.some((rel) => rel.id === recipePageId)
    );
  }

  private matchesIngredientPage(
    page: PageObjectResponse,
    recipePageId: string,
    ingredient: MatchedIngredient,
    mappings: {
      recipeRelation: string;
      foodRelation: string;
      quantity: string | null;
      unit: string | null;
      name: string;
    }
  ): boolean {
    const properties = page.properties;

    // Check recipe relation
    if (
      !this.matchesRecipeRelation(
        properties,
        mappings.recipeRelation,
        recipePageId
      )
    ) {
      return false;
    }

    // Check quantity match
    if (!this.matchesQuantity(properties, mappings.quantity, ingredient.qty)) {
      return false;
    }

    // Check unit match
    if (!this.matchesUnit(properties, mappings.unit, ingredient.unit)) {
      return false;
    }

    // Check food relation or name match
    return this.matchesFood(properties, ingredient, {
      foodRelation: mappings.foodRelation,
      name: mappings.name,
    });
  }

  private async findExistingIngredient(
    recipePageId: string,
    ingredient: MatchedIngredient,
    mappings: {
      recipeRelation: string;
      foodRelation: string;
      quantity: string | null;
      unit: string | null;
      name: string;
    }
  ): Promise<string | null> {
    const dataSourceId = this.resolveIngredientDataSourceId();
    if (!dataSourceId) {
      return null;
    }

    try {
      // Query data source and filter in memory (data sources don't support filters)
      return await this.findPageInDataSource(dataSourceId, (page) =>
        this.matchesIngredientPage(page, recipePageId, ingredient, mappings)
      );
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : error,
          recipePageId,
          ingredient: ingredient.name,
        },
        "Failed to query for existing ingredient"
      );
      return null;
    }
  }

  private resolveIngredientMappings(): {
    recipeRelation: string;
    foodRelation: string;
    quantity: string | null;
    unit: string | null;
    name: string;
    details: string | null;
  } {
    const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
    return {
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
      details:
        mappings.ingredientDetails ??
        defaultPropertyMappings.ingredientDetails ??
        null,
    };
  }

  async createIngredientEntries(
    recipePageId: string,
    ingredients: MatchedIngredient[]
  ) {
    const databaseId = await this.resolveIngredientDatabaseId();
    if (!databaseId) {
      throw this.buildDatabaseIdError(
        "ingredient",
        !!this.options.ingredientDataSourceId,
        !!this.options.ingredientDatabaseId
      );
    }

    const resolvedMappings = this.resolveIngredientMappings();

    // Deduplicate ingredients before creating entries
    const uniqueIngredients = this.deduplicateIngredients(
      recipePageId,
      ingredients
    );

    for (const ingredient of uniqueIngredients) {
      // Check if ingredient already exists before creating
      const existingId = await this.findExistingIngredient(
        recipePageId,
        ingredient,
        {
          recipeRelation: resolvedMappings.recipeRelation,
          foodRelation: resolvedMappings.foodRelation,
          quantity: resolvedMappings.quantity,
          unit: resolvedMappings.unit,
          name: resolvedMappings.name,
        }
      );

      if (existingId) {
        logger.debug(
          {
            ingredientPageId: existingId,
            recipePageId,
            ingredient: ingredient.name,
            foodId: ingredient.foodId,
            qty: ingredient.qty,
            unit: ingredient.unit,
          },
          "Ingredient entry already exists, skipping creation"
        );
        continue;
      }

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

    // Refresh recipe page to trigger rollup recalculation
    // Notion rollups update automatically, but updating the page ensures they refresh
    // Add a small delay to allow Notion to process the relations first
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.refreshRecipePage(recipePageId);
  }

  /**
   * Refreshes a recipe page to trigger rollup recalculation.
   * This is called after creating ingredient entries to ensure rollups update.
   * Notion rollups can take a moment to update after relations are created,
   * so we fetch the page and update it to force a refresh.
   */
  private async refreshRecipePage(recipePageId: string): Promise<void> {
    try {
      // Fetch the recipe page to get its current properties
      const page = await this.client.pages.retrieve({ page_id: recipePageId });
      if (!isFullPage(page)) {
        logger.warn(
          { recipePageId },
          "Failed to refresh recipe page: page is not a full page object"
        );
        return;
      }

      const mappings = this.options.propertyMappings ?? defaultPropertyMappings;
      const recipeNameProperty =
        mappings.recipeName ?? defaultPropertyMappings.recipeName;
      const nameProperty = page.properties[recipeNameProperty];

      if (nameProperty?.type === "title") {
        // Update the page with its existing name to trigger rollup recalculation
        // This ensures that rollup properties on the recipe page are refreshed
        // Convert response format to request format
        const titleText = getPlainText(nameProperty.title) ?? "";
        if (titleText) {
          await this.client.pages.update({
            page_id: recipePageId,
            properties: {
              [recipeNameProperty]: {
                title: [
                  {
                    text: { content: titleText },
                  },
                ],
              },
            },
          });
          logger.debug(
            { recipePageId },
            "Refreshed recipe page to trigger rollup recalculation"
          );
        } else {
          logger.debug(
            { recipePageId },
            "Recipe page title is empty, skipping refresh"
          );
        }
      } else {
        logger.debug(
          { recipePageId, recipeNameProperty },
          "Recipe page name property not found or not a title type, skipping refresh"
        );
      }
    } catch (error) {
      // Log warning but don't fail - rollups should update automatically anyway
      logger.warn(
        {
          err: error instanceof Error ? error.message : error,
          recipePageId,
        },
        "Failed to refresh recipe page (rollups should still update automatically)"
      );
    }
  }
}
