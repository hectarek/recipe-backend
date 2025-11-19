import { DESCRIPTORS } from "../const.js";

type NormalizationAccumulator = {
  working: string;
  descriptors: string[];
};

const PARENTHETICAL_REGEX = /\(([^)]+)\)/g;
const NON_ALPHANUMERIC_REGEX = /[^a-z0-9\s-]/gi;
const WHITESPACE_REGEX = /\s+/g;

const singularizeToken = (token: string): string => {
  const lower = token.toLowerCase();

  if (lower.length <= 3) {
    return lower;
  }

  if (lower.endsWith("ies")) {
    return `${lower.slice(0, -3)}y`;
  }

  if (lower.endsWith("ves")) {
    return `${lower.slice(0, -3)}f`;
  }

  if (
    lower.endsWith("es") &&
    !lower.endsWith("ses") &&
    !lower.endsWith("xes")
  ) {
    return lower.slice(0, -2);
  }

  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }

  return lower;
};

const normalizeWhitespace = (value: string): string =>
  value.replace(WHITESPACE_REGEX, " ").trim();

const removeParentheticalDescriptors = (
  input: string
): NormalizationAccumulator => {
  const descriptors: string[] = [];
  let working = input;

  working = working.replace(PARENTHETICAL_REGEX, (_, match: string) => {
    const descriptor = normalizeWhitespace(match);
    if (descriptor) {
      descriptors.push(descriptor);
    }
    return " ";
  });

  return { working, descriptors };
};

const removeDescriptorPhrases = (
  acc: NormalizationAccumulator
): NormalizationAccumulator => {
  let { working } = acc;
  const descriptors = [...acc.descriptors];

  for (const descriptor of DESCRIPTORS) {
    const pattern = new RegExp(`\\b${descriptor}\\b`, "gi");
    let match: RegExpExecArray | null = pattern.exec(working);

    while (match) {
      descriptors.push(descriptor);
      match = pattern.exec(working);
    }

    working = working.replace(pattern, " ");
  }

  return { working, descriptors };
};

const sanitizeWorkingValue = (value: string): string =>
  normalizeWhitespace(value.replace(NON_ALPHANUMERIC_REGEX, " "));

const buildTokens = (value: string): string[] => {
  if (!value) {
    return [];
  }

  const tokens = value
    .split(" ")
    .map((token) => singularizeToken(token))
    .filter((token) => token.length > 0);

  return Array.from(new Set(tokens));
};

export type NormalizedIngredientName = {
  baseName: string;
  descriptors: string[];
  tokens: string[];
};

export const normalizeIngredientName = (
  input: string
): NormalizedIngredientName => {
  const initial = removeParentheticalDescriptors(input);
  const { working, descriptors } = removeDescriptorPhrases(initial);
  const sanitized = sanitizeWorkingValue(working);
  const tokens = buildTokens(sanitized);

  const baseName = tokens.join(" ") || normalizeWhitespace(sanitized || input);

  return {
    baseName,
    descriptors,
    tokens,
  };
};
