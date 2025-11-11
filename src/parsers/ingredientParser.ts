import { DESCRIPTORS, UNICODE_FRACTIONS, UNIT_ALIASES } from '../const.js';
import type { ParsedIngredient, RawIngredient } from '../types.js';

const fractionStringToNumber = (input: string): number | null => {
  if (!input) {
    return null;
  }

  if (input.includes('/')) {
    const [numeratorRaw, denominatorRaw] = input.split('/');
    if (!numeratorRaw || !denominatorRaw) {
      return null;
    }

    const numerator = Number.parseFloat(numeratorRaw);
    const denominator = Number.parseFloat(denominatorRaw);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
    return null;
  }

  const unicodeValue = UNICODE_FRACTIONS[input];
  if (unicodeValue !== undefined) {
    return unicodeValue;
  }

  const numeric = Number.parseFloat(input);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeWhitespace = (input: string): string =>
  input
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();

const stripLeadingCharacters = (input: string): string => input.replace(/^[—-]/, '').trim();

const parseQuantity = (input: string): { quantity: number | null; rest: string } => {
  const working = stripLeadingCharacters(input);

  if (!working) {
    return { quantity: null, rest: working };
  }

  const unicodeFractionMatch = working.match(/^([^\d\s]+)/);
  if (unicodeFractionMatch) {
    const [match] = unicodeFractionMatch;
    const fractionValue = fractionStringToNumber(match);
    if (fractionValue !== null) {
      return {
        quantity: fractionValue,
        rest: working.slice(match.length).trim()
      };
    }
  }

  const mixedMatch = working.match(/^(\d+)\s+(\d+\/\d+)/);
  if (mixedMatch) {
    const wholePart = mixedMatch[1] ?? '';
    const fractionPart = mixedMatch[2] ?? '';
    const whole = Number.parseInt(wholePart, 10);
    const fraction = fractionStringToNumber(fractionPart);
    const quantity = fraction !== null ? whole + fraction : whole;
    return {
      quantity,
      rest: working.slice(mixedMatch[0].length).trim()
    };
  }

  const simpleFractionMatch = working.match(/^(\d+\/\d+)/);
  if (simpleFractionMatch) {
    const fraction = fractionStringToNumber(simpleFractionMatch[1] ?? '');
    return {
      quantity: fraction,
      rest: working.slice(simpleFractionMatch[0].length).trim()
    };
  }

  const rangeMatch = working.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const [, startPart = ''] = rangeMatch;
    return {
      quantity: Number.parseFloat(startPart),
      rest: working.slice(rangeMatch[0].length).trim()
    };
  }

  const numberMatch = working.match(/^(\d+(?:\.\d+)?)/);
  if (numberMatch) {
    const [, numberPart = ''] = numberMatch;
    return {
      quantity: Number.parseFloat(numberPart),
      rest: working.slice(numberMatch[0].length).trim()
    };
  }

  return { quantity: null, rest: working };
};

const matchUnit = (tokens: string[]): { unit: string | null; remainingTokens: string[] } => {
  if (tokens.length === 0) {
    return { unit: null, remainingTokens: tokens };
  }

  const lookupUnit = (candidate: string): string | null => {
    if (!candidate) {
      return null;
    }
    const normalized = candidate.toLowerCase();
    return UNIT_ALIASES[normalized] ?? null;
  };

  if (tokens.length >= 2) {
    const [firstToken, secondToken] = tokens;
    const twoWord = `${firstToken} ${secondToken}`;
    const match = lookupUnit(twoWord);
    if (match) {
      return { unit: match, remainingTokens: tokens.slice(2) };
    }
  }

  const [firstToken] = tokens;
  const singleWordMatch = firstToken ? lookupUnit(firstToken) : null;
  if (singleWordMatch) {
    return { unit: singleWordMatch, remainingTokens: tokens.slice(1) };
  }

  return { unit: null, remainingTokens: tokens };
};

const cleanIngredientName = (input: string): string => {
  let result = input.trim();

  for (const descriptor of DESCRIPTORS) {
    const descriptorPattern = new RegExp(`\\b${descriptor}\\b`, 'gi');
    result = result.replace(descriptorPattern, '').trim();
  }

  result = result.replace(/^of\s+/i, '').trim();
  result = result.replace(/\s{2,}/g, ' ');
  result = result.replace(/,\s*$/, '').trim();

  return result;
};

export const parseIngredient = (line: RawIngredient): ParsedIngredient => {
  const normalized = normalizeWhitespace(line);

  if (!normalized) {
    return {
      raw: line,
      qty: null,
      unit: null,
      name: ''
    };
  }

  const { quantity, rest } = parseQuantity(normalized);
  const tokens = rest.split(' ').filter(Boolean);
  const { unit, remainingTokens } = matchUnit(tokens);

  const remainder = remainingTokens.join(' ');
  const cleanedName = cleanIngredientName(remainder || rest);

  return {
    raw: line,
    qty: quantity,
    unit,
    name: cleanedName || line.trim()
  };
};

export const parseIngredients = (ingredients: RawIngredient[]): ParsedIngredient[] =>
  ingredients.map((ingredient) => parseIngredient(ingredient));
