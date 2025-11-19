import { normalizeIngredientName } from "../normalizers/ingredient-normalizer.js";
import { cosineSimilarity } from "../services/embedding-gateway.js";
import type {
  EmbeddingVector,
  FoodMatchCandidate,
  IndexedFood,
  MatchReason,
  MatchReasonType,
  ParsedIngredient,
} from "../types.js";

const EXACT_NAME_SCORE = 100;
const ALIAS_EXACT_SCORE = 95;
const PREFIX_SCORE = 85;
const TOKEN_SCORE_HIGH = 80;
const TOKEN_SCORE_MEDIUM = 70;
const TOKEN_SCORE_LOW = 60;
const FUZZY_SCORE_WEIGHT = 70;
const EMBEDDING_MIN_SIMILARITY = 0.6;

export const DEFAULT_HARD_MATCH_THRESHOLD = 90;
export const DEFAULT_SOFT_MATCH_THRESHOLD = 70;

const parseThreshold = (
  value: string | undefined,
  fallback: number
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
};

export const HARD_MATCH_THRESHOLD = parseThreshold(
  process.env.MATCH_HARD_THRESHOLD,
  DEFAULT_HARD_MATCH_THRESHOLD
);

export const SOFT_MATCH_THRESHOLD = parseThreshold(
  process.env.MATCH_SOFT_THRESHOLD,
  DEFAULT_SOFT_MATCH_THRESHOLD
);

const normalizeForComparison = (value: string): string =>
  normalizeIngredientName(value).baseName.toLowerCase();

const levenshteinDistance = (a: string, b: string): number => {
  const previousRow = new Array(b.length + 1).fill(0);
  const currentRow = new Array(b.length + 1).fill(0);

  for (let j = 0; j <= b.length; j += 1) {
    previousRow[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    currentRow[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const insertion = (currentRow[j - 1] ?? Number.POSITIVE_INFINITY) + 1;
      const deletion = (previousRow[j] ?? Number.POSITIVE_INFINITY) + 1;
      const substitution =
        (previousRow[j - 1] ?? Number.POSITIVE_INFINITY) +
        (a[i - 1] === b[j - 1] ? 0 : 1);
      currentRow[j] = Math.min(insertion, deletion, substitution);
    }

    for (let j = 0; j <= b.length; j += 1) {
      previousRow[j] = currentRow[j];
    }
  }

  return previousRow[b.length] ?? Number.POSITIVE_INFINITY;
};

const computeLevenshteinSimilarity = (
  a: string,
  b: string
): number | undefined => {
  if (!(a && b)) {
    return;
  }

  if (a === b) {
    return 1;
  }

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return;
  }

  return 1 - distance / maxLength;
};

const addReason = (
  reasons: MatchReason[],
  type: MatchReasonType,
  score: number,
  meta?: Record<string, unknown>
) => {
  reasons.push({
    type,
    score,
    ...(meta ? { meta } : {}),
  });
};

const computeTokenOverlapScore = (
  ingredientTokens: string[],
  candidateTokens: Set<string>
): MatchReason | undefined => {
  if (!ingredientTokens.length || candidateTokens.size === 0) {
    return;
  }

  const matched = ingredientTokens.filter((token) =>
    candidateTokens.has(token)
  );

  if (!matched.length) {
    return;
  }

  const coverageCandidate = matched.length / candidateTokens.size;
  const coverageIngredient = matched.length / ingredientTokens.length;
  const coverage = Math.max(coverageCandidate, coverageIngredient);

  if (coverage >= 0.8) {
    return {
      type: "token-overlap",
      score: TOKEN_SCORE_HIGH,
      meta: { coverage },
    };
  }

  if (coverage >= 0.6) {
    return {
      type: "token-overlap",
      score: TOKEN_SCORE_MEDIUM,
      meta: { coverage },
    };
  }

  if (coverage >= 0.4) {
    return {
      type: "token-overlap",
      score: TOKEN_SCORE_LOW,
      meta: { coverage },
    };
  }

  return;
};

const computeAliasTokenOverlap = (
  ingredientTokens: string[],
  aliasTokenSets: Set<string>[]
): MatchReason | undefined => {
  if (!ingredientTokens.length || aliasTokenSets.length === 0) {
    return;
  }

  for (const tokenSet of aliasTokenSets) {
    if (tokenSet.size === 0) {
      continue;
    }

    const matched = ingredientTokens.filter((token) => tokenSet.has(token));
    const coverage = matched.length / tokenSet.size;

    if (coverage >= 0.8) {
      return {
        type: "alias-token-overlap",
        score: TOKEN_SCORE_MEDIUM,
        meta: { coverage },
      };
    }
  }

  return;
};

const combineScores = (reasons: MatchReason[]): number => {
  if (!reasons.length) {
    return 0;
  }

  const sorted = [...reasons]
    .map((reason) => reason.score)
    .sort((a, b) => b - a);

  const combined = sorted.reduce((total, score, index) => {
    if (index === 0) {
      return total + score;
    }
    return total + score * 0.2;
  }, 0);

  return Math.min(100, Math.round(combined));
};

type ScoreCandidateOptions = {
  ingredientEmbedding?: EmbeddingVector | null;
  candidateEmbedding?: EmbeddingVector | null;
};

