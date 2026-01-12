import { levenshtein } from "./levenshtein";

/**
 * Find similar strings by Levenshtein distance
 * Returns an array of targets sorted by their distance from the key
 */
export function findSimilar(key: string, targets: string[]) {
  return targets
    .map((target) => ({ target, distance: levenshtein(key, target) }))
    .sort((a, b) => a.distance - b.distance);
}
