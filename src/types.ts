import type { scrapeRecipeFromUrl } from "./scrapers/schema-recipe-scraper.js";

// Recipe scraping shapes -----------------------------------------------

export type ScrapedRecipe = {
  title: string;
  sourceUrl: string;
  image?: string;
  yield?: string | number;
  time?: {
    total?: string;
    prep?: string;
    cook?: string;
  };
  categories?: string[];
  cuisines?: string[];
  keywords?: string[];
  instructions: string;
};

export type RecipeScrapeResult = {
  recipe: ScrapedRecipe;
  ingredients: RawIngredient[];
  rawSchema: unknown;
};

export type JsonLdNode = Record<string, unknown> | JsonLdNode[];

export type RecipeSchemaNode = Record<string, unknown> & {
  name?: unknown;
  image?: unknown;
  recipeYield?: unknown;
  recipeIngredient?: unknown;
  ingredients?: unknown;
  recipeInstructions?: unknown;
  totalTime?: unknown;
  prepTime?: unknown;
  cookTime?: unknown;
  recipeCategory?: unknown;
  recipeCuisine?: unknown;
  keywords?: unknown;
};

// Ingredient parsing ---------------------------------------------------

export type RawIngredient = string;

export type ParsedIngredient = {
  raw: string;
  qty: number | null;
  unit: string | null;
  name: string;
  descriptors?: string[];
  normalizedTokens?: string[];
};

// Food lookup & matching -----------------------------------------------

export type FoodLookupItem = {
  id: string;
  name: string;
  details?: string | null;
  aliases?: string[];
};

export type EmbeddingVector = number[];

export type IndexedFood = FoodLookupItem & {
  normalizedName: string;
  tokenSet: Set<string>;
  aliasSet: Set<string>;
  aliasTokenSets: Set<string>[];
  embedding?: EmbeddingVector | null;
};

export type MatchReasonType =
  | "exact-name"
  | "alias-exact"
  | "prefix-match"
  | "token-overlap"
  | "alias-token-overlap"
  | "fuzzy-similarity"
  | "embedding-similarity";

export type MatchReason = {
  type: MatchReasonType;
  score: number;
  meta?: Record<string, unknown>;
};

export type FoodMatchCandidate = {
  food: FoodLookupItem;
  confidence: number;
  reasons: MatchReason[];
};

export type MatchedIngredient = ParsedIngredient & {
  foodId: string | null;
  foodName?: string | null;
  foodDetails?: string | null;
  match?: FoodMatchCandidate | null;
  candidates?: FoodMatchCandidate[];
};

export type ReviewQueueItem = {
  ingredient: ParsedIngredient;
  candidate?: FoodMatchCandidate | null;
};

export type ReviewQueueGateway = {
  persist(items: ReviewQueueItem[]): Promise<void>;
};

// Service responses ----------------------------------------------------

export type RecipeIntakeResponse = {
  recipe: ScrapedRecipe;
  ingredients: MatchedIngredient[];
  unmatched: ParsedIngredient[];
  rawSchema?: unknown;
  matches: MatchedIngredient[];
  probables: MatchedIngredient[];
  pendingReview: ReviewQueueItem[];
};

// Notion integration ---------------------------------------------------

export type NotionGateway = {
  fetchFoodLookup(): Promise<FoodLookupItem[]>;
  findRecipeBySourceUrl(sourceUrl: string): Promise<string | null>;
  createRecipePage(
    recipe: ScrapedRecipe,
    hasMissingIngredients?: boolean
  ): Promise<string>;
  createIngredientEntries(
    recipePageId: string,
    ingredients: MatchedIngredient[]
  ): Promise<void>;
  findFoodByName(name: string): Promise<string | null>;
  createFoodEntry(
    name: string,
    aliases?: string[],
    details?: string | null,
    usdaId?: number | null
  ): Promise<string>;
};

export type NotionGatewayOptions = {
  apiToken?: string;
  recipeDataSourceId?: string;
  recipeDatabaseId?: string; // Fallback for write operations when data source is empty
  ingredientDataSourceId?: string;
  ingredientDatabaseId?: string; // Fallback for write operations when data source is empty
  foodDataSourceId?: string;
  foodDatabaseId?: string; // Fallback for write operations when data source is empty
  propertyMappings?: {
    recipeName?: string;
    recipeSourceUrl?: string;
    recipeServings?: string;
    recipeInstructions?: string;
    recipeTime?: string;
    recipeMeal?: string;
    recipeCoverImage?: string;
    recipeTags?: string;
    recipeMissingIngredients?: string;
    recipeIngredientsRelation?: string;
    ingredientRecipeRelation?: string;
    ingredientFoodRelation?: string;
    ingredientQuantity?: string;
    ingredientUnit?: string;
    ingredientName?: string;
    ingredientDetails?: string;
    foodName?: string;
    foodAliases?: string;
    foodReviewed?: string;
    foodUsdaId?: string;
  };
};

export type RecipePropertyNames = {
  name: string;
  sourceUrl: string;
  servings?: string;
  instructions?: string;
  time?: string;
  meal?: string;
  coverImage?: string;
  tags?: string;
  missingIngredients?: string;
};

// Service configuration ------------------------------------------------

export type RecipeIntakeOptions = {
  foodLookup?: FoodLookupItem[];
  notionClient?: NotionGateway;
  persistToNotion?: boolean;
  scrapeRecipe?: typeof scrapeRecipeFromUrl;
  embeddingGateway?: EmbeddingGateway;
  reviewQueueGateway?: ReviewQueueGateway;
};

export type EmbeddingGateway = {
  embedIngredient(
    ingredient: ParsedIngredient
  ): Promise<EmbeddingVector | null>;
  embedFood(food: FoodLookupItem): Promise<EmbeddingVector | null>;
};
