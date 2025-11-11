# Recipe Intake Service

Backend service that ingests a recipe URL, normalizes ingredient data, optionally matches ingredients to a Notion-hosted food lookup, and returns a Notion-ready payload. Designed for deployment to Railway and powered by [Bun](https://bun.com).

## Features
- Scrapes schema.org `Recipe` JSON-LD from most recipe sites.
- Parses ingredient strings into structured `{ qty, unit, name }` objects.
- Performs fuzzy matching against a Food Lookup list (inline JSON, remote URL, or Notion DB).
- Optional Notion integration to automatically create recipe and ingredient records.
- Native Bun HTTP server (`Bun.serve`) with a single POST endpoint.
- Typed TypeScript codebase with linting plus Bun’s built-in test runner.

## Getting Started

### Prerequisites
- [Bun](https://bun.com) v1.2+

### Install & Run
```bash
bun install
bun run dev
```

### Scripts
- `bun run dev` – run the API locally with Bun’s watcher.
- `bun run start` – run the API (used for production/Railway).
- `bun run build` – bundle the service into `dist/` using `bun build`.
- `bun run format` – apply Biome formatter fixes.
- `bun run lint` – run Biome’s linter with auto-fixes.
- `bun run check` – run Biome’s combined lint/format checks.
- `bun run test` – execute Bun’s test runner once.
- `bun run test:watch` – watch mode for Bun tests.

### Environment Variables

Create a `.env` file (Bun loads it automatically) or configure variables in Railway:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP port (defaults to `3000`). |
| `LOG_LEVEL` | Pino log level (default `info`). |
| `FOOD_LOOKUP_URL` | Optional HTTPS endpoint returning an array of Food Lookup items. |
| `NOTION_API_TOKEN` | Notion integration token. Required for Notion features. |
| `NOTION_RECIPES_DATABASE_ID` | Recipes database ID (needed when `persistToNotion=true`). |
| `NOTION_INGREDIENTS_DATABASE_ID` | Ingredients database ID (needed when `persistToNotion=true`). |
| `NOTION_FOOD_DATABASE_ID` | Optional ID to fetch Food Lookup items from Notion. |

## API

`POST /scrape-recipe`

```json
{
  "url": "https://example.com/recipe",
  "foodLookup": [
    { "id": "notion-page-1", "name": "Chicken breast, cooked", "aliases": ["chicken breast"] }
  ],
  "persistToNotion": false
}
```

Response

```jsonc
{
  "recipe": {
    "title": "Lemon Chicken Rice Bowl",
    "sourceUrl": "https://example.com/recipe",
    "image": "https://example.com/image.jpg",
    "yield": "4 servings",
    "time": { "total": "PT30M" },
    "instructions": "Step 1...\nStep 2..."
  },
  "ingredients": [
    {
      "raw": "1 lb chicken breast, sliced",
      "qty": 1,
      "unit": "lb",
      "name": "chicken breast",
      "foodId": "notion-page-1"
    }
  ],
  "unmatched": [],
  "rawSchema": { "..." : "Schema.org data (truncated)" },
  "persistedToNotion": false
}
```

## Project Structure
```
src/
  index.ts                 # Express bootstrap
  logger.ts                # Pino logger singleton
  types.ts                 # Shared interfaces
  routes/scrapeRecipe.ts   # Express route handler
  scrapers/schemaRecipeScraper.ts
  parsers/ingredientParser.ts
  matchers/foodMatcher.ts
  services/recipeIntakeService.ts
  services/notionClient.ts
tests/
  ...                      # Vitest suites (scraper, parser, matcher, service, route)
```

## Deployment (Railway)
1. Push the repository to GitHub.
2. Create a new Railway service from the repo.
3. Configure environment variables in Railway.
4. Set build command: `bun install && bun run build`.
5. Set start command: `bun run start`.
6. Optionally add a Railway health check hitting `/health`.

## Development Notes
- Ingredient parsing covers common units and descriptors; extend `UNIT_ALIASES`/`DESCRIPTORS` in `ingredientParser.ts` for edge cases.
- Food matching favors exact/alias matches before fuzzy token matching; adjust scoring in `foodMatcher.ts` as needed.
- Notion property mappings can be customized via `NotionClient` options when instantiating the client.
- Logging uses Bun’s built-in console; set `LOG_LEVEL=debug` for verbose output while troubleshooting.
