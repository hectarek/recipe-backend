# Recipe Intake Service

Backend service that ingests a recipe URL, normalizes ingredient data, optionally matches ingredients to a Notion-hosted food lookup, and returns a Notion-ready payload. Designed for deployment to Railway and powered by [Bun](https://bun.com).

## Features

-   **Recipe Scraping**: Extracts structured data from schema.org JSON-LD markup
-   **Ingredient Parsing**: Normalizes ingredient strings into structured objects (quantity, unit, name)
-   **Food Matching**: Multi-tiered matching system (exact, alias, token, fuzzy, embedding-based)
-   **Notion Integration**: Full CRUD operations using Notion API v2025+ data sources
-   **Review Queue**: Handles unmatched/low-confidence ingredients for manual review
-   **Embedding Support**: Optional semantic matching via OpenAI and Pinecone

## Quick Start

### Prerequisites

-   [Bun](https://bun.com) v1.2+

### Install & Run

```bash
bun install
bun run dev
```

The service will start on `http://localhost:3000` (or the port specified by `PORT`).

### Basic Usage

```bash
curl -X POST http://localhost:3000/scrape-recipe \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/recipe",
    "persistToNotion": false
  }'
```

## Configuration

Create a `.env` file with the following variables:

```bash
# Server
PORT=3000
LOG_LEVEL=info

# Notion (required for Notion features)
NOTION_API_TOKEN=
NOTION_RECIPES_DATA_SOURCE_ID=          # Required if persistToNotion=true
NOTION_INGREDIENTS_DATA_SOURCE_ID=      # Required if persistToNotion=true
NOTION_FOOD_DATA_SOURCE_ID=

# Matching thresholds (optional)
MATCH_HARD_THRESHOLD=85
MATCH_SOFT_THRESHOLD=60

# Embeddings (optional)
OPENAI_API_KEY=
OPENAI_EMBED_MODEL=text-embedding-3-small
PINECONE_API_KEY=
PINECONE_INDEX=
PINECONE_INDEX_HOST=
PINECONE_NAMESPACE=
```

For a complete list of environment variables and their descriptions, see the [Architecture Documentation](./docs/ARCHITECTURE.md#configuration).

## API

### `POST /scrape-recipe`

Scrapes a recipe URL and returns structured data with matched ingredients.

**Request:**

```json
{
	"url": "https://example.com/recipe",
	"persistToNotion": false,
	"foodLookup": [] // Optional inline food lookup
}
```

**Response:**

```json
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
	"matches": [], // Auto-matched ingredients (confidence ≥ 85)
	"probables": [], // Probable matches (confidence ≥ 60)
	"pendingReview": [], // Items needing manual review
	"unmatched": []
}
```

### `GET /health`

Health check endpoint. Returns `{ "status": "ok" }`.

## Scripts

-   `bun run dev` – Run the API locally with Bun's watcher
-   `bun run start` – Run the API (production mode)
-   `bun run build` – Bundle the service into `dist/`
-   `bun run test` – Execute test suite
-   `bun run test:watch` – Watch mode for tests
-   `bun run lint` – Run linter with auto-fixes
-   `bun run format` – Apply code formatter

## Project Structure

```
src/
  index.ts                    # HTTP server bootstrap
  routes/                     # HTTP route handlers
  services/                   # Business logic & integrations
  scrapers/                   # Recipe scraping
  parsers/                    # Ingredient & recipe parsing
  matchers/                   # Food matching & scoring
  normalizers/                # Data normalization
  types.ts                    # TypeScript type definitions
tests/                        # Test suites
docs/                         # Documentation
  ARCHITECTURE.md            # Detailed architecture documentation
  SPEC.md                    # Project specification
```

## Documentation

-   **[Architecture Documentation](./docs/ARCHITECTURE.md)** – Comprehensive architecture overview, component details, data flow, and design decisions
-   **[Project Specification](./docs/SPEC.md)** – Feature specification, acceptance criteria, and technical requirements

## Deployment

### Railway

1. Push the repository to GitHub
2. Create a new Railway service from the repo
3. Configure environment variables in Railway dashboard
4. Set build command: `bun install && bun run build`
5. Set start command: `bun run start`
6. Optionally add a health check hitting `/health`

For detailed deployment instructions and configuration, see the [Architecture Documentation](./docs/ARCHITECTURE.md#deployment).

## License

MIT
