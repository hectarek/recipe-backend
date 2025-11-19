import {
  HOURS_TEXT_REGEX,
  ISO_DATE_COMPONENT_REGEX,
  ISO_DATE_DESIGNATOR_MULTIPLIERS,
  ISO_DATE_TIME_SEPARATOR_REGEX,
  ISO_TIME_COMPONENT_REGEX,
  ISO_TIME_DESIGNATOR_MULTIPLIERS,
  MINUTES_TEXT_REGEX,
  NUMERIC_DURATION_REGEX,
  SERVINGS_NUMBER_REGEX,
} from "../const.js";
import type { ScrapedRecipe } from "../types.js";

/**
 * Parses recipe yield/servings from various formats (number or string).
 * Extracts numeric value from strings like "4 servings" or "Serves 6".
 */
export const parseServings = (value: ScrapedRecipe["yield"]): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const match = value.match(SERVINGS_NUMBER_REGEX);
    if (match?.[1]) {
      const parsed = Number.parseFloat(match[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
};

/**
 * Parses ISO 8601-like duration strings (e.g., "PT30M", "P1DT2H30M") into minutes.
 */
const parseIsoLikeDurationMinutes = (value: string): number | null => {
  if (!value || (value[0] !== "P" && value[0] !== "p")) {
    return null;
  }

  const [datePartRaw, timePartRaw] = value
    .slice(1)
    .split(ISO_DATE_TIME_SEPARATOR_REGEX);
  let minutes = 0;
  let hasComponent = false;

  const accumulate = (
    segment: string | undefined,
    regex: RegExp,
    multipliers: Record<string, number>
  ) => {
    if (!segment) {
      return;
    }

    for (const match of segment.matchAll(regex)) {
      const amount = Number.parseFloat(match[1] ?? "");
      const designator = (match[2] ?? "").toUpperCase();
      const multiplier = multipliers[designator];
      if (!Number.isFinite(amount) || multiplier === undefined) {
        continue;
      }
      minutes += amount * multiplier;
      hasComponent = true;
    }
  };

  accumulate(
    datePartRaw,
    ISO_DATE_COMPONENT_REGEX,
    ISO_DATE_DESIGNATOR_MULTIPLIERS
  );
  accumulate(
    timePartRaw,
    ISO_TIME_COMPONENT_REGEX,
    ISO_TIME_DESIGNATOR_MULTIPLIERS
  );

  if (!hasComponent) {
    return null;
  }

  const rounded = Math.round(minutes);
  return Number.isFinite(rounded) ? rounded : null;
};

/**
 * Parses text-based duration strings (e.g., "30 minutes", "1 hour 30 minutes") into minutes.
 */
const parseTextDurationMinutes = (value: string): number | null => {
  const hoursMatch = value.match(HOURS_TEXT_REGEX);
  const minutesMatch = value.match(MINUTES_TEXT_REGEX);

  let total = 0;

  if (hoursMatch?.[1]) {
    total += Number.parseFloat(hoursMatch[1]) * 60;
  }

  if (minutesMatch?.[1]) {
    total += Number.parseFloat(minutesMatch[1]);
  }

  if (total > 0) {
    return Math.round(total);
  }

  return null;
};

/**
 * Parses duration strings in various formats (ISO, text, or numeric) into minutes.
 */
export const parseDurationMinutes = (
  value: string | undefined
): number | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoMinutes = parseIsoLikeDurationMinutes(trimmed);
  if (isoMinutes !== null) {
    return isoMinutes;
  }

  const textMinutes = parseTextDurationMinutes(trimmed);
  if (textMinutes !== null) {
    return textMinutes;
  }

  if (NUMERIC_DURATION_REGEX.test(trimmed)) {
    const numeric = Number.parseFloat(trimmed);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
  }

  return null;
};

/**
 * Formats minutes into a human-readable label (e.g., "30 min", "1 h 30 min").
 */
export const formatMinutesLabel = (minutes: number): string => {
  const positiveMinutes = Math.max(0, Math.round(minutes));
  if (positiveMinutes === 0) {
    return "Under 1 min";
  }

  if (positiveMinutes < 60) {
    return `${positiveMinutes} min`;
  }

  const hours = Math.floor(positiveMinutes / 60);
  const remainder = positiveMinutes % 60;

  if (remainder === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${remainder} min`;
};

/**
 * Computes total time in minutes from a recipe time object.
 * Tries total first, then prep + cook, then individual values.
 */
export const computeTimeMinutes = (
  time: ScrapedRecipe["time"] | undefined
): { minutes: number | null; fallback?: string } => {
  if (!time) {
    return { minutes: null, fallback: undefined };
  }

  const totalMinutes = parseDurationMinutes(time.total);
  if (totalMinutes !== null) {
    return { minutes: totalMinutes };
  }

  const prepMinutes = parseDurationMinutes(time.prep);
  const cookMinutes = parseDurationMinutes(time.cook);

  const combined = (prepMinutes ?? 0) + (cookMinutes ?? 0);
  if (combined > 0) {
    return { minutes: combined };
  }

  if (prepMinutes !== null) {
    return { minutes: prepMinutes };
  }

  if (cookMinutes !== null) {
    return { minutes: cookMinutes };
  }

  return {
    minutes: null,
    fallback: time.total ?? time.prep ?? time.cook ?? undefined,
  };
};

/**
 * Formats recipe time into a human-readable string.
 * Returns formatted minutes if available, otherwise falls back to raw string.
 */
export const formatRecipeTime = (
  time: ScrapedRecipe["time"] | undefined
): string | null => {
  const { minutes, fallback } = computeTimeMinutes(time);

  if (minutes !== null) {
    return formatMinutesLabel(minutes);
  }

  if (!fallback) {
    return null;
  }

  const fallbackMinutes = parseDurationMinutes(fallback);
  if (fallbackMinutes !== null) {
    return formatMinutesLabel(fallbackMinutes);
  }

  const trimmed = fallback.trim();
  return trimmed || null;
};
