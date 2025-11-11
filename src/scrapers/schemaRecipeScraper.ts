import * as cheerio from 'cheerio';
import type {
  JsonLdNode,
  RawIngredient,
  RecipeSchemaNode,
  RecipeScrapeResult,
  ScrapedRecipe
} from '../types.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36';

const recipeTypeMatches = (value: unknown): boolean => {
  if (!value) {
    return false;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'recipe';
  }

  if (Array.isArray(value)) {
    return value.some((entry) => recipeTypeMatches(entry));
  }

  return false;
};

const findRecipeNode = (node: unknown): Record<string, unknown> | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }

  if (recipeTypeMatches((node as Record<string, unknown>)['@type'])) {
    return node as Record<string, unknown>;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = findRecipeNode(item);
      if (result) {
        return result;
      }
    }
  }

  const graph = (node as Record<string, unknown>)['@graph'];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      const result = findRecipeNode(item);
      if (result) {
        return result;
      }
    }
  }

  return null;
};

const normalizeInstructions = (value: unknown): string => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim();
        }

        if (
          entry &&
          typeof entry === 'object' &&
          'text' in entry &&
          typeof (entry as Record<string, unknown>).text === 'string'
        ) {
          return ((entry as Record<string, unknown>).text as string).trim();
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>).text;
    if (typeof text === 'string') {
      return text.trim();
    }
  }

  return '';
};

const firstString = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const str = firstString(entry);
      if (str) {
        return str;
      }
    }
  }

  if (typeof value === 'object' && 'url' in (value as Record<string, unknown>)) {
    const url = (value as Record<string, unknown>).url;
    return typeof url === 'string' ? url : undefined;
  }

  return undefined;
};

const normalizeYield = (value: unknown): string | number | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' || typeof entry === 'number');
    if (typeof first === 'number' || typeof first === 'string') {
      return first;
    }
  }

  return undefined;
};

const normalizeTime = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? first : undefined;
  }

  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>).text;
    if (typeof text === 'string') {
      return text;
    }
  }

  return undefined;
};

const normalizeIngredients = (value: unknown): RawIngredient[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => !!entry);
  }

  if (typeof value === 'string') {
    return [value.trim()];
  }

  return [];
};

const buildScrapeResult = (schema: RecipeSchemaNode, sourceUrl: string): RecipeScrapeResult => {
  const instructions = normalizeInstructions(schema.recipeInstructions);
  const primaryIngredients = normalizeIngredients(schema.recipeIngredient);
  const ingredients =
    primaryIngredients.length > 0 ? primaryIngredients : normalizeIngredients(schema.ingredients);

  const recipe: ScrapedRecipe = {
    title: typeof schema.name === 'string' ? (schema.name as string) : 'Untitled recipe',
    sourceUrl,
    image: firstString(schema.image),
    yield: normalizeYield(schema.recipeYield),
    time: {
      total: normalizeTime(schema.totalTime),
      prep: normalizeTime(schema.prepTime),
      cook: normalizeTime(schema.cookTime)
    },
    instructions
  };

  return {
    recipe,
    ingredients,
    rawSchema: schema
  };
};

export const extractRecipeFromHtml = (html: string, sourceUrl: string): RecipeScrapeResult => {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');

  for (const element of scripts.toArray()) {
    const content = $(element).contents().text();
    if (!content) {
      continue;
    }

    try {
      const parsed = JSON.parse(content) as JsonLdNode;
      const recipeNode = findRecipeNode(parsed);
      if (recipeNode) {
        return buildScrapeResult(recipeNode as RecipeSchemaNode, sourceUrl);
      }
    } catch (_error) {
      // Ignore JSON parse errors and continue
    }
  }

  throw new Error('No recipe schema found in provided HTML.');
};

export const scrapeRecipeFromUrl = async (url: string): Promise<RecipeScrapeResult> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch recipe. Received status ${response.status}`);
  }

  const html = await response.text();
  return extractRecipeFromHtml(html, url);
};
