# Feature / Repo Specification

## 1. Summary

Implements a “recipe intake pipeline” that takes a recipe URL, scrapes structured recipe data (title, ingredients, instructions), normalizes ingredient lines, attempts to match them to an existing Notion-based Food Lookup table (seeded from USDA), and returns a Notion-ready payload for creating a Recipe and its Ingredient rows.

## 2. Goals

List what this code should accomplish.

-   Accept a recipe URL and extract structured recipe data (prefer schema.org/Recipe).
-   Normalize ingredient strings into { qty, unit, name }.
-   Attempt fuzzy matching of ingredient names against our Food Lookup items.
-   Output a clean JSON payload that can be used to create:
    -   1 Recipe record (Notion Recipes DB)
    -   N Ingredient records (Notion Ingredients DB) linked to the recipe
-   Preserve instructions in a normalized multiline format.
-   Handle “unmatched” ingredients explicitly so the user can map them once.

Success criteria - Scrapes most mainstream recipe sites without custom per-site logic. - Produces ingredient objects with at least raw, name, and qty for 80% of lines. - Returns a list of unmatched ingredients for manual cleanup. - JSON shape is stable so the Notion-creation step can be a separate script.

## 3. Non-Goals

-   Does not perform full nutrition lookup (that’s handled earlier by Food Lookup seeding).
-   Does not dedupe or merge grocery lists.
-   Does not guarantee 100% ingredient parsing for exotic phrasing.
-   Does not manage authentication/roles.
-   Does not create the rows in Notion itself (can be a separate worker/script that consumes the output).

## 4. Architecture Overview

### High-level approach

-   Small HTTP service (Node/Express) running on Railway.
-   Use Bun instead of Node.js, npm, pnpm, or vite.
-   Use Biome instead of ESLint and Prettier.
-   Single endpoint that:
    1. Fetches HTML from a recipe URL
    2. Extracts JSON-LD recipe if present
    3. Normalizes ingredients
    4. Tries to match to Food Lookup (provided to the service as JSON or fetched from Notion)
    5. Responds with structured JSON

Suggested layout

```
/src
  /scrapers
    schemaRecipeScraper.ts     // parse JSON-LD from HTML
  /parsers
    ingredient-parser.ts       // "1 cup chopped onion" -> {qty, unit, name}
  /matchers
    food-matcher.ts            // name -> Food Lookup item
  /services
    notion-client.ts           // (optional) to fetch Food Lookup / push rows
  /routes
    scrape-recipe.ts
  index.ts
```

Framework:

-   Node.js + Express (simple JSON API)
-   Deployed as a single service on Railway
-   Can be triggered from Notion via webhook or from an admin page

## 5. Data Models / Interfaces

```typescript
// Core recipe shape we return
type ScrapedRecipe = {
	title: string;
	sourceUrl: string;
	image?: string;
	yield?: string | number;
	time?: {
		total?: string;
		prep?: string;
		cook?: string;
	};
	instructions: string; // normalized newline-separated
};

// Raw ingredient line from site
type RawIngredient = string;

// Parsed ingredient
type ParsedIngredient = {
	raw: string; // "1 lb chicken breast, sliced"
	qty: number | null; // 1
	unit: string | null; // "lb"
	name: string; // "chicken breast"
};

// Food lookup item (from Notion or prebuilt JSON)
type FoodLookupItem = {
	id: string; // could be Notion page id or fdc_id
	name: string; // "Chicken breast, cooked"
	aliases?: string[];
};

// Matched ingredient ready for Notion Ingredients DB
type MatchedIngredient = {
	raw: string;
	qty: number | null;
	unit: string | null;
	name: string;
	foodId: string | null; // null if unmatched
};

// Final response
type RecipeIntakeResponse = {
	recipe: ScrapedRecipe;
	ingredients: MatchedIngredient[];
	unmatched: ParsedIngredient[]; // for manual mapping
};
```

⸻

## 6. API / Function Contracts

```typescript
POST /scrape-recipe
- Request:
  {
    "url": "https://example.com/my-recipe",
    // optional: send current food lookup so the service can match immediately
    "foodLookup": [
      { "id": "notion-page-1", "name": "Chicken breast, cooked", "aliases": ["chicken breast"] }
    ]
  }
```

### Behavior:

