/**
 * Levenshtein-based company-name similarity (P2-2a, T-293).
 *
 * `company-name-normalizer.ts` folds PUNCTUATION/SUFFIX variance to an exact
 * identity key (deterministic, zero false-positive risk). It cannot fold a
 * genuine SPELLING variant ("Hybird" vs "Hybrid") — that needs a similarity
 * score, not an exact match. This module is the pure, DB-free core so the
 * threshold and the algorithm are unit-testable without a database.
 */

/** Levenshtein edit distance between two strings. */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Similarity in [0, 1] — 1.0 for identical strings, 0.0 for maximally
 * different (edit distance == length of the longer string).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * A percentage threshold alone false-positives on real different companies
 * that share a long common substring — "Sun Pharmaceutical Industries" vs
 * "Sunrise Pharmaceutical Industries" scores 0.88 (a 4-letter INSERTION),
 * clearing an 0.85 threshold despite being two unrelated companies. A typo
 * (transposition/substitution of 1-3 characters, as in "Hybird" vs "Hybrid")
 * is a SHORT absolute edit distance regardless of name length. Requiring
 * BOTH a high percentage AND a small absolute distance catches the typo
 * class while rejecting the "one name is a superset/insertion of the other"
 * class that a percentage-only check lets through.
 */
const MAX_TYPO_EDIT_DISTANCE = 3;

/**
 * Return the existing name most similar to `candidate` at or above
 * `threshold` AND within `MAX_TYPO_EDIT_DISTANCE` absolute edits, or null if
 * none clears both bars. Ties resolve to the FIRST candidate that reaches the
 * highest score (stable, deterministic).
 */
export function findMostSimilarName(
  candidate: string,
  existingNames: string[],
  threshold: number
): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const name of existingNames) {
    const distance = levenshteinDistance(candidate, name);
    if (distance > MAX_TYPO_EDIT_DISTANCE) continue;
    const score = levenshteinSimilarity(candidate, name);
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}
