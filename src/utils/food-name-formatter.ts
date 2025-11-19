/**
 * Food Name Formatter
 *
 * Formats ingredient names for food lookup table entries.
 * Based on heuristics from USDA data processing scripts.
 */

// Regex patterns defined at module level for performance
const HTML_ENTITY_REGEXES = {
  amp: /&amp;/g,
  lt: /&lt;/g,
  gt: /&gt;/g,
  quot: /&quot;/g,
  apos: /&#39;/g,
  nbsp: /&nbsp;/g,
} as const;

const QUOTE_STRIP_REGEX = /^["']|["']$/g;
const WHITESPACE_COLLAPSE_REGEX = /\s+/g;
const ACRONYM_REGEX = /^[A-Z]+$/;
const SEPARATOR_REGEX = /^\s+$/;
const SPLIT_REGEX = /(\s+|[-/])/;
const WORD_SPLIT_REGEX = /\s+/;
const SEGMENT_SPLIT_REGEX = /\s+/;

// Unit-like words that should be removed or handled specially
const UNIT_LIKE_WORDS = new Set([
  "rib",
  "ribs",
  "piece",
  "pieces",
  "piec", // truncated form
  "stalk",
  "stalks",
  "head",
  "heads",
  "bulb",
  "bulbs",
  "clove",
  "cloves",
  "leaf",
  "leaves",
]);

// Words that indicate the word before them is the actual food name
const FOOD_INDICATORS = new Set([
  "celery",
  "onion",
  "garlic",
  "lettuce",
  "cabbage",
  "broccoli",
  "cauliflower",
]);

// Words that should be removed before USDA search (HTML entity artifacts, conjunctions, etc.)
const USDA_SEARCH_STOP_WORDS = new Set([
  "amp", // from &amp;
  "and",
  "or",
  "with",
  "without",
  "plus",
  "minus",
]);

// Words that indicate compound ingredients (should skip USDA lookup or split)
const COMPOUND_INDICATORS = new Set(["&", "and", "or", "plus", "/"]);

/**
 * Cleans HTML entities and normalizes whitespace
 */
const cleanText = (text: string): string => {
  // Decode common HTML entities
  let decoded = text;
  decoded = decoded.replace(HTML_ENTITY_REGEXES.amp, "&");
  decoded = decoded.replace(HTML_ENTITY_REGEXES.lt, "<");
  decoded = decoded.replace(HTML_ENTITY_REGEXES.gt, ">");
  decoded = decoded.replace(HTML_ENTITY_REGEXES.quot, '"');
  decoded = decoded.replace(HTML_ENTITY_REGEXES.apos, "'");
  decoded = decoded.replace(HTML_ENTITY_REGEXES.nbsp, " ");

  // Trim leading/trailing whitespace and surrounding quotes/apostrophes
  let cleaned = decoded.trim().replace(QUOTE_STRIP_REGEX, "").trim();

  // Collapse consecutive internal whitespace to a single space
  cleaned = cleaned.replace(WHITESPACE_COLLAPSE_REGEX, " ");

  return cleaned;
};

/**
 * Smart capitalization that preserves acronyms (uppercase if <= 4 chars)
 */
const smartCapitalize = (word: string): string => {
  if (!word) {
    return "";
  }

  // Preserve acronyms (all uppercase, <= 4 characters)
  if (
    word.length <= 4 &&
    word === word.toUpperCase() &&
    ACRONYM_REGEX.test(word)
  ) {
    return word;
  }

  // Capitalize first letter, lowercase the rest
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

/**
 * Applies title case to text, preserving separators and acronyms
 */
export const titleCase = (text: string): string => {
  if (!text) {
    return "";
  }

  // Split on whitespace, hyphens, and slashes while preserving separators
  const parts = text.split(SPLIT_REGEX);

  const transformed: string[] = [];

  for (const part of parts) {
    if (!part) {
      continue;
    }

    // Preserve separators as-is
    if (SEPARATOR_REGEX.test(part) || part === "-" || part === "/") {
      transformed.push(part);
      continue;
    }

    // Apply smart capitalization
    transformed.push(smartCapitalize(part));
  }

  return transformed.join("").trim();
};

/**
 * Checks if a word should be skipped based on unit-like patterns
 */
const shouldSkipWord = (
  word: string,
  nextWord: string | undefined,
  foundFoodIndicator: boolean,
  hasFoodWords: boolean
): boolean => {
  // Skip unit-like words before food indicators
  if (UNIT_LIKE_WORDS.has(word) && nextWord && FOOD_INDICATORS.has(nextWord)) {
    return true;
  }

  // Skip unit-like words after food indicators
  if (UNIT_LIKE_WORDS.has(word) && foundFoodIndicator) {
    return true;
  }

  // Skip unit-like words at the start if no food words yet
  if (UNIT_LIKE_WORDS.has(word) && !hasFoodWords) {
    return true;
  }

  return false;
};

/**
 * Cleans up food name by removing unit-like words and improving structure
 */
const cleanFoodName = (name: string): string => {
  if (!name) {
    return "";
  }

  // Split into words
  const words = name.toLowerCase().split(WORD_SPLIT_REGEX).filter(Boolean);

  // If we have a pattern like "rib celery" or "rib celery piec", extract the food name
  // Look for food indicators and unit-like words
  const cleanedWords: string[] = [];
  let foundFoodIndicator = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const nextWord = words[i + 1];

    // Check if we should skip this word
    if (
      shouldSkipWord(
        word,
        nextWord,
        foundFoodIndicator,
        cleanedWords.length > 0
      )
    ) {
      continue;
    }

    // If current word is a food indicator, include it
    if (FOOD_INDICATORS.has(word)) {
      cleanedWords.push(word);
      foundFoodIndicator = true;
      continue;
    }

    // Include other words
    cleanedWords.push(word);
  }

  // If we ended up with nothing meaningful, return cleaned original
  if (cleanedWords.length === 0) {
    return cleanText(name);
  }

  return cleanedWords.join(" ");
};

/**
 * Formats a food name for entry into the food lookup table
 */
export const formatFoodName = (name: string): string => {
  if (!name) {
    return "";
  }

  // First clean HTML entities and normalize
  const cleaned = cleanText(name);

  // Then clean up unit-like words and improve structure
  const cleanedName = cleanFoodName(cleaned);

  // Finally apply title case
  return titleCase(cleanedName);
};

/**
 * Cleans name for USDA API search by removing stop words and artifacts
 */
export const cleanForUsdaSearch = (name: string): string => {
  if (!name) {
    return "";
  }

  // Remove HTML entity artifacts and stop words
  const words = name
    .toLowerCase()
    .split(WORD_SPLIT_REGEX)
    .filter((word) => {
      const trimmed = word.trim();
      return (
        trimmed && !USDA_SEARCH_STOP_WORDS.has(trimmed) && trimmed.length > 1 // Filter out single characters
      );
    });

  return words.join(" ").trim();
};

/**
 * Checks if ingredient name appears to be a compound ingredient (e.g., "salt & pepper")
 */
export const isCompoundIngredient = (name: string): boolean => {
  if (!name) {
    return false;
  }

  const lower = name.toLowerCase();

  // Check for compound indicators
  for (const indicator of COMPOUND_INDICATORS) {
    if (lower.includes(indicator)) {
      return true;
    }
  }

  // Check for multiple distinct food words (heuristic)
  const words = lower.split(WORD_SPLIT_REGEX).filter(Boolean);
  const foodWordCount = words.filter(
    (word) => FOOD_INDICATORS.has(word) || word.length > 4
  ).length;

  // If we have multiple distinct food-like words, likely compound
  return foodWordCount > 1;
};

/**
 * Detail starters that indicate the start of preparation/cooking details
 * Based on Python script heuristic_split logic
 */
const DETAIL_STARTERS = new Set([
  "raw",
  "cooked",
  "roasted",
  "baked",
  "grilled",
  "fried",
  "boiled",
  "steamed",
  "sauteed",
  "frozen",
  "canned",
  "dried",
  "powdered",
  "ground",
  "chopped",
  "diced",
  "sliced",
  "minced",
  "grated",
  "shredded",
  "whole",
  "halved",
  "quartered",
  "salted",
  "unsalted",
  "with",
  "without",
  "fresh",
  "freshly",
]);

/**
 * Splits a food description into name and details based on comma-separated segments
 * Example: "Almonds, raw, whole" -> { name: "Almonds", details: "raw, whole" }
 */
export const splitFoodNameAndDetails = (
  description: string
): { name: string; details: string | null } => {
  if (!description) {
    return { name: "", details: null };
  }

  // Split by comma and trim each segment
  const segments = description
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { name: description.trim(), details: null };
  }

  // First segment is always the base name
  const name = segments[0] ?? description.trim();

  // Find where details start (first segment that starts with a detail starter)
  let detailStartIndex = segments.length;
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i] ?? "";
    const firstWord =
      segment.split(SEGMENT_SPLIT_REGEX)[0]?.toLowerCase() ?? "";
    if (DETAIL_STARTERS.has(firstWord)) {
      detailStartIndex = i;
      break;
    }
  }

  // If we found detail starters, extract details
  if (detailStartIndex < segments.length) {
    const detailSegments = segments.slice(detailStartIndex);
    const details = detailSegments.join(", ");
    return { name, details };
  }

  // If no detail starters found but we have multiple segments,
  // treat everything after first as details
  if (segments.length > 1) {
    const detailSegments = segments.slice(1);
    const details = detailSegments.join(", ");
    return { name, details };
  }

  return { name, details: null };
};