const computeEmbeddingReason = (
  options?: ScoreCandidateOptions
): MatchReason | undefined => {
  const ingredientEmbedding = options?.ingredientEmbedding;
  const candidateEmbedding = options?.candidateEmbedding;

  if (!(ingredientEmbedding && candidateEmbedding)) {
    return;
  }

  const similarity = cosineSimilarity(ingredientEmbedding, candidateEmbedding);
  if (!Number.isFinite(similarity) || similarity < EMBEDDING_MIN_SIMILARITY) {
    return;
  }

  return {
    type: "embedding-similarity",
    score: Math.round(similarity * 100),
    meta: { similarity },
  };
};

const checkPerfectTokenMatch = (
  ingredientTokens: string[],
  candidateTokenSet: Set<string>
): boolean => {
  const ingredientTokenSet = new Set(ingredientTokens);
  const allIngredientTokensMatch = ingredientTokens.every((token) =>
    candidateTokenSet.has(token)
  );
  const allCandidateTokensMatch =
    candidateTokenSet.size > 0 &&
    Array.from(candidateTokenSet).every((token) =>
      ingredientTokenSet.has(token)
    );
  return allIngredientTokensMatch && allCandidateTokensMatch;
};

const shouldApplyPrefixMatch = (
  tokenOverlap: MatchReason | undefined,
  ingredientNameNormalized: string,
  candidateNormalizedName: string
): boolean => {
  if (!tokenOverlap?.meta) {
    return false;
  }

  const coverage = tokenOverlap.meta.coverage;
  if (typeof coverage !== "number" || coverage < 0.6) {
    return false;
  }

  return (
    candidateNormalizedName.startsWith(ingredientNameNormalized) ||
    ingredientNameNormalized.startsWith(candidateNormalizedName)
  );
};

const handleTokenOverlap = (
  reasons: MatchReason[],
  tokenOverlap: MatchReason | undefined,
  perfectTokenMatch: boolean
): void => {
  if (!tokenOverlap) {
    return;
  }

  reasons.push(tokenOverlap);

  // Boost score for perfect token matches
  if (perfectTokenMatch && tokenOverlap.score < EXACT_NAME_SCORE) {
    addReason(reasons, "token-overlap", EXACT_NAME_SCORE, {
      perfectMatch: true,
      coverage: tokenOverlap.meta?.coverage,
    });
  }
};

export const scoreCandidate = (
  ingredient: ParsedIngredient,
  candidate: IndexedFood,
  options?: ScoreCandidateOptions
): FoodMatchCandidate | null => {
  const reasons: MatchReason[] = [];
  const ingredientNameNormalized = normalizeForComparison(ingredient.name);
  const ingredientTokens =
    ingredient.normalizedTokens ??
    normalizeIngredientName(ingredient.name).tokens;

  if (!ingredientNameNormalized) {
    return null;
  }

  if (candidate.normalizedName === ingredientNameNormalized) {
    addReason(reasons, "exact-name", EXACT_NAME_SCORE);
  }

  if (candidate.aliasSet.has(ingredientNameNormalized)) {
    addReason(reasons, "alias-exact", ALIAS_EXACT_SCORE);
  }

  const tokenOverlap = computeTokenOverlapScore(
    ingredientTokens,
    candidate.tokenSet
  );

  const perfectTokenMatch = checkPerfectTokenMatch(
    ingredientTokens,
    candidate.tokenSet
  );

  // Only apply prefix matching if there's also good token overlap
  // This prevents "salt" matching "Salted Butter" incorrectly
  if (
    shouldApplyPrefixMatch(
      tokenOverlap,
      ingredientNameNormalized,
      candidate.normalizedName
    )
  ) {
    addReason(reasons, "prefix-match", PREFIX_SCORE);
  }

  handleTokenOverlap(reasons, tokenOverlap, perfectTokenMatch);

  const aliasOverlap = computeAliasTokenOverlap(
    ingredientTokens,
    candidate.aliasTokenSets
  );
  if (aliasOverlap) {
    reasons.push(aliasOverlap);
  }

  const fuzzySimilarity = computeLevenshteinSimilarity(
    ingredientNameNormalized,
    candidate.normalizedName
  );

  if (fuzzySimilarity !== undefined && fuzzySimilarity >= 0.6) {
    addReason(
      reasons,
      "fuzzy-similarity",
      Math.round(fuzzySimilarity * FUZZY_SCORE_WEIGHT),
      {
        similarity: fuzzySimilarity,
      }
    );
  }

  const embeddingReason = computeEmbeddingReason(options);
  if (embeddingReason) {
    reasons.push(embeddingReason);
  }

  if (!reasons.length) {
    return null;
  }

  const confidence = combineScores(reasons);
  if (confidence <= 0) {
    return null;
  }

  const {
    tokenSet: _tokenSet,
    aliasSet: _aliasSet,
    aliasTokenSets: _aliasTokenSets,
    normalizedName: _normalizedName,
    ...rest
  } = candidate;

  return {
    food: {
      id: rest.id,
      name: rest.name,
      aliases: rest.aliases,
    },
    confidence,
    reasons,
  };
};
