import { matchIngredientToFood } from '../matchers/foodMatcher.js';
import { parseIngredients } from '../parsers/ingredientParser.js';
import { scrapeRecipeFromUrl } from '../scrapers/schemaRecipeScraper.js';
import type {
  FoodLookupItem,
  MatchedIngredient,
  NotionGateway,
  ParsedIngredient,
  RecipeIntakeOptions,
  RecipeIntakeResponse
} from '../types.js';

const mapParsedToMatched = (
  parsed: ParsedIngredient[],
  lookup: FoodLookupItem[]
): { matched: MatchedIngredient[]; unmatched: ParsedIngredient[] } => {
  const matched: MatchedIngredient[] = [];
  const unmatched: ParsedIngredient[] = [];

  for (const ingredient of parsed) {
    const match = lookup.length ? matchIngredientToFood(ingredient, lookup) : null;
    const ingredientWithMatch: MatchedIngredient = {
      ...ingredient,
      foodId: match?.id ?? null
    };

    matched.push(ingredientWithMatch);

    if (!ingredientWithMatch.foodId) {
      unmatched.push({
        raw: ingredient.raw,
        qty: ingredient.qty,
        unit: ingredient.unit,
        name: ingredient.name
      });
    }
  }

  return { matched, unmatched };
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
  const scrape = options.scrapeRecipe ?? scrapeRecipeFromUrl;
  const scrapeResult = await scrape(url);
  const parsedIngredients = parseIngredients(scrapeResult.ingredients);

  const foodLookup =
    options.foodLookup ??
    (options.notionClient ? await options.notionClient.fetchFoodLookup() : []);

  const { matched, unmatched } = mapParsedToMatched(parsedIngredients, foodLookup);

  if (options.persistToNotion && options.notionClient) {
    const recipePageId = await options.notionClient.createRecipePage(scrapeResult.recipe);
    await persistToNotion(options.notionClient, recipePageId, matched);
  }

  return {
    recipe: scrapeResult.recipe,
    ingredients: matched,
    unmatched,
    rawSchema: scrapeResult.rawSchema
  };
};
