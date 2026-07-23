/**
 * Logical Functions
 */

import { evaluateConditionValues, readOperand, renderConditionOperand } from "../condition";
import { findCellRefs } from "../evaluator";
import { functionRegistry, type FunctionHandler } from "../registry";
import { isErrorResult } from "../spreadsheet-errors";
import { coerceToBoolean } from "../coerce-boolean";
import type { CellValue } from "../types";

const ifHandler: FunctionHandler = (args, context) => {
  if (args.length !== 3) throw new Error("IF requires 3 arguments");

  const condition = args[0];
  const trueValue = args[1];
  const falseValue = args[2];

  // Evaluate condition - use evaluateFormula to handle nested functions like MONTH()
  const conditionValue = context.evaluateFormula(condition);
  const conditionResult = coerceToBoolean(conditionValue);

  // Return the appropriate value based on condition
  const resultValue = conditionResult ? trueValue : falseValue;

  // If result is a quoted string, return the string without quotes
  if (/^["'](.*)["']$/.test(resultValue)) {
    return resultValue.slice(1, -1);
  }

  // If result is a nested formula, evaluate it recursively
  if (/^(SUM|AVERAGE|MAX|MIN|COUNT|IF|AND|OR|NOT)\(/i.test(resultValue)) {
    return context.evaluateFormula(resultValue);
  }

  // Otherwise evaluate as expression
  let expr = resultValue;

  const refs = resultValue.match(/(?:'[^']+'|[^'!\s]+)![A-Z]+\d+|\$?[A-Z]+\$?\d+/g);
  if (refs) {
    for (const ref of refs) {
      const value = context.getCellValue(ref);
      const escapedRef = ref.replace(/\$/g, "\\$").replace(/'/g, "\\'");
      expr = expr.replace(new RegExp(escapedRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), String(value));
    }
  }

  const numResult = parseFloat(expr);
  return isNaN(numResult) ? expr : numResult;
};

const andHandler: FunctionHandler = (args, context) => {
  if (args.length === 0) throw new Error("AND requires at least 1 argument");

  for (const arg of args) {
    if (!coerceToBoolean(context.evaluateFormula(arg.trim()))) {
      return false;
    }
  }
  return true;
};

const orHandler: FunctionHandler = (args, context) => {
  if (args.length === 0) throw new Error("OR requires at least 1 argument");

  for (const arg of args) {
    if (coerceToBoolean(context.evaluateFormula(arg.trim()))) {
      return true;
    }
  }
  return false;
};

const notHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("NOT requires 1 argument");

  return !coerceToBoolean(context.evaluateFormula(args[0]));
};

/** Whether `source` is a single quoted string literal. Its value is text even
 *  when that text looks like an error code, so IFERROR must not swallow it. */
const isQuotedLiteral = (source: string): boolean => {
  const trimmed = source.trim();
  return trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")));
};

const iferrorHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("IFERROR requires 2 arguments");

  try {
    const result = context.evaluateFormula(args[0]);
    // Catches NaN/∞ AND the Excel error strings functions now return (a math
    // domain miss like SQRT(-1) → "#NUM!"), so IFERROR(SQRT(-1), 0) is 0. A
    // quoted literal that merely looks like an error (IFERROR("#NUM!", 42)) is
    // real text, not an error value, so it passes through (Codex review).
    if (!isQuotedLiteral(args[0]) && isErrorResult(result)) {
      return context.evaluateFormula(args[1]);
    }
    return result;
  } catch {
    // If evaluation throws an error, return the fallback value
    return context.evaluateFormula(args[1]);
  }
};

const ifnaHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("IFNA requires 2 arguments");

  const result = context.evaluateFormula(args[0]);
  // Check if result is N/A (could be represented as specific error value)
  if (result === null || result === undefined || result === "#N/A") {
    return context.evaluateFormula(args[1]);
  }
  return result;
};

const ifsHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length % 2 !== 0) {
    throw new Error("IFS requires an even number of arguments (condition-value pairs)");
  }

  // Iterate through condition-value pairs
  for (let i = 0; i < args.length; i += 2) {
    const condition = args[i];
    const value = args[i + 1];

    // Substitute references by POSITION (back to front), skipping any that sit
    // inside a quoted string literal: `IFS(A1="B2", …)` must compare A1 to the
    // TEXT "B2", not to cell B2's value (Codex review). findCellRefs already
    // skips literals and matches absolute / sheet-qualified refs, so this also
    // avoids the earlier regex double-escaping. renderConditionOperand quotes a
    // text cell so its own operators are not re-parsed as comparisons.
    let condExpr = condition;
    const cellRefs = findCellRefs(condition);
    for (let index = cellRefs.length - 1; index >= 0; index--) {
      const { ref, start } = cellRefs[index];
      const rendered = renderConditionOperand(context.getCellValue(ref));
      condExpr = condExpr.slice(0, start) + rendered + condExpr.slice(start + ref.length);
    }

    // Parsed, not executed. This used to call `eval` on `condExpr`, which is
    // the substituted text — so a cell containing `globalThis.x = 1` ran as
    // code whenever an IFS referenced it, and so did anything written into the
    // formula itself. `readOperand` resolves the simple operands (TRUE/FALSE ->
    // boolean, quoted text, numbers); an arithmetic expression it leaves as raw
    // text is handed to the engine's safe evaluator so `A1+1>10` is computed.
    // Only the top-level comparison is applied — the condition is never run.
    const evaluateOperand = (operand: string): CellValue => {
      const parsed = readOperand(operand);
      return typeof parsed === "string" && parsed === operand.trim() ? context.evaluateFormula(operand) : parsed;
    };
    if (evaluateConditionValues(condExpr, evaluateOperand)) {
      // If result is a quoted string, return without quotes

      if (/^["'](.*)["']$/.test(value)) {
        return value.slice(1, -1);
      }
      // Otherwise evaluate as formula or expression
      return context.evaluateFormula(value);
    }
  }

  // If no conditions match, return error
  return "#N/A";
};

const trueHandler: FunctionHandler = (args) => {
  if (args.length !== 0) throw new Error("TRUE requires 0 arguments");
  return true;
};

const falseHandler: FunctionHandler = (args) => {
  if (args.length !== 0) throw new Error("FALSE requires 0 arguments");
  return false;
};

// Register all logical functions
functionRegistry.register({
  name: "IF",
  handler: ifHandler,
  minArgs: 3,
  maxArgs: 3,
  description: "Returns one value if a condition is true and another if false",
  examples: ['IF(A1>10, "High", "Low")', "IF(B2>=5, SUM(C1:C10), 0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "AND",
  handler: andHandler,
  minArgs: 1,
  description: "Returns TRUE if all arguments are true",
  examples: ["AND(A1>5, B1<10)", "AND(A1>0, B1>0, C1>0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "OR",
  handler: orHandler,
  minArgs: 1,
  description: "Returns TRUE if any argument is true",
  examples: ["OR(A1>5, B1<10)", "OR(A1>0, B1>0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "NOT",
  handler: notHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Reverses the logical value of its argument",
  examples: ["NOT(A1>5)", "NOT(B1)"],
  category: "Logical",
});

functionRegistry.register({
  name: "IFERROR",
  handler: iferrorHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Returns a value if expression is an error, otherwise returns the expression",
  examples: ["IFERROR(A1/B1, 0)", 'IFERROR(VLOOKUP(A1, B1:C10, 2), "Not found")'],
  category: "Logical",
});

functionRegistry.register({
  name: "IFNA",
  handler: ifnaHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Returns a value if expression is #N/A, otherwise returns the expression",
  examples: ['IFNA(A1, "N/A")', "IFNA(MATCH(A1, B1:B10), 0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "IFS",
  handler: ifsHandler,
  minArgs: 2,
  description: "Checks multiple conditions and returns the first true result",
  examples: ['IFS(A1>90, "A", A1>80, "B", A1>70, "C")', 'IFS(B1="Yes", 1, B1="No", 0)'],
  category: "Logical",
});

functionRegistry.register({
  name: "TRUE",
  handler: trueHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the logical value TRUE",
  examples: ["TRUE()", "IF(A1>0, TRUE(), FALSE())"],
  category: "Logical",
});

functionRegistry.register({
  name: "FALSE",
  handler: falseHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the logical value FALSE",
  examples: ["FALSE()", "IF(A1>0, TRUE(), FALSE())"],
  category: "Logical",
});
