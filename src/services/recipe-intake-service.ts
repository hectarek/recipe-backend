import { logger } from "../logger.js";
import { rankFoodCandidates } from "../matchers/food-matcher.js";
import { checkProblematicMatch } from "../matchers/match-gotchas.js";
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
import {
  cleanForUsdaSearch,
  extractAliases,
  formatFoodName,
  isCompoundIngredient,
  splitFoodNameAndDetails,
} from "../utils/food-name-formatter.js";
import { EmbeddingCache } from "./embedding-gateway.js";
import { ReviewQueue } from "./review-queue.js";
import { UsdaApiClient } from "./usda-api-client.js";

const MAX_CANDIDATES = 5;

const buildIngredientMatchingStatus = (
  matchedCount: number,
  unmatchedCount: number,
  totalIngredients: number
): string => {
  if (unmatchedCount === 0 && matchedCount === totalIngredients) {
    return "all ingredients matched";
  }
  if (matchedCount > 0 && unmatchedCount > 0) {
    return `${matchedCount}/${totalIngredients} ingredients matched, ${unmatchedCount} unmatched`;
  }
  if (matchedCount === 0) {
    return "no ingredients matched";
  }
  return "";
};

const extractFoodNameAndDetails = (
  match: FoodMatchCandidate | null
): { name: string | null; details: string | null } => {
  if (!match?.food) {
    return { name: null, details: null };
  }

  // Split the food name into name and details if it contains details
  const { name, details } = splitFoodNameAndDetails(match.food.name);
  const foodName = formatFoodName(name);
  const foodDetails = details
    ? formatFoodName(details)
    : (match.food.details ?? null);

  return { name: foodName, details: foodDetails };
};

const buildMatchQualityBreakdown = (
  autoMatchedCount: number,
  probableCount: number,
  pendingReviewCount: number
): string => {
  const breakdown: string[] = [];
  if (autoMatchedCount > 0) {
    breakdown.push(`${autoMatchedCount} auto-matched`);
  }
  if (probableCount > 0) {
    breakdown.push(`${probableCount} probable`);
  }
  if (pendingReviewCount > 0) {
    breakdown.push(`${pendingReviewCount} pending review`);
  }
  return breakdown.length > 0 ? ` (${breakdown.join(", ")})` : "";
};

type RecipeProcessingSummary = {
  recipeTitle: string;
  recipePageId: string | null;
  persistedToNotion: boolean;
  totalIngredients: number;
  matchedCount: number;
  unmatchedCount: number;
  autoMatchedCount: number;
  probableCount: number;
  pendingReviewCount: number;
};

const logRecipeProcessingSummary = (summary: RecipeProcessingSummary): void => {
  const statusParts: string[] = [];

  if (summary.persistedToNotion) {
    statusParts.push("Recipe successfully added to Notion");
  } else {
    statusParts.push("Recipe processed");
  }

  const matchingStatus = buildIngredientMatchingStatus(
    summary.matchedCount,
    summary.unmatchedCount,
    summary.totalIngredients
  );
  if (matchingStatus) {
    statusParts.push(matchingStatus);
  }

  if (summary.unmatchedCount > 0) {
    statusParts.push("food items added for review");
  }

  const summaryMessage = statusParts.join(", ");
  const breakdownMessage = buildMatchQualityBreakdown(
    summary.autoMatchedCount,
    summary.probableCount,
    summary.pendingReviewCount
  );

  logger.info(
    {
      recipeTitle: summary.recipeTitle,
      recipePageId: summary.recipePageId ?? undefined,
      totalIngredients: summary.totalIngredients,
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      autoMatchedCount: summary.autoMatchedCount,
      probableCount: summary.probableCount,
      pendingReviewCount: summary.pendingReviewCount,
      persistedToNotion: summary.persistedToNotion,
    },
    `${summaryMessage}${breakdownMessage}`
  );
};

const WORD_SPLIT_REGEX = /\s+/;

const hasPerfectTokenMatch = (candidate: FoodMatchCandidate): boolean =>
  candidate.reasons.some(
    (reason) =>
      reason.type === "token-overlap" &&
      reason.meta &&
      typeof reason.meta === "object" &&
      "perfectMatch" in reason.meta &&
      reason.meta.perfectMatch === true
  );

/**
 * Checks for problematic single-word matches
 */
