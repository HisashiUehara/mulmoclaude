/**
 * Annuity math for the financial functions, as pure numeric helpers.
 *
 * Excel's cash-flow sign convention: money received is positive, money paid out
 * is negative — so a loan's `pv` is positive and its payment and interest come
 * back negative. Keeping the per-period split as plain number-in / number-out
 * functions lets it be tested against known Excel values without routing string
 * arguments back through the formula evaluator.
 */

/** Future value after `nper` periods. `type` is 0 (end of period) or 1 (begin). */
export function computeFv(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const growth = Math.pow(1 + rate, nper);
  return -pv * growth - (pmt * (growth - 1) * (1 + rate * type)) / rate;
}

/** Constant per-period payment amortising a present value `pv` to `fv`. */
export function computePmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pv) / nper;
  const growth = Math.pow(1 + rate, nper);
  return (-rate * (fv + pv * growth)) / ((growth - 1) * (1 + rate * type));
}

/** Interest portion of the `per`-th payment. */
export function computeIpmt(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  const pmt = computePmt(rate, nper, pv, fv, type);
  if (per === 1 && type === 1) return 0;
  const priorPeriods = type === 1 ? per - 2 : per - 1;
  // Interest is the rate applied to the balance outstanding at the start of the
  // period. computeFv already carries the payment-negative sign, so this product
  // is the interest as a (negative) cash outflow — negating it again inverted the
  // sign (IPMT came back +1250 for a -1250 payment) and PPMT amplified the error.
  const interest = computeFv(rate, priorPeriods, pmt, pv, type) * rate;
  return type === 1 ? interest / (1 + rate) : interest;
}

/** Principal portion of the `per`-th payment (total payment minus interest). */
export function computePpmt(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  return computePmt(rate, nper, pv, fv, type) - computeIpmt(rate, per, nper, pv, fv, type);
}

/** Net present value: each cash flow discounted by its 1-based period, in the
 *  order given. The caller flattens ranges and scalars into one ordered list, so
 *  a scalar after an N-cell range sits at period N+1 — NPV counts values, not
 *  arguments. Using the argument index put a trailing scalar at the wrong (lower)
 *  period (#2390). */
export function computeNpv(rate: number, cashFlows: number[]): number {
  return cashFlows.reduce((npv, flow, index) => npv + flow / Math.pow(1 + rate, index + 1), 0);
}
