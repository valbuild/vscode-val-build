/**
 * Levenshtein distance algorithm
 * Calculates the minimum number of single-character edits needed to change one string into another
 * GPT generated
 */
export const levenshtein = (a: string, b: string): number => {
  const [m, n] = [a.length, b.length];
  if (!m || !n) return Math.max(m, n);

  const dp = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;

    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : Math.min(prev + 1, dp[i - 1] + 1, dp[i] + 1);
      prev = temp;
    }
  }

  return dp[m];
};
