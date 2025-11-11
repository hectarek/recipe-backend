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
} as const;

const SERVINGS_NUMBER_REGEX = /(\d+(?:\.\d+)?)/;
const HOURS_TEXT_REGEX = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\b/i;
const MINUTES_TEXT_REGEX = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m)\b/i;
const NUMERIC_DURATION_REGEX = /^\d+(?:\.\d+)?$/;
const ISO_DATE_COMPONENT_REGEX = /(\d+(?:\.\d+)?)([YMWD])/gi;
const ISO_TIME_COMPONENT_REGEX = /(\d+(?:\.\d+)?)([YMWDHS])/gi;
const ISO_DATE_TIME_SEPARATOR_REGEX = /[Tt]/;
const ISO_DATE_DESIGNATOR_MULTIPLIERS: Record<string, number> = {
  Y: 525_600,
  M: 43_800,
  W: 10_080,
  D: 1440,
};
const ISO_TIME_DESIGNATOR_MULTIPLIERS: Record<string, number> = {
  H: 60,
  M: 1,
  S: 1 / 60,
  D: 1440,
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

const parseServings = (value: ScrapedRecipe["yield"]): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const match = value.match(SERVINGS_NUMBER_REGEX);
    if (match?.[1]) {
      const parsed = Number.parseFloat(match[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
};

const parseIsoLikeDurationMinutes = (value: string): number | null => {
  if (!value || (value[0] !== "P" && value[0] !== "p")) {
    return null;
  }

  const [datePartRaw, timePartRaw] = value
    .slice(1)
    .split(ISO_DATE_TIME_SEPARATOR_REGEX);
  let minutes = 0;
  let hasComponent = false;

  const accumulate = (
    segment: string | undefined,
    regex: RegExp,
    multipliers: Record<string, number>
  ) => {
    if (!segment) {
      return;
    }

    for (const match of segment.matchAll(regex)) {
      const amount = Number.parseFloat(match[1] ?? "");
      const designator = (match[2] ?? "").toUpperCase();
      const multiplier = multipliers[designator];
      if (!Number.isFinite(amount) || multiplier === undefined) {
        continue;
      }
      minutes += amount * multiplier;
      hasComponent = true;
    }
  };

  accumulate(
    datePartRaw,
    ISO_DATE_COMPONENT_REGEX,
    ISO_DATE_DESIGNATOR_MULTIPLIERS
  );
  accumulate(
    timePartRaw,
    ISO_TIME_COMPONENT_REGEX,
    ISO_TIME_DESIGNATOR_MULTIPLIERS
  );

  if (!hasComponent) {
    return null;
  }

  const rounded = Math.round(minutes);
  return Number.isFinite(rounded) ? rounded : null;
};

const parseTextDurationMinutes = (value: string): number | null => {
  const hoursMatch = value.match(HOURS_TEXT_REGEX);
  const minutesMatch = value.match(MINUTES_TEXT_REGEX);

  let total = 0;

  if (hoursMatch?.[1]) {
    total += Number.parseFloat(hoursMatch[1]) * 60;
  }

  if (minutesMatch?.[1]) {
    total += Number.parseFloat(minutesMatch[1]);
  }

  if (total > 0) {
    return Math.round(total);
  }

  return null;
};

const parseDurationMinutes = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoMinutes = parseIsoLikeDurationMinutes(trimmed);
  if (isoMinutes !== null) {
    return isoMinutes;
  }

  const textMinutes = parseTextDurationMinutes(trimmed);
  if (textMinutes !== null) {
    return textMinutes;
  }

  if (NUMERIC_DURATION_REGEX.test(trimmed)) {
    const numeric = Number.parseFloat(trimmed);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
  }

  return null;
};

const formatMinutesLabel = (minutes: number): string => {
  const positiveMinutes = Math.max(0, Math.round(minutes));
  if (positiveMinutes === 0) {
    return "Under 1 min";
  }

  if (positiveMinutes < 60) {
    return `${positiveMinutes} min`;
  }

  const hours = Math.floor(positiveMinutes / 60);
  const remainder = positiveMinutes % 60;

  if (remainder === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${remainder} min`;
};

const computeTimeMinutes = (
  time: ScrapedRecipe["time"] | undefined
): { minutes: number | null; fallback?: string } => {
  if (!time) {
    return { minutes: null, fallback: undefined };
  }

  const totalMinutes = parseDurationMinutes(time.total);
  if (totalMinutes !== null) {
    return { minutes: totalMinutes };
  }

  const prepMinutes = parseDurationMinutes(time.prep);
  const cookMinutes = parseDurationMinutes(time.cook);

  const combined = (prepMinutes ?? 0) + (cookMinutes ?? 0);
  if (combined > 0) {
    return { minutes: combined };
  }

  if (prepMinutes !== null) {
    return { minutes: prepMinutes };
  }

  if (cookMinutes !== null) {
    return { minutes: cookMinutes };
  }

  return {
    minutes: null,
    fallback: time.total ?? time.prep ?? time.cook ?? undefined,
  };
};

const formatRecipeTime = (
  time: ScrapedRecipe["time"] | undefined
): string | null => {
  const { minutes, fallback } = computeTimeMinutes(time);

  if (minutes !== null) {
    return formatMinutesLabel(minutes);
  }

  if (!fallback) {
    return null;
  }

  const fallbackMinutes = parseDurationMinutes(fallback);
  if (fallbackMinutes !== null) {
    return formatMinutesLabel(fallbackMinutes);
  }

  const trimmed = fallback.trim();
  return trimmed || null;
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

  private queryDatabase(args: {
    database_id: string;
    start_cursor?: string;
  }): Promise<{
    results: Array<PageObjectResponse | PartialPageObjectResponse>;
    has_more: boolean;
    next_cursor: string | null;
  }> {
    const databases = this.client.databases as unknown as {
      query?: (params: {
        database_id: string;
        start_cursor?: string;
      }) => Promise<{
        results: Array<PageObjectResponse | PartialPageObjectResponse>;
        has_more: boolean;
        next_cursor: string | null;
      }>;
    };

    if (typeof databases.query === "function") {
      return databases.query(args);
    }

    const body: Record<string, unknown> = {};
    if (args.start_cursor) {
      body.start_cursor = args.start_cursor;
    }

    return this.client.request({
      path: `databases/${args.database_id}/query`,
      method: "post",
      body,
    }) as Promise<{
      results: Array<PageObjectResponse | PartialPageObjectResponse>;
      has_more: boolean;
      next_cursor: string | null;
    }>;
  }

  async fetchFoodLookup(): Promise<FoodLookupItem[]> {
    if (!this.options.foodDatabaseId) {
      return [];
    }

    const items: FoodLookupItem[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.queryDatabase({
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
      parent: { database_id: this.options.recipeDatabaseId },
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
