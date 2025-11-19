# Food Name Formatting & USDA Integration Plan

## Overview

This document outlines the improvements made to food name formatting and USDA API integration for unmatched ingredients when adding them to the food lookup table.

## Analysis of Python Scripts

### Key Insights from `extract_food_lookup.py`:

1. **`clean_food_name()` function**:
    - Strips leading/trailing whitespace
    - Removes surrounding quotes/apostrophes
    - Collapses consecutive whitespace to single space
    - Handles empty/NaN values gracefully

### Key Insights from `split_food_names.py`:

1. **`title_case()` function**:

    - Smart capitalization preserving acronyms (uppercase if <= 4 chars)
    - Handles separators (hyphens, slashes) correctly
    - Preserves whitespace structure

2. **`heuristic_split()` function**:

    - Splits food descriptions into base name and detail
    - Uses comma-separated segments
    - Identifies "detail starters" (cooking methods, preparation states)
    - Handles complex cases with multiple segments

3. **Detail Starters**:
    - Cooking methods: raw, cooked, roasted, baked, grilled, fried, etc.
    - Preparation states: frozen, canned, dried, powdered, ground, etc.
    - Modifiers: with, without, salted, unsalted, etc.

## Implementation Plan

### Phase 1: Food Name Formatter ✅

**File**: `src/utils/food-name-formatter.ts`

**Features**:

-   `formatFoodName()`: Main formatting function
    -   Cleans HTML entities (`&amp;` → `&`)
    -   Normalizes whitespace
    -   Applies title case capitalization
-   `titleCase()`: Smart capitalization
    -   Preserves acronyms (e.g., "USDA", "FDC")
    -   Handles separators correctly
-   `extractAliases()`: Extracts aliases from normalized tokens
    -   Only returns aliases that differ from formatted name

**Example Transformations**:

-   `"salt &amp; pepper"` → `"Salt & Pepper"`
-   `"worcestershire sauce"` → `"Worcestershire Sauce"`
-   `"stewing beef"` → `"Stewing Beef"`
-   `"rib celery piec"` → `"Rib Celery Piec"` (preserves as-is, will be cleaned by normalization)

### Phase 2: USDA API Client ✅

**File**: `src/services/usda-api-client.ts`

**Features**:

-   `UsdaApiClient` class
-   `searchFoods()`: Search USDA FoodData Central API
-   `findBestMatch()`: Get best matching food item
-   Gracefully handles missing API key (optional feature)
-   Focuses on "Foundation" and "SR Legacy" data types (standard foods)

**Configuration**:

-   Set `USDA_API_KEY` environment variable to enable
-   If not set, client silently skips USDA lookups

**API Endpoint**: `https://api.nal.usda.gov/fdc/v1/foods/search`

### Phase 3: Enhanced Unmatched Ingredient Processing ✅

**File**: `src/services/recipe-intake-service.ts`

**Changes**:

-   Updated `persistUnmatchedToFoodLookup()` to:
    1. Format food names using `formatFoodName()`
    2. Optionally query USDA API for matches
    3. Extract aliases using `extractAliases()`
    4. Log USDA matches for future reference

**Flow**:

```
Unmatched Ingredient
  ↓
Format Name (clean HTML entities, title case)
  ↓
Query USDA API (optional, if API key configured)
  ↓
Extract Aliases from normalized tokens
  ↓
Create Food Entry in Notion (with Reviewed=false)
```

## Usage

### Basic Usage (No USDA API)

The formatter works automatically when `persistToNotion=true`:

```typescript
// Ingredient: "salt &amp; pepper"
// Formatted: "Salt & Pepper"
// Created in Notion with Reviewed=false
```

### With USDA API

Set environment variable:

```bash
USDA_API_KEY=your_api_key_here
```

The system will:

1. Format the ingredient name
2. Query USDA API for potential matches
3. Log matches (for future enhancement to use USDA descriptions)
4. Create entry with formatted name

## Future Enhancements

### Potential Improvements:

1. **Use USDA Descriptions**: When USDA match found, use USDA description as primary name instead of formatted ingredient name
2. **Name/Detail Splitting**: Implement heuristic splitting similar to Python script to separate base name from preparation details
3. **USDA Metadata**: Store USDA FDC ID and other metadata in Notion for reference
4. **Confidence Scoring**: Use USDA match confidence to determine if USDA description should override formatted name
5. **Batch Processing**: Optimize USDA API calls by batching requests

## Testing

### Manual Testing Examples:

```typescript
// Test formatting
formatFoodName("salt &amp; pepper"); // → "Salt & Pepper"
formatFoodName("worcestershire sauce"); // → "Worcestershire Sauce"
formatFoodName("stewing beef"); // → "Stewing Beef"

// Test USDA lookup (requires API key)
const client = new UsdaApiClient();
const match = await client.findBestMatch("Beef");
// Returns: { fdcId: 174032, description: "Beef, ground, 93% lean meat / 7% fat, raw", ... }
```

## Notes

-   The USDA API integration is **optional** - system works fine without it
-   Food names are always formatted, regardless of USDA API availability
-   USDA matches are logged but not yet used to override formatted names (future enhancement)
-   All unmatched ingredients are created with `Reviewed=false` for manual review
