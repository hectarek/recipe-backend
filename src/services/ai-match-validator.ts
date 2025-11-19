/**
 * AI Match Validator - Optional AI-powered validation for food matches
 *
 * Uses LLM to validate matches before auto-matching, catching edge cases
 * that rule-based systems might miss.
 *
 * This is an optional enhancement - can be enabled via environment variable
 * or passed as an option to the recipe intake service.
 */

import { logger } from "../logger.js";
import type { FoodMatchCandidate, ParsedIngredient } from "../types.js";

export type AiMatchValidatorOptions = {
  apiKey?: string;
  model?: string;
  enabled?: boolean;
  baseUrl?: string;
};

export type AiValidationResult = {
  isValid: boolean;
  confidence: number; // 0-1
  reason?: string;
  suggestion?: string;
};

/**
 * Validates a match using AI
 * Returns null if AI validation is disabled or fails
 */
export const validateMatchWithAi = async (
  ingredient: ParsedIngredient,
  candidate: FoodMatchCandidate,
  options: AiMatchValidatorOptions = {}
): Promise<AiValidationResult | null> => {
  const enabled =
    options.enabled ?? process.env.AI_MATCH_VALIDATION_ENABLED === "true";
  if (!enabled) {
    return null;
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.debug("AI match validation enabled but no API key provided");
    return null;
  }

  const model =
    options.model ?? process.env.AI_MATCH_VALIDATION_MODEL ?? "gpt-4o-mini";
  const baseUrl =
    options.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `You are a food matching validator. Your job is to determine if an ingredient name correctly matches a food item.

Rules:
- "salt" should NOT match "Salted Butter" (salt is a modifier)
- "pepper" should NOT match "Bell Peppers" (pepper alone refers to spice)
- "butter" should NOT match "Peanut Butter" (butter alone refers to dairy)
- Single-word ingredients matching multi-word foods need careful validation
- Consider context: modifiers like "salted", "ground", "chopped" are part of the food name, not separate foods

Respond with JSON only:
{
  "isValid": boolean,
  "confidence": number (0-1),
  "reason": "brief explanation",
  "suggestion": "alternative match if invalid" (optional)
}`,
          },
          {
            role: "user",
            content: `Ingredient: "${ingredient.name}"
Food Candidate: "${candidate.food.name}"
Match Confidence: ${candidate.confidence}%
Match Reasons: ${candidate.reasons.map((r) => `${r.type} (${r.score})`).join(", ")}`,
          },
        ],
        temperature: 0.1, // Low temperature for consistent validation
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(
        { status: response.status, error: errorText },
        "AI match validation API error"
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    const result = JSON.parse(content) as AiValidationResult;
    return result;
  } catch (error) {
    logger.debug(
      {
        err: error instanceof Error ? error.message : error,
        ingredient: ingredient.name,
        candidate: candidate.food.name,
      },
      "AI match validation failed, falling back to rule-based validation"
    );
    return null;
  }
};

/**
 * Validates aliases using AI to catch problematic ones
 */
export const validateAliasesWithAi = async (
  foodName: string,
  aliases: string[],
  options: AiMatchValidatorOptions = {}
): Promise<{ valid: string[]; rejected: string[] }> => {
  const enabled =
    options.enabled ?? process.env.AI_MATCH_VALIDATION_ENABLED === "true";
  if (!enabled || aliases.length === 0) {
    return { valid: aliases, rejected: [] };
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { valid: aliases, rejected: [] };
  }

  const model =
    options.model ??
    process.env.AI_MATCH_VALIDATION_MODEL ??
    "gpt-5-nano-2025-08-07";
  const baseUrl =
    options.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `You are an alias validator. Determine which aliases are valid for a food item.

Rules:
- Modifiers like "salt", "pepper", "ground" should NOT be aliases
- "salt" is NOT a valid alias for "Salted Butter"
- Only include aliases that are actual alternative names for the food, not modifiers

Respond with JSON:
{
  "valid": ["alias1", "alias2"],
  "rejected": ["bad_alias1"],
  "reasons": {"bad_alias1": "reason"}
}`,
          },
          {
            role: "user",
            content: `Food Name: "${foodName}"
Proposed Aliases: ${JSON.stringify(aliases)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return { valid: aliases, rejected: [] };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { valid: aliases, rejected: [] };
    }

    const result = JSON.parse(content) as {
      valid?: string[];
      rejected?: string[];
      reasons?: Record<string, string>;
    };

    return {
      valid: result.valid ?? aliases,
      rejected: result.rejected ?? [],
    };
  } catch (error) {
    logger.debug(
      { err: error instanceof Error ? error.message : error },
      "AI alias validation failed, using all aliases"
    );
    return { valid: aliases, rejected: [] };
  }
};
