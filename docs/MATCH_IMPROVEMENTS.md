# Food Matching Improvements & Gotcha Prevention

## Problem

When matching ingredients to foods, common issues occur:

-   **"salt"** incorrectly matches **"Salted Butter"** (salt is a modifier, not the food)
-   **"butter"** incorrectly matches **"Peanut Butter"** (butter alone refers to dairy)
-   Modifiers from compound names get extracted as aliases, causing future incorrect matches

## Solutions Implemented

### 1. **Gotcha Pattern Detection** ✅ (Implemented)

**Location**: `src/matchers/match-gotchas.ts`

A centralized module that captures known problematic patterns:

```typescript
// Prevents "salt" from matching "Salted Butter"
PROBLEMATIC_SINGLE_WORD_PATTERNS = [
	{ ingredient: "salt", excludes: ["butter", "pepper"] },
	{ ingredient: "pepper", excludes: ["bell", "red", "green"] },
	// ... more patterns
];
```

**Benefits**:

-   Centralized place to add new gotchas
-   Easy to maintain and extend
-   Prevents matches before they happen

**Usage**: Automatically checked in `categorizeMatch()` function

### 2. **Modifier Word Filtering** ✅ (Implemented)

**Location**: `src/utils/food-name-formatter.ts`

Filters out modifier words from aliases:

```typescript
MODIFIER_WORDS = ["salted", "unsalted", "ground", "salt", "pepper", ...]
```

**Benefits**:

-   Prevents "salt" from being extracted as an alias for "Salted Butter"
-   Stops problematic aliases at the source
-   Reduces future incorrect matches

### 3. **AI-Powered Validation** 🔧 (Optional)

**Location**: `src/services/ai-match-validator.ts`

Uses LLM to validate matches before auto-matching:

**Enable via environment variables**:

```bash
AI_MATCH_VALIDATION_ENABLED=true
OPENAI_API_KEY=your_key
AI_MATCH_VALIDATION_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini
```

**Benefits**:

-   Catches edge cases rule-based systems miss
-   Learns from context
-   Can suggest better matches

**Drawbacks**:

-   Requires API key and costs money
-   Adds latency
-   May have false positives/negatives

**When to use**:

-   High-stakes matching scenarios
-   When you have budget for API calls
-   When rule-based system isn't catching enough edge cases

### 4. **Feedback/Learning System** 📋 (Future Enhancement)

**Proposed**: Track incorrect matches and learn from them

**Implementation ideas**:

1. **Notion-based feedback**: Add a "Match Feedback" database
    - When user corrects a match, record it
    - Use corrections to improve gotcha patterns
2. **Log analysis**: Parse logs for rejected matches

    - Identify patterns in `checkProblematicMatch` rejections
    - Auto-generate new gotcha patterns

3. **Confidence adjustment**: Learn from corrections
    - If a match is frequently corrected, lower its confidence threshold
    - If a match is rarely corrected, raise its threshold

## Adding New Gotchas

### Quick Add (Rule-Based)

1. **Add to `match-gotchas.ts`**:

```typescript
PROBLEMATIC_SINGLE_WORD_PATTERNS.push({
	ingredient: "your_word",
	excludes: ["problematic", "matches"],
	reason: "Why this is problematic",
});
```

2. **Add modifier words**:

```typescript
MODIFIER_WORDS.add("your_modifier");
```

### Using AI to Discover Gotchas

1. Enable AI validation
2. Review logs for rejected matches
3. Add patterns to `match-gotchas.ts` based on AI feedback

## Configuration Options

### Environment Variables

```bash
# Enable AI validation (optional)
AI_MATCH_VALIDATION_ENABLED=true
OPENAI_API_KEY=sk-...
AI_MATCH_VALIDATION_MODEL=gpt-4o-mini

# Match thresholds (existing)
MATCH_HARD_THRESHOLD=90
MATCH_SOFT_THRESHOLD=70
```

### Code-Level Options

```typescript
import { handleRecipeUrl } from "./services/recipe-intake-service.js";
import { validateMatchWithAi } from "./services/ai-match-validator.js";

// In your matching logic, add AI validation:
const aiResult = await validateMatchWithAi(ingredient, candidate, {
	enabled: true,
	apiKey: process.env.OPENAI_API_KEY,
});

if (aiResult && !aiResult.isValid) {
	// Reject match based on AI feedback
}
```

## Monitoring & Debugging

### Logs to Watch

1. **Gotcha detection**:

    ```
    "Rejecting match: known problematic pattern detected"
    ```

2. **AI validation**:

    ```
    "AI match validation failed, falling back to rule-based validation"
    ```

3. **Alias filtering**: Check `extractAliases` logs for filtered modifiers

### Metrics to Track

-   Number of gotcha rejections per pattern
-   AI validation accuracy (if enabled)
-   False positive/negative rates
-   Most common problematic patterns

## Best Practices

1. **Start with rule-based gotchas** - Fast, free, reliable
2. **Add AI validation for edge cases** - When rules aren't enough
3. **Monitor and iterate** - Review logs regularly, add new patterns
4. **Test thoroughly** - Verify gotchas don't break valid matches
5. **Document patterns** - Add comments explaining why each gotcha exists

## Example: Fixing "Salt" → "Salted Butter"

**Before**:

-   "salt" matches "Salted Butter" via alias match
-   "salt" gets extracted as alias for "Butter"
-   Future "salt" ingredients incorrectly match "Butter"

**After**:

1. ✅ Gotcha pattern rejects "salt" → "Salted Butter"
2. ✅ Modifier filter prevents "salt" from being alias
3. ✅ AI validation (if enabled) double-checks the match

## Future Enhancements

-   [ ] Machine learning model trained on corrections
-   [ ] Automatic gotcha pattern generation from logs
-   [ ] User feedback integration (Notion-based)
-   [ ] Confidence score adjustment based on corrections
-   [ ] Embedding-based gotcha detection
