# Recipe Backend Architecture

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Component Details](#component-details)
4. [Data Flow](#data-flow)
5. [Key Design Decisions](#key-design-decisions)
6. [Dependencies](#dependencies)
7. [Configuration](#configuration)
8. [Testing Strategy](#testing-strategy)
9. [Deployment](#deployment)

---

## Overview

The Recipe Backend is a microservice built with **Bun** that ingests recipe URLs, extracts structured recipe data, normalizes ingredients, and optionally matches them against a Notion-hosted food lookup database. The service supports semantic matching using OpenAI embeddings and Pinecone vector storage, with a review queue system for manual verification of low-confidence matches.

### Key Features

-   **Recipe Scraping**: Extracts structured data from schema.org JSON-LD markup
-   **Ingredient Parsing**: Normalizes ingredient strings into structured objects (quantity, unit, name)
-   **Food Matching**: Multi-tiered matching system (exact, alias, token, fuzzy, embedding-based)
-   **Notion Integration**: Full CRUD operations using Notion API v2025+ data sources
-   **Review Queue**: Handles unmatched/low-confidence ingredients for manual review
-   **Embedding Support**: Optional semantic matching via OpenAI and Pinecone

---

## System Architecture

### High-Level Architecture

```
┌─────────────────┐
│   HTTP Client   │
└────────┬────────┘
         │ POST /scrape-recipe
         ▼
┌─────────────────────────────────────────────────────────┐
│              Bun HTTP Server (index.ts)                 │
│  - Health check endpoint (/health)                      │
│  - Recipe scraping endpoint (/scrape-recipe)            │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│         Route Handler (routes/scrape-recipe.ts)        │
│  - Request validation (Zod)                            │
│  - Notion client initialization                        │
│  - Embedding gateway initialization                    │
│  - Response formatting                                 │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│    Recipe Intake Service (services/recipe-intake.ts)   │
│  - Orchestrates entire pipeline                        │
│  - Coordinates scraping, parsing, matching, persistence│
└────────┬────────────────────────────────────────────────┘
         │
    ┌────┴────┬──────────────┬──────────────┬─────────────┐
    ▼         ▼              ▼              ▼             ▼
┌────────┐ ┌────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐
│Scraper │ │Parser  │  │ Matcher  │  │ Notion   │  │Review   │
│        │ │        │  │          │  │ Client   │  │ Queue   │
└────────┘ └────────┘  └──────────┘  └──────────┘  └─────────┘
```

### Component Layers

1. **Presentation Layer**: HTTP endpoints (`index.ts`, `routes/`)
2. **Service Layer**: Business logic orchestration (`services/`)
3. **Domain Layer**: Core parsing, matching, normalization (`parsers/`, `matchers/`, `normalizers/`)
4. **Integration Layer**: External API clients (`services/notion-client.ts`, `services/embedding-gateway.ts`)
5. **Data Layer**: Type definitions (`types.ts`)

---

## Component Details

### 1. HTTP Server (`src/index.ts`)

**Purpose**: Entry point for the application, sets up Bun HTTP server.

**Key Responsibilities**:

-   Initialize HTTP server on configured port
-   Route requests to appropriate handlers
-   Handle server errors gracefully
-   Provide health check endpoint

**Endpoints**:

-   `GET /health` - Health check (returns `{ status: "ok" }`)
-   `POST /scrape-recipe` - Main recipe intake endpoint

**Configuration**:

-   `PORT` environment variable (defaults to Bun's default port)

---

### 2. Route Handler (`src/routes/scrape-recipe.ts`)

**Purpose**: Handles HTTP requests for recipe scraping.

**Key Responsibilities**:

-   Validate request payload using Zod schema
-   Initialize Notion client (if configured)
-   Initialize embedding gateway (if configured)
-   Call recipe intake service
-   Format and return JSON responses

**Request Schema**:

```typescript
{
  url: string;              // Recipe URL to scrape
  persistToNotion?: boolean; // Whether to persist to Notion
  foodLookup?: FoodLookupItem[]; // Optional inline food lookup
}
```

**Response Schema**:

```typescript
{
  recipe: ScrapedRecipe;
  ingredients: MatchedIngredient[];
  unmatched: ParsedIngredient[];
  matches: MatchedIngredient[];      // Auto-matched (confidence ≥ 85)
  probables: MatchedIngredient[];    // Probable matches (confidence ≥ 60)
  pendingReview: ReviewQueueItem[];  // Items needing manual review
  rawSchema?: unknown;               // Original schema.org JSON-LD
}
```

---

### 3. Recipe Intake Service (`src/services/recipe-intake-service.ts`)

**Purpose**: Orchestrates the entire recipe intake pipeline.

**Pipeline Steps**:

1. **Scrape**: Extract recipe data from URL
2. **Parse**: Normalize ingredient strings
3. **Match**: Match ingredients against food lookup
4. **Categorize**: Classify matches (auto-match, probable, pending review)
5. **Persist**: Optionally save to Notion

**Key Functions**:

-   `handleRecipeUrl()` - Main orchestration function
-   `mapParsedToMatched()` - Maps parsed ingredients to matched ingredients
-   `categorizeMatch()` - Categorizes matches by confidence threshold
-   `persistToNotion()` - Persists matched ingredients to Notion

**Match Categories**:

-   **Auto-match** (`matches`): Confidence ≥ `HARD_MATCH_THRESHOLD` (default: 85) OR perfect token match
-   **Probable** (`probables`): Confidence ≥ `SOFT_MATCH_THRESHOLD` (default: 60)
-   **Pending Review** (`pendingReview`): Confidence < `SOFT_MATCH_THRESHOLD`

---

### 4. Recipe Scraper (`src/scrapers/schema-recipe-scraper.ts`)

**Purpose**: Extracts structured recipe data from HTML using schema.org JSON-LD.

**Key Functions**:

-   `scrapeRecipeFromUrl()` - Fetches HTML and extracts recipe
-   `extractRecipeFromHtml()` - Parses HTML and finds recipe schema
-   `findRecipeNode()` - Recursively searches for `@type: "Recipe"` node
-   `buildScrapeResult()` - Normalizes schema data into `ScrapedRecipe`

**Supported Schema Fields**:

-   `name` → `title`
-   `recipeIngredient` / `ingredients` → `ingredients[]`
-   `recipeInstructions` → `instructions`
-   `recipeYield` → `yield`
-   `totalTime` / `prepTime` / `cookTime` → `time`
-   `recipeCategory` → `categories`
-   `recipeCuisine` → `cuisines`
-   `image` → `image`
-   `keywords` → `keywords`

**Error Handling**:

-   Throws error if no recipe schema found
-   Handles JSON parse errors gracefully
-   Supports nested `@graph` structures

---

### 5. Ingredient Parser (`src/parsers/ingredient-parser.ts`)

**Purpose**: Parses raw ingredient strings into structured objects.

**Key Functions**:

-   `parseIngredient()` - Main parsing function
-   `parseQuantity()` - Extracts quantity (supports fractions, ranges, unicode)
-   `matchUnit()` - Matches unit aliases (e.g., "teaspoon" → "tsp")
-   `parseIngredients()` - Batch parsing helper

**Supported Formats**:

-   Quantities: `1`, `1.5`, `1/2`, `1 1/2`, `½`, ranges (`1-2`)
-   Units: Standard cooking units with aliases (see `const.ts`)
-   Names: Extracted after quantity and unit

**Output**:

```typescript
{
  raw: string;              // Original string
  qty: number | null;       // Parsed quantity
  unit: string | null;      // Normalized unit
  name: string;             // Ingredient name
  descriptors?: string[];   // Extracted descriptors
  normalizedTokens?: string[]; // Normalized tokens for matching
}
```

---

### 6. Ingredient Normalizer (`src/normalizers/ingredient-normalizer.ts`)

**Purpose**: Normalizes ingredient names for matching by stripping descriptors, parentheticals, and singularizing tokens.

**Key Functions**:

-   `normalizeIngredientName()` - Main normalization function
-   `removeParentheticalDescriptors()` - Strips parenthetical content
-   `removeDescriptorPhrases()` - Removes cooking descriptors (chopped, diced, etc.)
-   `singularizeToken()` - Converts plural to singular
-   `buildTokens()` - Creates token set for matching

**Normalization Steps**:

1. Remove parenthetical content (e.g., "(salted or unsalted)")
2. Remove descriptor phrases (e.g., "chopped", "diced")
3. Remove punctuation and non-alphanumeric characters
4. Singularize tokens (e.g., "carrots" → "carrot")
5. Create token set for matching

**Output**:

```typescript
{
  baseName: string;      // Cleaned base name
  descriptors: string[]; // Extracted descriptors
  tokens: string[];      // Normalized tokens
}
```

---

### 7. Recipe Parser (`src/parsers/recipe-parser.ts`)

**Purpose**: Parses recipe metadata (servings, time) into normalized formats.

**Key Functions**:

-   `parseServings()` - Parses yield/servings from string or number
-   `parseDurationMinutes()` - Parses duration strings (ISO, text, numeric)
-   `formatMinutesLabel()` - Formats minutes to human-readable label
-   `computeTimeMinutes()` - Computes total time from recipe time object
-   `formatRecipeTime()` - Formats recipe time for display

**Supported Time Formats**:

-   ISO 8601: `PT30M`, `P1DT2H30M`
-   Text: `"30 minutes"`, `"1 hour 30 minutes"`
-   Numeric: `"30"` (assumed minutes)

**Output**:

-   Servings: `number | null`
-   Time: `string | null` (e.g., `"30 min"`, `"1 h 30 min"`)

---

### 8. Food Matcher (`src/matchers/food-matcher.ts`)

**Purpose**: Ranks food candidates for ingredient matching.

**Key Functions**:

-   `rankFoodCandidates()` - Ranks all food candidates by confidence
-   `matchIngredientToFood()` - Returns best match (top candidate)
-   `buildIndex()` - Builds search index from food lookup items

**Indexing**:

-   Normalizes food names and aliases
-   Creates token sets for fast lookup
-   Prepares alias token sets for alias matching

**Output**:

-   `FoodMatchCandidate[]` - Sorted by confidence (highest first)
-   Each candidate includes confidence score and match reasons

---

### 9. Scoring System (`src/matchers/scoring.ts`)

**Purpose**: Calculates confidence scores for ingredient-to-food matches.

**Match Types** (in priority order):

1. **Exact Name Match** (100 points): Exact string match after normalization
2. **Alias Exact Match** (95 points): Matches an alias exactly
3. **Perfect Token Match** (100 points): All tokens match both ways
4. **Token Overlap** (60-80 points): Based on token coverage percentage
5. **Prefix Match** (85 points): One name starts with the other (requires ≥60% token overlap)
6. **Alias Token Overlap** (60-80 points): Token overlap with aliases
7. **Fuzzy Similarity** (0-70 points): Levenshtein distance similarity (≥70% threshold)
8. **Embedding Similarity** (0-30 points): Cosine similarity of embeddings (≥60% threshold)

**Score Combination**:

-   Multiple match reasons can contribute to final confidence
-   Scores are combined with weighted aggregation
-   Final confidence is capped at 100

**Thresholds**:

-   `HARD_MATCH_THRESHOLD`: Default 85 (configurable via `MATCH_HARD_THRESHOLD`)
-   `SOFT_MATCH_THRESHOLD`: Default 60 (configurable via `MATCH_SOFT_THRESHOLD`)

**Key Functions**:

-   `scoreCandidate()` - Main scoring function
-   `computePerfectTokenMatchReason()` - Detects perfect token matches
-   `computePrefixMatchReason()` - Conditional prefix matching
-   `computeTokenOverlapScore()` - Calculates token overlap
-   `computeLevenshteinSimilarity()` - Fuzzy string matching
-   `combineScores()` - Aggregates multiple match reasons

---

### 10. Embedding Gateway (`src/services/embedding-gateway.ts`)

**Purpose**: Generates and caches embeddings for semantic matching.

**Implementation**: `OpenAIPineconeEmbeddingGateway`

**Key Features**:

-   Generates embeddings via OpenAI API
-   Stores food embeddings in Pinecone for caching
-   Caches embeddings in-memory during request processing
-   Falls back gracefully if embedding generation fails

**Key Classes**:

-   `OpenAIPineconeEmbeddingGateway` - Main implementation
-   `EmbeddingCache` - In-memory cache wrapper
-   `NullEmbeddingGateway` - No-op implementation

**Embedding Text Construction**:

-   **Food**: `"{name} | {alias1} | {alias2}"`
-   **Ingredient**: `"{name} {descriptors.join(' ')}"`

**Configuration**:

-   `OPENAI_API_KEY` - OpenAI API key
-   `OPENAI_EMBED_MODEL` - Model name (default: `text-embedding-3-small`)
-   `PINECONE_API_KEY` - Pinecone API key
-   `PINECONE_INDEX` - Index name or host URL
-   `PINECONE_INDEX_HOST` - Index host URL (if using serverless)
-   `PINECONE_INDEX_NAME` - Index name (if `PINECONE_INDEX` is host URL)
-   `PINECONE_NAMESPACE` - Optional namespace

---

### 11. Notion Client (`src/services/notion-client.ts`)

**Purpose**: Handles all Notion API interactions using v2025+ data sources.

**Key Features**:

-   Uses data sources for reading (v2025+ API)
-   Resolves database IDs from data sources automatically
-   Caches resolved IDs for performance
-   Prevents duplicates (recipes by URL, foods by name)
-   Filters food lookup by "Reviewed" checkbox

**Data Source Pattern**:

-   **Reading**: Uses `client.dataSources.query()` for fetching
-   **Writing**: Resolves database ID from data source, then uses `client.pages.create()`
-   **Filtered Queries**: Uses `client.databases.query()` (data sources don't support filters)

**Key Methods**:

-   `fetchFoodLookup()` - Fetches food lookup items (only reviewed items)
-   `findRecipeBySourceUrl()` - Checks for duplicate recipes
-   `createRecipePage()` - Creates recipe page in Notion
-   `createIngredientEntries()` - Creates ingredient pages
-   `findFoodByName()` - Checks for duplicate foods
-   `createFoodEntry()` - Creates food entry (with Reviewed=false)

**Property Mappings**:

-   Configurable property names for all Notion properties
-   Default mappings provided (see `defaultPropertyMappings`)
-   Supports custom mappings via `NotionGatewayOptions`

**Review Workflow**:

-   New food entries created with `Reviewed=false`
-   `fetchFoodLookup()` only returns items where `Reviewed=true`
-   Prevents duplicates by checking name before creation

---

### 12. Review Queue (`src/services/review-queue.ts`)

**Purpose**: Manages ingredients pending manual review.

**Key Features**:

-   Collects unmatched/low-confidence ingredients
-   Can persist to external gateway (e.g., Notion database)
-   Flushes queue after processing

**Key Methods**:

-   `enqueue()` - Adds ingredient to queue
-   `flush()` - Persists queue and clears it

**Queue Item Structure**:

```typescript
{
  ingredient: ParsedIngredient;
  candidate?: FoodMatchCandidate | null; // Best match suggestion
}
```

---

### 13. Logger (`src/logger.ts`)

**Purpose**: Structured logging with configurable levels.

**Log Levels** (in priority order):

-   `trace` - Detailed debugging
-   `debug` - Important state changes
-   `info` - High-level operations
-   `warn` - Recoverable errors
-   `error` - Critical failures
-   `fatal` - Unrecoverable errors

**Configuration**:

-   `LOG_LEVEL` environment variable (default: `info`)

**Format**:

```
[ISO_TIMESTAMP] LEVEL message {metadata}
```

---

### 14. Constants (`src/const.ts`)

**Purpose**: Centralized constants and regex patterns.

**Key Constants**:

-   `UNICODE_FRACTIONS` - Unicode fraction mappings
-   `UNIT_ALIASES` - Unit normalization mappings
-   `DESCRIPTORS` - Cooking descriptor phrases
-   Regex patterns for parsing (servings, time, durations, database IDs)

---

### 15. Types (`src/types.ts`)

**Purpose**: Centralized TypeScript type definitions.

**Key Types**:

-   `ScrapedRecipe` - Recipe data from scraping
-   `ParsedIngredient` - Parsed ingredient structure
-   `FoodLookupItem` - Food lookup entry
-   `MatchedIngredient` - Ingredient with match information
-   `FoodMatchCandidate` - Match candidate with confidence
-   `RecipeIntakeResponse` - API response structure
-   `NotionGateway` - Notion client interface
-   `EmbeddingGateway` - Embedding service interface
-   `ReviewQueueGateway` - Review queue persistence interface

---

## Data Flow

### Recipe Intake Flow

```
1. HTTP Request
   POST /scrape-recipe
   { url: "https://example.com/recipe", persistToNotion: true }
   │
   ▼
2. Route Handler (scrape-recipe.ts)
   - Validates request
   - Initializes Notion client
   - Initializes embedding gateway
   │
   ▼
3. Recipe Intake Service (recipe-intake-service.ts)
   │
   ├─► 4. Scrape Recipe (schema-recipe-scraper.ts)
   │   - Fetches HTML from URL
   │   - Extracts schema.org JSON-LD
   │   - Normalizes recipe data
   │   └─► Returns: ScrapedRecipe + RawIngredient[]
   │
   ├─► 5. Parse Ingredients (ingredient-parser.ts)
   │   - Parses quantity, unit, name
   │   - Normalizes ingredient names
   │   └─► Returns: ParsedIngredient[]
   │
   ├─► 6. Fetch Food Lookup (notion-client.ts)
   │   - Queries Notion data source
   │   - Filters by Reviewed=true
   │   └─► Returns: FoodLookupItem[]
   │
   ├─► 7. Match Ingredients (food-matcher.ts + scoring.ts)
   │   - Builds search index
   │   - Ranks candidates for each ingredient
   │   - Calculates confidence scores
   │   - Optionally uses embeddings
   │   └─► Returns: FoodMatchCandidate[] per ingredient
   │
   ├─► 8. Categorize Matches (recipe-intake-service.ts)
   │   - Auto-match: confidence ≥ 85 OR perfect token match
   │   - Probable: confidence ≥ 60
   │   - Pending review: confidence < 60
   │   └─► Returns: MatchedIngredient[] (categorized)
   │
   ├─► 9. Review Queue (review-queue.ts)
   │   - Collects pending review items
   │   - Optionally persists to gateway
   │   └─► Returns: ReviewQueueItem[]
   │
   └─► 10. Persist to Notion (if persistToNotion=true)
       - Creates recipe page
       - Creates ingredient pages (only auto-matched)
       └─► Returns: Recipe page ID
   │
   ▼
11. HTTP Response
    {
      recipe: ScrapedRecipe,
      ingredients: MatchedIngredient[],
      unmatched: ParsedIngredient[],
      matches: MatchedIngredient[],
      probables: MatchedIngredient[],
      pendingReview: ReviewQueueItem[]
    }
```

### Matching Flow (Detailed)

```
Ingredient: "1 cup chopped onion"
│
├─► Parse (ingredient-parser.ts)
│   └─► { qty: 1, unit: "cup", name: "chopped onion" }
│
├─► Normalize (ingredient-normalizer.ts)
│   └─► { baseName: "onion", tokens: ["onion"], descriptors: ["chopped"] }
│
├─► Build Index (food-matcher.ts)
│   └─► IndexedFood[] with normalized names, tokens, aliases
│
├─► Score Candidates (scoring.ts)
│   ├─► Exact name match? → 100 points
│   ├─► Alias match? → 95 points
│   ├─► Perfect token match? → 100 points
│   ├─► Token overlap? → 60-80 points
│   ├─► Prefix match? → 85 points (if token overlap ≥ 60%)
│   ├─► Fuzzy similarity? → 0-70 points (if ≥ 70% similar)
│   └─► Embedding similarity? → 0-30 points (if ≥ 60% similar)
│
├─► Combine Scores
│   └─► Final confidence: 0-100
│
└─► Categorize
    ├─► confidence ≥ 85 OR perfect match → Auto-match
    ├─► confidence ≥ 60 → Probable
    └─► confidence < 60 → Pending review
```

---

## Key Design Decisions

### 1. Separation of Concerns

**Parsers** (`parsers/`): Pure domain logic, Notion-agnostic

-   `ingredient-parser.ts` - Parses ingredient strings
-   `recipe-parser.ts` - Parses recipe metadata

**Normalizers** (`normalizers/`): Data normalization logic

-   `ingredient-normalizer.ts` - Normalizes ingredient names for matching

**Matchers** (`matchers/`): Matching and scoring logic

-   `food-matcher.ts` - Ranks candidates
-   `scoring.ts` - Calculates confidence scores

**Services** (`services/`): Business logic and external integrations

-   `recipe-intake-service.ts` - Orchestration
-   `notion-client.ts` - Notion API integration
-   `embedding-gateway.ts` - Embedding generation
-   `review-queue.ts` - Review queue management

**Scrapers** (`scrapers/`): External data extraction

-   `schema-recipe-scraper.ts` - HTML scraping

### 2. Notion API v2025+ Pattern

**Data Sources for Reading**:

-   Uses `client.dataSources.query()` for fetching food lookup
-   More efficient and aligned with Notion's latest API
-   Supports synced databases and views

**Database IDs for Writing**:

-   Resolves database ID from data source automatically
-   Caches resolved IDs for performance
-   Only requires data source IDs in configuration

**Duplicate Prevention**:

-   Recipes: Checks by `sourceUrl` before creating
-   Foods: Checks by `name` before creating
-   Returns existing ID if duplicate found

**Review Workflow**:

-   New foods created with `Reviewed=false`
-   Only reviewed foods (`Reviewed=true`) included in lookup
-   Prevents data pollution while allowing manual review

### 3. Multi-Tiered Matching System

**Deterministic Matching** (always available):

-   Exact name, alias, token overlap, prefix, fuzzy similarity
-   Fast and reliable for common cases

**Semantic Matching** (optional):

-   Embedding-based similarity via OpenAI + Pinecone
-   Improves accuracy for synonyms and variations
-   Gracefully degrades if not configured

**Confidence Thresholds**:

-   Configurable via environment variables
-   Defaults: 85 (auto-match), 60 (probable)
-   Perfect token matches auto-match even at 80%

### 4. Error Handling Strategy

**Graceful Degradation**:

-   Embedding failures don't block matching
-   Missing Notion configuration returns empty lookup
-   Invalid ingredient parsing returns partial data

**Logging Levels**:

-   `trace`: Detailed debugging (data source resolution, filtering)
-   `debug`: Important state changes (resolved IDs, batch sizes)
-   `info`: High-level operations (created entries, found duplicates)
-   `warn`: Recoverable errors (failed resolutions, missing properties)
-   `error`: Critical failures (API errors, validation failures)

### 5. Caching Strategy

**In-Memory Caching**:

-   Embedding cache during request processing
-   Data source/database ID resolution caching
-   Prevents redundant API calls

**Pinecone Caching**:

-   Food embeddings stored in Pinecone
-   Reduces OpenAI API calls
-   Falls back to fresh embedding if Pinecone fails

---

## Dependencies

### Runtime Dependencies

-   **`@notionhq/client`** (^5.4.0): Notion API client
-   **`@pinecone-database/pinecone`** (^6.1.3): Pinecone vector database client
-   **`cheerio`** (^1.1.2): HTML parsing and manipulation
-   **`openai`** (^6.9.1): OpenAI API client for embeddings
-   **`zod`** (^4.1.12): Schema validation

### Development Dependencies

-   **`@biomejs/biome`** (2.3.4): Linter and formatter
-   **`@types/bun`**: Bun type definitions
-   **`@types/cheerio`**: Cheerio type definitions
-   **`husky`** (^9.1.7): Git hooks
-   **`ultracite`** (6.3.2): Code formatting

### Runtime

-   **Bun** (latest): JavaScript runtime and package manager

---

## Configuration

### Environment Variables

| Variable                            | Description                                                        | Required | Default                  |
| ----------------------------------- | ------------------------------------------------------------------ | -------- | ------------------------ |
| `PORT`                              | HTTP server port                                                   | No       | Bun default              |
| `LOG_LEVEL`                         | Logging level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) | No       | `info`                   |
| `NOTION_API_TOKEN`                  | Notion integration token                                           | Yes\*    | -                        |
| `NOTION_RECIPES_DATA_SOURCE_ID`     | Recipes data source ID                                             | Yes\*\*  | -                        |
| `NOTION_INGREDIENTS_DATA_SOURCE_ID` | Ingredients data source ID                                         | Yes\*\*  | -                        |
| `NOTION_FOOD_DATA_SOURCE_ID`        | Food lookup data source ID                                         | Yes\*    | -                        |
| `MATCH_HARD_THRESHOLD`              | Auto-match confidence threshold                                    | No       | `85`                     |
| `MATCH_SOFT_THRESHOLD`              | Probable-match threshold                                           | No       | `60`                     |
| `OPENAI_API_KEY`                    | OpenAI API key                                                     | No       | -                        |
| `OPENAI_EMBED_MODEL`                | OpenAI embedding model                                             | No       | `text-embedding-3-small` |
| `PINECONE_API_KEY`                  | Pinecone API key                                                   | No       | -                        |
| `PINECONE_INDEX`                    | Pinecone index name or host URL                                    | No       | -                        |
| `PINECONE_INDEX_HOST`               | Pinecone index host URL                                            | No       | -                        |
| `PINECONE_INDEX_NAME`               | Pinecone index name                                                | No       | -                        |
| `PINECONE_NAMESPACE`                | Pinecone namespace                                                 | No       | -                        |

\* Required for Notion features (food lookup or persistence) \*\* Required when `persistToNotion=true`

### Notion Database Schema

**Recipes Database**:

-   `Name` (title): Recipe name
-   `Source URL` (url): Original recipe URL
-   `Servings` (number): Number of servings
-   `Instructions` (rich_text): Recipe instructions
-   `Time` (select): Formatted time (e.g., "30 min", "1 h 30 min")
-   `Meal` (multi_select): Meal categories
-   `Cover Image` (files): Recipe cover image
-   `Tags` (multi_select): Recipe tags

**Ingredients Database**:

-   `Recipe` (relation): Link to recipe
-   `Food` (relation): Link to food lookup item
-   `Name` (title): Ingredient name
-   `Qty` (number): Quantity
-   `Unit` (select): Unit of measurement

**Food Lookup Database**:

-   `Name` (title): Food name
-   `Aliases` (rich_text): Comma-separated aliases
-   `Reviewed` (checkbox): Whether item has been reviewed

---

## Testing Strategy

### Test Structure

Tests mirror source structure:

```
tests/
├── matchers/
│   └── food-matcher.test.ts
├── parsers/
│   └── ingredient-parser.test.ts
├── routes/
│   └── scrape-recipe.test.ts
├── scrapers/
│   └── schema-recipe-scraper.test.ts
└── services/
    └── recipe-intake-service.test.ts
```

### Test Runner

-   **Bun Test**: Built-in test runner
-   **Coverage**: `bun test --coverage`
-   **Watch Mode**: `bun test --watch`

### Test Patterns

-   Unit tests for parsers, normalizers, matchers
-   Integration tests for services
-   Mock external APIs (Notion, OpenAI, Pinecone)

---

## Deployment

### Build

```bash
bun run build
```

Output: `dist/index.js`

### Run

```bash
bun run start
```

### Development

```bash
bun run dev  # Watch mode
```

### Health Check

```bash
curl http://localhost:3000/health
```

### Example Request

```bash
curl -X POST http://localhost:3000/scrape-recipe \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/recipe",
    "persistToNotion": true
  }'
```

---

## Future Enhancements

### Potential Improvements

1. **Review Queue Persistence**: Implement Notion database gateway for review queue
2. **Batch Processing**: Support multiple recipe URLs in single request
3. **Rate Limiting**: Add rate limiting for external API calls
4. **Caching**: Add Redis caching for food lookup
5. **Metrics**: Add Prometheus metrics endpoint
6. **Webhooks**: Support Notion webhooks for review queue updates
7. **Multi-language**: Support non-English recipe sites
8. **Custom Scrapers**: Fallback scrapers for sites without schema.org markup

---

## References

-   [Notion API v2025+ Best Practices](./.cursor/rules/notion-api-v2025-best-practices.mdc)
-   [Project Specification](./SPEC.md)
-   [README](../README.md)
