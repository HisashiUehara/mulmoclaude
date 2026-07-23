/**
 * Pure statistical rules, separated from the range-reading handlers so they can
 * be unit-tested directly.
 */

/** Returned when a statistic has no defined value (MODE with no repeat). */
export const NA_ERROR = "#N/A";
/** Returned when an average would divide by zero (AVERAGEIF with no match). */
export const DIV_ZERO_ERROR = "#DIV/0!";

/**
 * The most frequently occurring value, or `#N/A` when no value repeats.
 *
 * Excel's MODE is undefined for an all-distinct set, so returning the first
 * element (as a naive "highest frequency wins" loop does when every count is 1)
 * is a silent wrong answer. Ties resolve to the value that appears first, which
 * Map insertion order preserves.
 */
export function computeMode(values: number[]): number | string {
  const frequency = new Map<number, number>();
  for (const value of values) {
    frequency.set(value, (frequency.get(value) ?? 0) + 1);
  }

  let topFrequency = 0;
  let mode: number | string = NA_ERROR;
  for (const [value, count] of frequency.entries()) {
    if (count > topFrequency) {
      topFrequency = count;
      mode = value;
    }
  }

  const REPEAT_THRESHOLD = 2;
  return topFrequency >= REPEAT_THRESHOLD ? mode : NA_ERROR;
}
