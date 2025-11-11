import type { scrapeRecipeFromUrl } from "./scrapers/schema-recipe-scraper.js";

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
  instructions: string;
};

export type RawIngredient = string;

export type ParsedIngredient = {
  raw: string;
  qty: number | null;
  unit: string | null;
  name: string;
};

export type FoodLookupItem = {
  id: string;
  name: string;
  aliases?: string[];
};

export type MatchedIngredient = ParsedIngredient & {
  foodId: string | null;
};

export type RecipeIntakeResponse = {
  recipe: ScrapedRecipe;
  ingredients: MatchedIngredient[];
  unmatched: ParsedIngredient[];
  rawSchema?: unknown;
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
};

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
    ingredientRecipeRelation?: string;
    ingredientFoodRelation?: string;
    ingredientQuantity?: string;
    ingredientUnit?: string;
    ingredientName?: string;
    foodName?: string;
    foodAliases?: string;
  };
};

export type RecipeIntakeOptions = {
  foodLookup?: FoodLookupItem[];
  notionClient?: NotionGateway;
  persistToNotion?: boolean;
  scrapeRecipe?: typeof scrapeRecipeFromUrl;
};
