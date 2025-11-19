/**
 * Match Gotchas - Common problematic patterns in food matching
 *
 * This module captures known issues where ingredients incorrectly match foods,
 * allowing us to prevent these matches and learn from them.
 */

import type { FoodMatchCandidate, ParsedIngredient } from "../types.js";

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
]);

/**
 * Problematic match patterns where a single word ingredient incorrectly matches
 * a multi-word food because the word appears as a modifier
 */
const PROBLEMATIC_SINGLE_WORD_PATTERNS = [
  {
    ingredient: "salt",
    excludes: ["butter", "pepper"], // "salt" shouldn't match "Salted Butter" or "Salt & Pepper"
    reason: "Salt is a modifier in compound foods, not the food itself",
  },
  {
    ingredient: "pepper",
    excludes: ["bell", "red", "green", "yellow", "orange", "black", "white"],
    reason: "Pepper alone refers to spice, not bell peppers",
  },
  {
    ingredient: "stock",
    excludes: ["ground", "beef", "chicken", "pork", "vegetable"],
    reason: "Stock refers to broth, not ground meat stock",
  },
  {
    ingredient: "leaf",
    excludes: ["lettuce", "cabbage", "spinach"],
    reason: "Leaf is a descriptor, not a food name",
  },
  {
    ingredient: "ground",
    excludes: ["beef", "turkey", "chicken", "pork"],
    reason: "Ground is a preparation method, not a food",
  },
  {
    ingredient: "butter",
    excludes: ["peanut", "almond", "cashew"], // "butter" shouldn't match "Peanut Butter"
    reason: "Butter alone refers to dairy butter, not nut butters",
  },
];

/**
 * Semantic mismatches where ingredient words match but meaning is wrong
 */
const SEMANTIC_MISMATCHES = [
  {
    ingredient: ["beef", "stock"],
    excludes: ["ground", "steak", "roast"],
    reason: "Beef stock is broth, not ground beef",
  },
  {
    ingredient: ["bay", "leaf"],
    excludes: ["lettuce"],
    reason: "Bay leaf is a spice, not lettuce",
  },
  {
    ingredient: ["thyme", "leaf"],
    excludes: ["lettuce"],
    reason: "Thyme leaf is an herb, not lettuce",
  },
  {
    ingredient: ["chicken", "stock"],
    excludes: ["breast", "thigh", "wing"],
    reason: "Chicken stock is broth, not chicken parts",
  },
];

const WORD_SPLIT_REGEX = /\s+/;

/**
 * Checks if a word is a modifier that shouldn't be used as an alias
 */
export const isModifierWord = (word: string): boolean =>
  MODIFIER_WORDS.has(word.toLowerCase().trim());

/**
 * Filters out modifier words from potential aliases
 */
export const filterModifierAliases = (aliases: string[]): string[] => {
  return aliases.filter((alias) => {
    const words = alias.toLowerCase().split(WORD_SPLIT_REGEX);
    // Reject aliases that are single modifier words
    if (words.length === 1 && isModifierWord(words[0] ?? "")) {
      return false;
    }
    // Reject aliases that start with modifier words (likely compound names)
    if (words.length > 1 && isModifierWord(words[0] ?? "")) {
      return false;
    }
    return true;
  });
};

/**
 * Checks if a match violates known problematic patterns
 */
export const checkProblematicMatch = (
  ingredient: ParsedIngredient,
  candidate: FoodMatchCandidate
): {
  isProblematic: boolean;
  reason?: string;
  pattern?: string;
} => {
  const ingredientName = ingredient.name.toLowerCase().trim();
  const candidateName = candidate.food.name.toLowerCase().trim();
  const ingredientWords = ingredientName
    .split(WORD_SPLIT_REGEX)
    .filter(Boolean);

  // Check single-word problematic patterns
  if (ingredientWords.length === 1) {
    const singleWord = ingredientWords[0] ?? "";
    for (const pattern of PROBLEMATIC_SINGLE_WORD_PATTERNS) {
      if (
        singleWord === pattern.ingredient &&
        pattern.excludes.some((exclude) => candidateName.includes(exclude))
      ) {
        return {
          isProblematic: true,
          reason: pattern.reason,
          pattern: `${pattern.ingredient} -> ${candidateName}`,
        };
      }
    }
  }

  // Check semantic mismatches
  for (const mismatch of SEMANTIC_MISMATCHES) {
    if (
      mismatch.ingredient.every((word) => ingredientName.includes(word)) &&
      mismatch.excludes.some((exclude) => candidateName.includes(exclude))
    ) {
      return {
        isProblematic: true,
        reason: mismatch.reason,
        pattern: `${ingredientName} -> ${candidateName}`,
      };
    }
  }

  return { isProblematic: false };
};

/**
 * Validates aliases to ensure they're not modifiers
 * Returns filtered aliases and any that were rejected
 */
export const validateAliases = (
  aliases: string[]
): {
  valid: string[];
  rejected: string[];
  reasons: Record<string, string>;
} => {
  const valid: string[] = [];
  const rejected: string[] = [];
  const reasons: Record<string, string> = {};

  for (const alias of aliases) {
    const words = alias.toLowerCase().split(WORD_SPLIT_REGEX).filter(Boolean);

    // Reject single-word modifiers
    if (words.length === 1 && isModifierWord(words[0] ?? "")) {
      rejected.push(alias);
      reasons[alias] = `Single-word modifier: ${words[0]}`;
      continue;
    }

    // Reject aliases that start with modifiers (compound names)
    if (words.length > 1 && isModifierWord(words[0] ?? "")) {
      rejected.push(alias);
      reasons[alias] = `Starts with modifier: ${words[0]}`;
      continue;
    }

    valid.push(alias);
  }

  return { valid, rejected, reasons };
};