1. Fetch HTML from `url`
2. Extract recipe JSON-LD
3. Normalize instructions
4. Parse each ingredient line
5. Try to match each parsed ingredient to provided `foodLookup`
6. Return structured payload

```typescript
- Response: 200 OK
  {
    "recipe": {
      "title": "Lemon Chicken Rice Bowl",
      "sourceUrl": "https://example.com/my-recipe",
      "image": "https://...",
      "yield": "4 servings",
      "instructions": "Step 1...\nStep 2..."
    },
    "ingredients": [
      {
        "raw": "1 lb chicken breast, sliced",
        "qty": 1,
        "unit": "lb",
        "name": "chicken breast",
        "foodId": "notion-page-1"
      },
      {
        "raw": "2 cups cooked brown rice",
        "qty": 2,
        "unit": "cups",
        "name": "brown rice",
        "foodId": null
      }
    ],
    "unmatched": [
      {
        "raw": "2 cups cooked brown rice",
        "qty": 2,
        "unit": "cups",
        "name": "brown rice"
      }
    ]
  }
```

### Key internal functions

```typescript
// 1. scrape schema.org recipe from HTML
async function extractRecipeFromHtml(html: string): Promise<ScrapedRecipe>;

// 2. normalize instructions array/object to string
function normalizeInstructions(input: any): string;

// 3. parse ingredient line to structured form
function parseIngredient(line: string): ParsedIngredient;

// 4. match parsed ingredient to food lookup
function matchIngredientToFood(ingredient: ParsedIngredient, foods: FoodLookupItem[]): FoodLookupItem | null;

// 5. orchestrator
async function handleRecipeUrl(url: string, foods: FoodLookupItem[]): Promise<RecipeIntakeResponse>;
```

⸻

## 7. Dependencies

### External

-   node-fetch or native fetch → to get HTML
-   cheerio → to parse HTML and extract JSON-LD
-   LangChain LLM endpoint → if we want smarter ingredient parsing
-   (optional) Notion SDK → to fetch Food Lookup dynamically or to create pages afterward

### Internal / prior setup

-   Notion “Food Lookup” DB (already seeded from USDA)
-   Notion “Recipes” DB and “Ingredients” DB (from phase 1)

## 8. Acceptance Criteria / Test Plan

### Happy path

-   Given a URL that has schema.org Recipe JSON-LD, the endpoint returns 200 with recipe.title, ingredients[], and instructions populated.
-   Ingredient lines with simple formats (“1 cup milk”, “2 tbsp olive oil”) are parsed into qty/unit/name correctly.
-   Ingredients that exactly match a Food Lookup item (case-insensitive) have foodId set.
-   Ingredients that don’t match appear in unmatched[].

### Edge cases

-   If the page has multiple JSON-LD blocks, the first with @type: "Recipe" is used.
-   If instructions are an array of HowToStep objects, they are combined into a single string separated by newlines.
-   If no recipe schema is found, return 400 with a helpful error.
-   If an ingredient has no numeric qty (“salt to taste”), parser still returns { raw, name: "salt", qty: null, unit: null }.

Integration

-   Output JSON shape is compatible with a Notion-creation script (fields named consistently).
-   Can be called from a Notion button/webhook (simple POST with URL).

⸻

## 9. Risks / Open Questions

-   Some sites don’t expose schema.org Recipe → do we want a fallback scraper (heavier, more brittle)?
-   Ingredient phrasing varies a lot → do we want to allow an LLM “fix ingredients” step for better matching? (Yes)
-   Food Lookup may not contain brand-specific items — how do we want to store those (create-on-first-see vs. force manual mapping)?
-   Do we want to store the original raw JSON-LD in Notion for debugging? (No)
-   Rate limits / anti-bot from some sites — do we need a proxy later? (Yes)

⸻

## 10. Future Considerations (Optional)

-   Add a “learning” layer: when the user manually maps an unmatched ingredient to a Food Lookup item, save that mapping in the service so next time it’s auto-matched.
-   Add unit normalization using food_portion.csv to convert cups/tbsp to grams where possible.
-   Add macro preview in the response (sum of matched ingredients).
-   Add a small front-end “review & confirm” page so the user can fix ingredient matches before sending to Notion.
-   Add support for uploading a raw HTML / pasted recipe instead of URL.
