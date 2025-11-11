import { z } from 'zod';
import { logger } from '../logger.js';
import { NotionClient } from '../services/notionClient.js';
import { handleRecipeUrl } from '../services/recipeIntakeService.js';
import type { FoodLookupItem } from '../types.js';

const requestSchema = z.object({
  url: z.url(),
  foodLookup: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        aliases: z.array(z.string()).optional()
      })
    )
    .optional(),
  persistToNotion: z.boolean().optional()
});

const foodLookupSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()).optional()
  })
);

const fetchFoodLookupFromUrl = async (url: string): Promise<FoodLookupItem[]> => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch food lookup from ${url}. Status: ${response.status}`);
  }

  const payload = await response.json();
  const parsed = foodLookupSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error('Food lookup payload is invalid.');
  }

  return parsed.data;
};

const buildNotionClientIfConfigured = (persistToNotion: boolean, hasProvidedLookup: boolean) => {
  const token = process.env.NOTION_API_TOKEN;
  const recipeDb = process.env.NOTION_RECIPES_DATABASE_ID;
  const ingredientDb = process.env.NOTION_INGREDIENTS_DATABASE_ID;
  const foodDb = process.env.NOTION_FOOD_DATABASE_ID;

  if (!token) {
    return null;
  }

  if (persistToNotion) {
    if (!recipeDb || !ingredientDb) {
      return null;
    }
  } else if (hasProvidedLookup || !foodDb) {
    return null;
  }

  return new NotionClient({
    apiToken: token,
    recipeDatabaseId: recipeDb,
    ingredientDatabaseId: ingredientDb,
    foodDatabaseId: foodDb
  });
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });

export type ScrapeRecipeDeps = {
  handleRecipe: typeof handleRecipeUrl;
};

export const createScrapeRecipeHandler = (
  deps: ScrapeRecipeDeps = { handleRecipe: handleRecipeUrl }
) => {
  return async (request: Request): Promise<Response> => {
    let payload: unknown;

    try {
      payload = await request.json();
    } catch (error) {
      logger.warn({ err: error }, 'Invalid JSON body received for /scrape-recipe');
      return jsonResponse({ error: 'Invalid JSON body.' }, 400);
    }

    const parsed = requestSchema.safeParse(payload);

    if (!parsed.success) {
      return jsonResponse(
        {
          error: 'Invalid request body.',
          details: z.treeifyError(parsed.error)
        },
        400
      );
    }

    const { url, foodLookup, persistToNotion = false } = parsed.data;

    try {
      let resolvedFoodLookup: FoodLookupItem[] = foodLookup ?? [];

      if (!resolvedFoodLookup.length && process.env.FOOD_LOOKUP_URL) {
        try {
          resolvedFoodLookup = await fetchFoodLookupFromUrl(process.env.FOOD_LOOKUP_URL);
        } catch (lookupError) {
          logger.warn(
            { err: lookupError },
            'Unable to fetch food lookup from FOOD_LOOKUP_URL. Continuing without matches.'
          );
        }
      }

      const notionClient = buildNotionClientIfConfigured(
        persistToNotion,
        !!resolvedFoodLookup.length
      );

      if (persistToNotion && !notionClient) {
        return jsonResponse(
          {
            error:
              'persistToNotion=true requires NOTION_API_TOKEN, NOTION_RECIPES_DATABASE_ID, and NOTION_INGREDIENTS_DATABASE_ID environment variables.'
          },
          400
        );
      }

      if (!resolvedFoodLookup.length && notionClient) {
        try {
          resolvedFoodLookup = await notionClient.fetchFoodLookup();
        } catch (lookupError) {
          logger.warn(
            { err: lookupError },
            'Failed to fetch food lookup via Notion. Continuing without matches.'
          );
        }
      }

      const response = await deps.handleRecipe(url, {
        foodLookup: resolvedFoodLookup,
        notionClient: notionClient ?? undefined,
        persistToNotion: persistToNotion && !!notionClient
      });

      return jsonResponse({
        ...response,
        persistedToNotion: persistToNotion && !!notionClient
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to scrape recipe');

      if (error instanceof Error && /No recipe schema/i.test(error.message)) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ error: 'Failed to process recipe.' }, 500);
    }
  };
};
