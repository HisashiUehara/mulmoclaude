/**
 * Pure statistical rules, separated from the range-reading handlers so they can
 * be unit-tested directly.
 */

import { DIV_ZERO_ERROR, NA_ERROR, type SpreadsheetError } from "../spreadsheet-errors";

/**
 * The most frequently occurring value, or `#N/A` when no value repeats.
 *
 * Excel's MODE is undefined for an all-distinct set, so returning the first
 * element (as a naive "highest frequency wins" loop does when every count is 1)
 * is a silent wrong answer. Ties resolve to the value that appears first, which
 * Map insertion order preserves.
 */
export function computeMode(values: number[]): number | SpreadsheetError {
  const frequency = new Map<number, number>();
  for (const value of values) {
    frequency.set(value, (frequency.get(value) ?? 0) + 1);
  }

  let topFrequency = 0;
  let mode: number | SpreadsheetError = NA_ERROR;
  for (const [value, count] of frequency.entries()) {
    if (count > topFrequency) {
      topFrequency = count;
      mode = value;
    }
  }

  const REPEAT_THRESHOLD = 2;
  return topFrequency >= REPEAT_THRESHOLD ? mode : NA_ERROR;
}

/** Sample size below which a sample variance/stdev is undefined. */
const MIN_SAMPLE_SIZE = 2;

const arithmeticMean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Sample variance (Excel VAR): the mean squared deviation divided by `n - 1`,
 * not `n`. Dividing by `n` is the POPULATION variance (Excel's VARP); using it
 * for VAR understates the spread. Fewer than two values leave no `n - 1` to
 * divide by, so Excel reports `#DIV/0!` rather than a silent 0.
 */
export function sampleVariance(values: number[]): number | SpreadsheetError {
  if (values.length < MIN_SAMPLE_SIZE) return DIV_ZERO_ERROR;
  const mean = arithmeticMean(values);
  const sumSquaredDiffs = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return sumSquaredDiffs / (values.length - 1);
}

/** Sample standard deviation (Excel STDEV): the square root of the sample
 *  variance, and `#DIV/0!` on the same fewer-than-two-values boundary. */
export function sampleStdev(values: number[]): number | SpreadsheetError {
  const variance = sampleVariance(values);
  return typeof variance === "number" ? Math.sqrt(variance) : variance;
}
