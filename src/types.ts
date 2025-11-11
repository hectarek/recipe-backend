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
};

// Food lookup & matching -----------------------------------------------

export type FoodLookupItem = {
  id: string;
  name: string;
  aliases?: string[];
};

export type IndexedFood = FoodLookupItem & {
  normalizedName: string;
  tokenSet: Set<string>;
  aliasSet: Set<string>;
};

export type MatchedIngredient = ParsedIngredient & {
  foodId: string | null;
};

// Service responses ----------------------------------------------------

export type RecipeIntakeResponse = {
  recipe: ScrapedRecipe;
  ingredients: MatchedIngredient[];
  unmatched: ParsedIngredient[];
  rawSchema?: unknown;
};

// Notion integration ---------------------------------------------------

export type NotionGateway = {
  fetchFoodLookup(): Promise<FoodLookupItem[]>;
  createRecipePage(recipe: ScrapedRecipe): Promise<string>;
  createIngredientEntries(
    recipePageId: string,
    ingredients: MatchedIngredient[]
  ): Promise<void>;
};

export type NotionGatewayOptions = {
  apiToken?: string;
  recipeDatabaseId?: string;
  ingredientDatabaseId?: string;
  foodDatabaseId?: string;
  propertyMappings?: {
    recipeName?: string;
    recipeSourceUrl?: string;
    recipeServings?: string;
    recipeInstructions?: string;
    recipeTime?: string;
    recipeMeal?: string;
    recipeCoverImage?: string;
    recipeTags?: string;
    ingredientRecipeRelation?: string;
    ingredientFoodRelation?: string;
    ingredientQuantity?: string;
    ingredientUnit?: string;
    ingredientName?: string;
    foodName?: string;
    foodAliases?: string;
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
};

// Service configuration ------------------------------------------------

export type RecipeIntakeOptions = {
  foodLookup?: FoodLookupItem[];
  notionClient?: NotionGateway;
  persistToNotion?: boolean;
  scrapeRecipe?: typeof scrapeRecipeFromUrl;
};