/**
 * Words that are modifiers/adjectives and should NOT be used as aliases
 * These are typically part of compound names (e.g., "salted butter", "ground beef")
 */
const MODIFIER_WORDS = new Set([
  "salted",
  "unsalted",
  "ground",
  "whole",
  "chopped",
  "diced",
  "sliced",
  "minced",
  "grated",
  "shredded",
  "fresh",
  "frozen",
  "canned",
  "dried",
  "raw",
  "cooked",
  "roasted",
  "baked",
  "grilled",
  "fried",
  "boiled",
  "steamed",
  "sauteed",
  "powdered",
  "halved",
  "quartered",
  "black",
  "white",
  "red",
  "green",
  "yellow",
  "orange",
  "sweet",
  "sour",
  "hot",
  "mild",
  "spicy",
  "salt", // Common modifier that causes issues
  "pepper", // Common modifier that causes issues
]);

/**
 * Filters out modifier words from potential aliases
 */
const filterModifierAliases = (aliases: string[]): string[] => {
  return aliases.filter((alias) => {
    const words = alias.toLowerCase().split(WORD_SPLIT_REGEX);
    // Reject aliases that are single modifier words
    if (words.length === 1 && MODIFIER_WORDS.has(words[0] ?? "")) {
      return false;
    }
    // Reject aliases that start with modifier words (likely compound names)
    if (words.length > 1 && MODIFIER_WORDS.has(words[0] ?? "")) {
      return false;
    }
    return true;
  });
};

/**
 * Extracts potential aliases from normalized tokens
 * Returns aliases that differ from the formatted name
 * Filters out modifier words that shouldn't be aliases
 */
export const extractAliases = (
  formattedName: string,
  normalizedTokens?: string[]
): string[] | null => {
  if (!normalizedTokens || normalizedTokens.length === 0) {
    return null;
  }

  // Join tokens and format
  const tokenName = formatFoodName(normalizedTokens.join(" "));

  // Only return aliases if they differ from the formatted name
  if (tokenName.toLowerCase() !== formattedName.toLowerCase()) {
    const rawAliases = normalizedTokens.map((token) => formatFoodName(token));

    // Filter out modifier words (e.g., "salt" from "salted butter")
    const filtered = filterModifierAliases(rawAliases);
    return filtered.length > 0 ? filtered : null;
  }

  return null;
};
