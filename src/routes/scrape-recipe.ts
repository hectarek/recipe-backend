import { z } from "zod";
import { logger } from "../logger.js";
import { createEmbeddingGateway } from "../services/embedding-gateway.js";
import { NotionClient } from "../services/notion-client.js";
import { handleRecipeUrl } from "../services/recipe-intake-service.js";
import type { FoodLookupItem } from "../types.js";

const requestSchema = z.object({
  url: z.url(),
  foodLookup: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        aliases: z.array(z.string()).optional(),
      })
    )
    .optional(),
  persistToNotion: z.boolean().optional(),
});

const buildNotionClientIfConfigured = (persistToNotion: boolean) => {
  const token = process.env.NOTION_API_TOKEN;
  const recipeDataSource = process.env.NOTION_RECIPES_DATA_SOURCE_ID;
  const ingredientDataSource = process.env.NOTION_INGREDIENTS_DATA_SOURCE_ID;
  const foodDataSource = process.env.NOTION_FOOD_DATA_SOURCE_ID;

  if (!token) {
    logger.trace(
      "Skipping Notion client: NOTION_API_TOKEN is not configured in the environment."
    );
    return null;
  }

  if (persistToNotion) {
    if (!(recipeDataSource && ingredientDataSource)) {
      logger.warn(
        "persistToNotion=true but NOTION_RECIPES_DATA_SOURCE_ID or NOTION_INGREDIENTS_DATA_SOURCE_ID is missing."
      );
      return null;
    }
  } else if (!foodDataSource) {
    logger.debug(
      "Skipping Notion food lookup fetch: NOTION_FOOD_DATA_SOURCE_ID is not set."
    );
    return null;
  }

  return new NotionClient({
    apiToken: token,
    recipeDataSourceId: recipeDataSource,
    ingredientDataSourceId: ingredientDataSource,
    foodDataSourceId: foodDataSource,
    // Database IDs will be automatically resolved from data source IDs
  });
};

const embeddingGateway = createEmbeddingGateway();

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

type ParsedBody = z.infer<typeof requestSchema>;

type BodyParseResult =
  | { ok: true; data: ParsedBody }
  | { ok: false; response: Response };

const parseRequestPayload = async (
  request: Request
): Promise<BodyParseResult> => {
  try {
    const payload = await request.json();
    const parsed = requestSchema.safeParse(payload);

    if (!parsed.success) {
      return {
        ok: false,
        response: jsonResponse(
          {
            error: "Invalid request body.",
            details: z.treeifyError(parsed.error),
          },
          400
        ),
      };
    }

    return { ok: true, data: parsed.data };
  } catch (error) {
    logger.warn(
      { err: error },
      "Invalid JSON body received for /scrape-recipe"
    );
    return {
      ok: false,
      response: jsonResponse({ error: "Invalid JSON body." }, 400),
    };
  }
};

type LookupPreparationResult =
  | { ok: true; lookup: FoodLookupItem[]; notionClient: NotionClient | null }
  | { ok: false; response: Response };

const prepareFoodLookup = async (
  providedLookup: FoodLookupItem[] | undefined,
  persistToNotion: boolean
): Promise<LookupPreparationResult> => {
  const notionClient = buildNotionClientIfConfigured(persistToNotion);

  if (persistToNotion && !notionClient) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            "persistToNotion=true requires NOTION_API_TOKEN, NOTION_RECIPES_DATA_SOURCE_ID, and NOTION_INGREDIENTS_DATA_SOURCE_ID environment variables.",
        },
        400
      ),
    };
  }

  let lookup = providedLookup ?? [];

  if (lookup.length) {
    logger.info(
      { providedCount: lookup.length },
      "Using provided food lookup from request body."
    );
  }

  if (!lookup.length && notionClient) {
    try {
      logger.debug(
        {
          dataSourceId: process.env.NOTION_FOOD_DATA_SOURCE_ID,
        },
        "Attempting to fetch food lookup from Notion."
      );
      lookup = await notionClient.fetchFoodLookup();
      logger.info(
        { lookupCount: lookup.length },
        "Fetched food lookup from Notion"
      );
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to fetch food lookup via Notion. Continuing without matches."
      );
    }
  }

  if (!lookup.length) {
    logger.warn(
      "Food lookup is empty after preparation. Matching will proceed without semantic suggestions."
    );
  }

  return { ok: true, lookup, notionClient };
};

export type ScrapeRecipeDeps = {
  handleRecipe: typeof handleRecipeUrl;
};

const NO_RECIPE_SCHEMA_REGEX = /No recipe schema/i;

export const createScrapeRecipeHandler =
  (deps: ScrapeRecipeDeps = { handleRecipe: handleRecipeUrl }) =>
  async (request: Request): Promise<Response> => {
    const parsedBody = await parseRequestPayload(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const { url, foodLookup, persistToNotion = false } = parsedBody.data;

    try {
      const preparedLookup = await prepareFoodLookup(
        foodLookup,
        persistToNotion
      );
      if (!preparedLookup.ok) {
        return preparedLookup.response;
      }

      const { lookup, notionClient } = preparedLookup;
      const response = await deps.handleRecipe(url, {
        foodLookup: lookup,
        notionClient: notionClient ?? undefined,
        persistToNotion: persistToNotion && !!notionClient,
        embeddingGateway: embeddingGateway ?? undefined,
      });

      return jsonResponse({
        ...response,
        persistedToNotion: persistToNotion && !!notionClient,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to scrape recipe");

      if (
        error instanceof Error &&
        NO_RECIPE_SCHEMA_REGEX.test(error.message)
      ) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ error: "Failed to process recipe." }, 500);
    }
  };