const hasProblematicSingleWordMatch = (
  singleWord: string,
  candidateName: string
): boolean => {
  const problematicPatterns = [
    {
      ingredient: "pepper",
      excludes: ["bell", "red", "green", "yellow", "orange"],
    },
    { ingredient: "salt", excludes: ["butter", "pepper"] },
    { ingredient: "stock", excludes: ["ground", "beef", "chicken", "pork"] },
    { ingredient: "leaf", excludes: ["lettuce", "cabbage"] },
  ];

  for (const pattern of problematicPatterns) {
    if (
      singleWord === pattern.ingredient &&
      pattern.excludes.some((exclude) => candidateName.includes(exclude))
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Checks for semantic mismatches in multi-word ingredients
 */
const hasSemanticMismatch = (
  ingredientName: string,
  candidateName: string
): boolean => {
  const semanticMismatches = [
    { ingredient: ["beef", "stock"], excludes: ["ground", "steak", "roast"] },
    { ingredient: ["bay", "leaf"], excludes: ["lettuce"] },
    { ingredient: ["thyme", "leaf"], excludes: ["lettuce"] },
  ];

  for (const mismatch of semanticMismatches) {
    if (
      mismatch.ingredient.every((word) => ingredientName.includes(word)) &&
      mismatch.excludes.some((exclude) => candidateName.includes(exclude))
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Validates if a match is semantically reasonable
 * Rejects matches that are clearly wrong (e.g., "pepper" -> "Bell Peppers")
 */
const isValidMatch = (
  ingredient: ParsedIngredient,
  candidate: FoodMatchCandidate
): boolean => {
  const ingredientName = ingredient.name.toLowerCase().trim();
  const candidateName = candidate.food.name.toLowerCase().trim();
  const ingredientWords = ingredientName
    .split(WORD_SPLIT_REGEX)
    .filter(Boolean);
  const candidateWords = candidateName.split(WORD_SPLIT_REGEX).filter(Boolean);

  // Single-word ingredient matching multi-word food requires higher confidence
  // Example: "pepper" should not match "Bell Orange Peppers" unless very confident
  if (
    ingredientWords.length === 1 &&
    candidateWords.length > 1 &&
    candidate.confidence < 90
  ) {
    const singleWord = ingredientWords[0] ?? "";
    if (
      candidateName.includes(singleWord) &&
      hasProblematicSingleWordMatch(singleWord, candidateName)
    ) {
      logger.debug(
        {
          ingredient: ingredient.name,
          candidate: candidate.food.name,
          confidence: candidate.confidence,
        },
        "Rejecting match: single-word ingredient matches wrong multi-word food"
      );
      return false;
    }
  }

  // Reject matches where ingredient name is substring but candidate has additional words
  // that change meaning (e.g., "beef stock" -> "Ground Beef")
  if (
    ingredientWords.length > 1 &&
    candidateWords.length > ingredientWords.length &&
    candidate.confidence < 85
  ) {
    const allWordsMatch = ingredientWords.every((word) =>
      candidateName.includes(word)
    );
    if (allWordsMatch && hasSemanticMismatch(ingredientName, candidateName)) {
      logger.debug(
        {
          ingredient: ingredient.name,
          candidate: candidate.food.name,
          confidence: candidate.confidence,
        },
        "Rejecting match: semantic mismatch detected"
      );
      return false;
    }
  }

  return true;
};

const checkGotchaAndTryNext = (
  ranked: FoodMatchCandidate[],
  ingredient: ParsedIngredient
): FoodMatchCandidate | null => {
  const best = ranked[0] ?? null;
  if (!best) {
    return null;
  }

  const gotchaCheck = checkProblematicMatch(ingredient, best);
  if (gotchaCheck.isProblematic) {
    logger.debug(
      {
        ingredient: ingredient.name,
        candidate: best.food.name,
        confidence: best.confidence,
        reason: gotchaCheck.reason,
        pattern: gotchaCheck.pattern,
      },
      "Rejecting match: known problematic pattern detected"
    );
    // Try next candidate
    const nextBest = ranked[1] ?? null;
    if (
      nextBest &&
      !checkProblematicMatch(ingredient, nextBest).isProblematic
    ) {
      return nextBest;
    }
    return null;
  }

  return best;
};

const categorizeMatch = (
  ranked: FoodMatchCandidate[],
  ingredient: ParsedIngredient
) => {
  const best = ranked[0] ?? null;

  if (!best) {
    return { autoMatch: null, probableMatch: null, best: null };
  }

  // Check for known problematic matches (gotchas)
  const validCandidate = checkGotchaAndTryNext(ranked, ingredient);
  if (!validCandidate) {
    return { autoMatch: null, probableMatch: null, best };
  }

  // Validate match quality
  if (!isValidMatch(ingredient, validCandidate)) {
    // If best match is invalid, try next candidate
    const nextBest = ranked[1] ?? null;
    if (nextBest && isValidMatch(ingredient, nextBest)) {
      return categorizeMatch([nextBest, ...ranked.slice(2)], ingredient);
    }
    // If no valid match found, return null for auto/probable
    return { autoMatch: null, probableMatch: null, best };
  }

  // Auto-match if confidence meets threshold OR if it's a perfect token match
  // Perfect token matches (e.g., "celery" -> "Celery") should auto-match even at 85%
  if (
    validCandidate.confidence >= HARD_MATCH_THRESHOLD ||
    (validCandidate.confidence >= 85 && hasPerfectTokenMatch(validCandidate))
  ) {
    return {
      autoMatch: validCandidate,
      probableMatch: null,
      best: validCandidate,
    };
  }

  if (validCandidate.confidence >= SOFT_MATCH_THRESHOLD) {
    return {
      autoMatch: null,
      probableMatch: validCandidate,
      best: validCandidate,
    };
  }

  return { autoMatch: null, probableMatch: null, best: validCandidate };
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
    const { autoMatch, probableMatch, best } = categorizeMatch(
      ranked,
      ingredient
    );
    const chosenMatch = autoMatch ?? probableMatch ?? best ?? null;

    // Extract food name and details from matched food item
    const extractedFoodInfo = extractFoodNameAndDetails(chosenMatch);

    const ingredientWithMatch: MatchedIngredient = {
      ...ingredient,
      foodId: autoMatch?.food.id ?? null,
      foodName: extractedFoodInfo.name,
      foodDetails: extractedFoodInfo.details,
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

const performUsdaLookup = async (
  foodName: string,
  rawName: string,
  usdaClient: UsdaApiClient
): Promise<{
  fdcId: number;
  description: string;
  details?: string | null;
} | null> => {
  // Clean the name specifically for USDA search (remove stop words, artifacts)
  const usdaSearchQuery = cleanForUsdaSearch(foodName);

  // Skip if search query is too short or empty after cleaning
  if (usdaSearchQuery.length < 3) {
    logger.debug(
      { originalName: rawName, cleanedQuery: usdaSearchQuery },
      "Skipping USDA lookup: query too short after cleaning"
    );
    return null;
  }

  // Try searching with cleaned query
  let match = await usdaClient.findBestMatch(usdaSearchQuery);

  // If no match, try with formatted name (less cleaned)
  if (!match && usdaSearchQuery !== foodName.toLowerCase()) {
    match = await usdaClient.findBestMatch(foodName.toLowerCase());
  }

  if (match) {
    logger.debug(
      {
        originalName: foodName,
        searchQuery: usdaSearchQuery,
        usdaDescription: match.description,
        fdcId: match.fdcId,
      },
      "Found USDA match for unmatched ingredient"
    );
    return {
      fdcId: match.fdcId,
      description: match.description,
    };
  }

  logger.debug(
    {
      originalName: rawName,
      searchQuery: usdaSearchQuery,
    },
    "No valid USDA match found"
  );
  return null;
};

const processUsdaMatch = async (
  foodName: string,
  rawName: string,
  usdaClient: UsdaApiClient
): Promise<{ name: string; details: string | null; usdaId: number } | null> => {
  const usdaMatch = await performUsdaLookup(foodName, rawName, usdaClient);
  if (!usdaMatch) {
    return null;
  }

  // Split USDA description into name and details
  const { name: usdaName, details: usdaDetails } = splitFoodNameAndDetails(
    usdaMatch.description
  );

  const formattedName = formatFoodName(usdaName);
  const formattedDetails = usdaDetails ? formatFoodName(usdaDetails) : null;

  logger.info(
    {
      originalName: rawName,
      formattedName,
      formattedDetails,
      usdaFdcId: usdaMatch.fdcId,
    },
    "Using USDA description (split into name and details)"
  );

  return {
    name: formattedName,
    details: formattedDetails,
    usdaId: usdaMatch.fdcId,
  };
};

const processUnmatchedIngredient = async (
  ingredient: ParsedIngredient,
  notionClient: NotionGateway,
  usdaClient: UsdaApiClient | null
): Promise<"success" | "skipped"> => {
  // Use the parsed ingredient name as the base
  const rawName = ingredient.name.trim();
  if (!rawName) {
    logger.warn(
      { raw: ingredient.raw, parsedName: ingredient.name },
      "Skipping unmatched ingredient with empty name after parsing"
    );
    return "skipped";
  }

  // Format the food name with proper capitalization and cleaning
  let foodName = formatFoodName(rawName);
  if (!foodName || foodName.trim().length === 0) {
    logger.warn(
      { raw: ingredient.raw, parsedName: rawName },
      "Skipping unmatched ingredient with empty name after formatting"
    );
    return "skipped";
  }

  let details: string | null = null;
  let usdaId: number | null = null;

  // Skip USDA lookup for compound ingredients (e.g., "salt & pepper")
  const isCompound = isCompoundIngredient(rawName);

  if (usdaClient && !isCompound) {
    try {
      const usdaResult = await processUsdaMatch(foodName, rawName, usdaClient);
      if (usdaResult) {
        foodName = usdaResult.name;
        details = usdaResult.details;
        usdaId = usdaResult.usdaId;
      }
    } catch (error) {
      logger.debug(
        {
          err: error instanceof Error ? error.message : error,
          ingredient: foodName,
        },
        "USDA API lookup failed, continuing with formatted name"
      );
    }
  } else if (isCompound) {
    logger.debug(
      { originalName: rawName },
      "Skipping USDA lookup for compound ingredient"
    );
  }

  // Extract aliases from normalized tokens
  const aliases = extractAliases(foodName, ingredient.normalizedTokens);

  // Create entry with Reviewed=false (as requested)
  // Note: createFoodEntry will return existing ID if duplicate found
  const foodPageId = await notionClient.createFoodEntry(
    foodName,
    aliases ?? undefined,
    details,
    usdaId
  );

  logger.info(
    {
      foodPageId,
      foodName,
      aliases,
      details,
      usdaId,
      raw: ingredient.raw,
      parsedName: rawName,
    },
    "Processed unmatched ingredient (created or found existing entry)"
  );

  return "success";
};

const persistUnmatchedToFoodLookup = async (
  notionClient: NotionGateway,
  unmatched: ParsedIngredient[]
) => {
  if (!unmatched.length) {
    return;
  }

  logger.info(
    { unmatchedCount: unmatched.length },
    "Persisting unmatched ingredients to food lookup table"
  );

  // Initialize USDA API client (optional, will be null if API key not configured)
  const usdaClient = new UsdaApiClient();

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const ingredient of unmatched) {
    try {
      const result = await processUnmatchedIngredient(
        ingredient,
        notionClient,
        usdaClient
      );
      if (result === "success") {
        successCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      errorCount += 1;
      logger.error(
        {
          err: error instanceof Error ? error.message : error,
          ingredient: ingredient.name,
          raw: ingredient.raw,
        },
        "Failed to create food entry for unmatched ingredient"
      );
      // Continue processing other ingredients even if one fails
    }
  }

  logger.info(
    {
      totalUnmatched: unmatched.length,
      successCount,
      skippedCount,
      errorCount,
    },
    "Finished persisting unmatched ingredients to food lookup table"
  );
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

  let recipePageId: string | null = null;
  let persistedToNotion = false;

  if (options.persistToNotion && options.notionClient) {
    persistedToNotion = true;
    // Check if there are unmatched ingredients
    const hasMissingIngredients = unmatched.length > 0;

    recipePageId = await options.notionClient.createRecipePage(
      scrapeResult.recipe,
      hasMissingIngredients
    );
    await persistToNotion(options.notionClient, recipePageId, matched);

    // Add unmatched ingredients to food lookup table with Reviewed=false
    await persistUnmatchedToFoodLookup(options.notionClient, unmatched);
  }

  // Generate comprehensive summary log
  const totalIngredients = parsedIngredients.length;
  const matchedCount = matched.length;
  const unmatchedCount = unmatched.length;
  const autoMatchedCount = matches.length;
  const probableCount = probables.length;
  const pendingReviewCount = pendingReview.length;

  logRecipeProcessingSummary({
    recipeTitle: scrapeResult.recipe.title,
    recipePageId,
    persistedToNotion,
    totalIngredients,
    matchedCount,
    unmatchedCount,
    autoMatchedCount,
    probableCount,
    pendingReviewCount,
  });

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
