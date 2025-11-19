# Notion Rollup and Formula Fixes

## Issue 1: Formula Errors - "Cannot use toNumber on a list"

### Problem

Formulas in the Ingredients table are failing with:

```
Cannot use toNumber on a list. Use first(), at(), or map() instead.
```

This happens because properties like "Protein / unit (g)" are **rollup properties** from the Food relation, and rollups return **lists** even when there's only one related item.

### Solution

Update all nutrition total formulas in Notion to use `first()` to extract a single value from rollup properties.

**Current (broken) formula:**

```
if(empty(prop("Qty")), 0, toNumber(prop("Qty")) * toNumber(prop("Protein / unit (g)")))
```

**Fixed formula:**

```
if(empty(prop("Qty")), 0, toNumber(prop("Qty")) * toNumber(first(prop("Protein / unit (g)"))))
```

### Formula Syntax Reference

-   `first(prop("Rollup Property"))` - Gets the first item from a list
-   `at(prop("Rollup Property"), 0)` - Gets item at index 0 (same as first)
-   `prop("Rollup Property").map(toNumber(current))` - Converts all items to numbers

### Properties to Fix

Apply `first()` to all nutrition rollup properties in your formulas:

-   `first(prop("Protein / unit (g)"))`
-   `first(prop("Carbs / unit (g)"))`
-   `first(prop("Fat / unit (g)"))`
-   `first(prop("Fiber / unit (g)"))`
-   `first(prop("Sugar / unit (g)"))`
-   ... and any other nutrition properties

### Example Fixed Formula

```
if(
  empty(prop("Qty")),
  0,
  toNumber(prop("Qty")) * toNumber(first(prop("Protein / unit (g)")))
)
```

## Issue 2: Rollup Not Updating on Recipe Page

### Problem

The recipe page's ingredient list rollup property is empty even though ingredients are correctly linked.

### Root Cause

Notion rollups update automatically when relations change, but there can be a delay. The code now:

1. Creates the recipe page
2. Creates all ingredient entries (with relations to recipe)
3. Waits 500ms for Notion to process relations
4. Refreshes the recipe page to trigger rollup recalculation

### How It Works

The `refreshRecipePage()` method:

-   Fetches the recipe page
-   Updates the recipe name property (to itself)
-   This triggers Notion to recalculate all rollups on the page

### If Rollups Still Don't Update

1. **Check Rollup Configuration in Notion:**

    - Verify the rollup property is correctly configured
    - Ensure it's pointing to the right relation property
    - Check that the rollup function is set correctly (e.g., "Show original" for a list)

2. **Verify Relations:**

    - Ingredients should have a "Recipe" relation property
    - Recipe should have an "Ingredients" relation property (bidirectional)
    - The rollup should reference the "Ingredients" relation

3. **Manual Refresh:**

    - Sometimes Notion needs a manual page refresh
    - Try navigating away and back to the recipe page
    - Or manually edit and save the recipe page

4. **Check Permissions:**
    - Ensure your API token has access to all databases
    - Verify the integration has proper permissions

### Code Implementation

The refresh happens automatically after creating ingredients:

```typescript
// After creating all ingredient entries
await this.refreshRecipePage(recipePageId); // Trigger rollup refresh
```

## References

-   [Notion Formula Syntax](https://www.notion.com/en-gb/help/formula-syntax)
-   [Notion Common Formula Errors](https://www.notion.com/help/common-formula-errors)
-   [Notion Relations & Rollups](https://www.notion.com/en-gb/help/relations-and-rollups)
