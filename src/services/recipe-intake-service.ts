import { logger } from "../logger.js";
import { rankFoodCandidates } from "../matchers/food-matcher.js";
import {
  HARD_MATCH_THRESHOLD,
  SOFT_MATCH_THRESHOLD,
} from "../matchers/scoring.js";
import { parseIngredients } from "../parsers/ingredient-parser.js";
import { scrapeRecipeFromUrl } from "../scrapers/schema-recipe-scraper.js";
import type {
  EmbeddingGateway,
  FoodLookupItem,
  FoodMatchCandidate,
  MatchedIngredient,
  NotionGateway,
  ParsedIngredient,
  RecipeIntakeOptions,
  RecipeIntakeResponse,
  ReviewQueueItem,
} from "../types.js";
import { EmbeddingCache } from "./embedding-gateway.js";
import { ReviewQueue } from "./review-queue.js";

const MAX_CANDIDATES = 5;

const hasPerfectTokenMatch = (candidate: FoodMatchCandidate): boolean =>
  candidate.reasons.some(
    (reason) =>
      reason.type === "token-overlap" &&
      reason.meta &&
      typeof reason.meta === "object" &&
      "perfectMatch" in reason.meta &&
      reason.meta.perfectMatch === true
  );

const categorizeMatch = (ranked: FoodMatchCandidate[]) => {
  const best = ranked[0] ?? null;

  if (!best) {
    return { autoMatch: null, probableMatch: null, best: null };
  }

  // Auto-match if confidence meets threshold OR if it's a perfect token match
  // Perfect token matches (e.g., "celery" -> "Celery") should auto-match even at 80%
  if (
    best.confidence >= HARD_MATCH_THRESHOLD ||
    (best.confidence >= 80 && hasPerfectTokenMatch(best))
  ) {
    return { autoMatch: best, probableMatch: null, best };
  }

  if (best.confidence >= SOFT_MATCH_THRESHOLD) {
    return { autoMatch: null, probableMatch: best, best };
  }

  return { autoMatch: null, probableMatch: null, best };
};

const buildUnmatchedEntry = (
  ingredient: ParsedIngredient
): ParsedIngredient => ({
  raw: ingredient.raw,
  qty: ingredient.qty,
  unit: ingredient.unit,
  name: ingredient.name,
  descriptors: ingredient.descriptors,
  normalizedTokens: ingredient.normalizedTokens,
});

const mapParsedToMatched = async (
  parsed: ParsedIngredient[],
  lookup: FoodLookupItem[],
  embeddingGateway?: EmbeddingGateway,
  reviewQueue?: ReviewQueue
): Promise<{
  matched: MatchedIngredient[];
  unmatched: ParsedIngredient[];
  matches: MatchedIngredient[];
  probables: MatchedIngredient[];
  pendingReview: ReviewQueueItem[];
}> => {
  const matched: MatchedIngredient[] = [];
  const unmatched: ParsedIngredient[] = [];
  const confirmedMatches: MatchedIngredient[] = [];
  const probableMatches: MatchedIngredient[] = [];
  const pending: ReviewQueueItem[] = [];
  const embeddingCache = embeddingGateway
    ? new EmbeddingCache(embeddingGateway)
    : null;

  for (const ingredient of parsed) {
    const ranked = lookup.length
      ? (
          await rankFoodCandidates(ingredient, lookup, {
            embeddingCache,
          })
        ).slice(0, MAX_CANDIDATES)
      : [];
    const { autoMatch, probableMatch, best } = categorizeMatch(ranked);
    const chosenMatch = autoMatch ?? probableMatch ?? best ?? null;
    const ingredientWithMatch: MatchedIngredient = {
      ...ingredient,
      foodId: autoMatch?.food.id ?? null,
      match: chosenMatch,
      candidates: ranked,
    };

    matched.push(ingredientWithMatch);

    if (autoMatch) {
      logger.debug(
        {
          ingredient: ingredient.name,
          foodId: autoMatch.food.id,
          confidence: autoMatch.confidence,
        },
        "Ingredient auto-matched"
      );
      confirmedMatches.push(ingredientWithMatch);
      continue;
    }

    unmatched.push(buildUnmatchedEntry(ingredient));

    if (probableMatch) {
      logger.debug(
        {
          ingredient: ingredient.name,
          candidate: probableMatch.food.id,
          confidence: probableMatch.confidence,
        },
        "Ingredient probable match recorded"
      );
      probableMatches.push(ingredientWithMatch);
    }

    const suggestion = best ?? null;
    const queueItem: ReviewQueueItem = {
      ingredient,
      candidate: suggestion,
    };
    pending.push(queueItem);
    reviewQueue?.enqueue(ingredient, suggestion);
    logger.trace(
      { ingredient: ingredient.name },
      "Ingredient queued for manual review"
    );
  }

  const persistedPending =
    reviewQueue !== undefined ? await reviewQueue.flush() : pending;

  logger.debug(
    {
      autoMatches: confirmedMatches.length,
      probable: probableMatches.length,
      pending: persistedPending.length,
    },
    "Finished matching ingredients"
  );

  return {
    matched,
    unmatched,
    matches: confirmedMatches,
    probables: probableMatches,
    pendingReview: persistedPending,
  };
};

const persistToNotion = async (
  notionClient: NotionGateway,
  recipePageId: string,
  ingredients: MatchedIngredient[]
) => {
  const matched = ingredients.filter((ingredient) => ingredient.foodId);
  if (!matched.length) {
    return;
  }

  await notionClient.createIngredientEntries(recipePageId, matched);
};

export const handleRecipeUrl = async (
  url: string,
  options: RecipeIntakeOptions = {}
): Promise<RecipeIntakeResponse> => {
  logger.info({ url }, "Processing recipe intake request");
  const scrape = options.scrapeRecipe ?? scrapeRecipeFromUrl;
  const scrapeResult = await scrape(url);
  const parsedIngredients = parseIngredients(scrapeResult.ingredients);
  logger.debug(
    { ingredientCount: parsedIngredients.length },
    "Parsed ingredients from scrape result"
  );

  const foodLookup =
    options.foodLookup ??
    (options.notionClient ? await options.notionClient.fetchFoodLookup() : []);
  logger.info({ lookupCount: foodLookup.length }, "Prepared food lookup list");

  const reviewQueue = new ReviewQueue(options.reviewQueueGateway);

  const { matched, unmatched, matches, probables, pendingReview } =
    await mapParsedToMatched(
      parsedIngredients,
      foodLookup,
      options.embeddingGateway,
      reviewQueue
    );
  logger.info(
    {
      autoMatches: matches.length,
      probableMatches: probables.length,
      pendingReview: pendingReview.length,
    },
    "Ingredient matching completed"
  );

  if (options.persistToNotion && options.notionClient) {
    const recipePageId = await options.notionClient.createRecipePage(
      scrapeResult.recipe
    );
    await persistToNotion(options.notionClient, recipePageId, matched);
    logger.info({ recipePageId }, "Persisted matched ingredients to Notion");
  }

  return {
    recipe: scrapeResult.recipe,
    ingredients: matched,
    unmatched,
    matches,
    probables,
    pendingReview,
    rawSchema: scrapeResult.rawSchema,
  };
};
