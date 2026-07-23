/**
 * The Excel error values the engine emits as strings (e.g. `#NUM!` from an
 * out-of-domain math function, `#DIV/0!` from MOD by zero). Centralised so
 * IFERROR and any future error-aware code can recognise them without each
 * hard-coding the list.
 */

export const SPREADSHEET_ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"] as const;

const errorSet: ReadonlySet<string> = new Set(SPREADSHEET_ERRORS);

/** Whether a value is one of the spreadsheet error strings. */
export function isSpreadsheetError(value: unknown): boolean {
  return typeof value === "string" && errorSet.has(value);
}

/** Whether an evaluated result should be treated as an error: a spreadsheet
 *  error string, a NaN / infinite number, or a missing value. This is what
 *  IFERROR catches. */
export function isErrorResult(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value) || !Number.isFinite(value);
  return isSpreadsheetError(value);
}
