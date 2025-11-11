import { z } from "zod";
import { logger } from "../logger.js";
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

const foodLookupSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()).optional(),
  })
);

const fetchFoodLookupFromUrl = async (
  url: string
): Promise<FoodLookupItem[]> => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch food lookup from ${url}. Status: ${response.status}`
    );
  }

  const payload = await response.json();
  const parsed = foodLookupSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error("Food lookup payload is invalid.");
  }

  return parsed.data;
};

const buildNotionClientIfConfigured = (
  persistToNotion: boolean,
  hasProvidedLookup: boolean
) => {
  const token = process.env.NOTION_API_TOKEN;
  const recipeDb = process.env.NOTION_RECIPES_DATABASE_ID;
  const ingredientDb = process.env.NOTION_INGREDIENTS_DATABASE_ID;
  const foodDb = process.env.NOTION_FOOD_DATABASE_ID;

  if (!token) {
    return null;
  }

  if (persistToNotion) {
    if (!(recipeDb && ingredientDb)) {
      return null;
    }
  } else if (hasProvidedLookup || !foodDb) {
    return null;
  }

  return new NotionClient({
    apiToken: token,
    recipeDatabaseId: recipeDb,
    ingredientDatabaseId: ingredientDb,
    foodDatabaseId: foodDb,
  });
};

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

const fetchFoodLookupFromEnvironment = async (): Promise<FoodLookupItem[]> => {
  if (!process.env.FOOD_LOOKUP_URL) {
    return [];
  }

  try {
    return await fetchFoodLookupFromUrl(process.env.FOOD_LOOKUP_URL);
  } catch (error) {
    logger.warn(
      { err: error },
      "Unable to fetch food lookup from FOOD_LOOKUP_URL. Continuing without matches."
    );
    return [];
  }
};

type LookupPreparationResult =
  | { ok: true; lookup: FoodLookupItem[]; notionClient: NotionClient | null }
  | { ok: false; response: Response };

const prepareFoodLookup = async (
  providedLookup: FoodLookupItem[] | undefined,
  persistToNotion: boolean
): Promise<LookupPreparationResult> => {
  let lookup = providedLookup ?? [];

  if (!lookup.length) {
    lookup = await fetchFoodLookupFromEnvironment();
  }

  const notionClient = buildNotionClientIfConfigured(
    persistToNotion,
    lookup.length > 0
  );

  if (persistToNotion && !notionClient) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            "persistToNotion=true requires NOTION_API_TOKEN, NOTION_RECIPES_DATABASE_ID, and NOTION_INGREDIENTS_DATABASE_ID environment variables.",
        },
        400
      ),
    };
  }

  if (!lookup.length && notionClient) {
    try {
      lookup = await notionClient.fetchFoodLookup();
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to fetch food lookup via Notion. Continuing without matches."
      );
    }
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
