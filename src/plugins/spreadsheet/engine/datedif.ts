/**
 * DATEDIF — complete elapsed time between two dates, in a chosen unit.
 *
 * Pure: two Excel serials and a unit in, a number (or an Excel error string)
 * out. The unit branches each have their own boundary handling (month-end
 * borrowing, year wraparound), which is exactly what makes them worth testing
 * apart from the handler that reads the arguments.
 */

import { serialToDate } from "./date-utils";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Complete `unit`s between two dates, or `"#NUM!"` when start is after end or
 *  the unit is not one of Y / M / D / MD / YM / YD. `unit` is matched
 *  case-insensitively. */
export function computeDatedif(startSerial: number, endSerial: number, unit: string): number | string {
  if (startSerial > endSerial) return "#NUM!";

  const startDate = serialToDate(startSerial);
  const endDate = serialToDate(endSerial);

  const yearDiff = endDate.getUTCFullYear() - startDate.getUTCFullYear();
  const monthDiff = endDate.getUTCMonth() - startDate.getUTCMonth();
  const dayDiff = endDate.getUTCDate() - startDate.getUTCDate();

  switch (unit.toUpperCase()) {
    case "Y": {
      // Complete years: back off one if the end has not yet reached the
      // start's month-and-day within its year.
      const years = yearDiff;
      return monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? years - 1 : years;
    }

    case "M": {
      // Complete months, backing off one when the day-of-month has not been reached.
      const months = yearDiff * 12 + monthDiff;
      return dayDiff < 0 ? months - 1 : months;
    }

    case "D":
      return Math.floor(endSerial - startSerial);

    case "MD": {
      // Day-of-month difference, ignoring months and years. When the end day is
      // earlier in its month, borrow the length of the month before the end.
      const startD = startDate.getUTCDate();
      const endD = endDate.getUTCDate();
      if (endD >= startD) return endD - startD;
      const prevMonthLastDay = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 0)).getUTCDate();
      return prevMonthLastDay - startD + endD;
    }

    case "YM": {
      // Month difference, ignoring years — wraps into 0..11.
      const ym = dayDiff < 0 ? monthDiff - 1 : monthDiff;
      return ym < 0 ? ym + 12 : ym;
    }

    case "YD": {
      // Day difference, ignoring years: move the start into the end's year,
      // stepping back a year if that would put it after the end.
      const startInEndYear = new Date(startDate);
      startInEndYear.setUTCFullYear(endDate.getUTCFullYear());
      if (startInEndYear.getTime() - endDate.getTime() > 0) {
        startInEndYear.setUTCFullYear(endDate.getUTCFullYear() - 1);
      }
      return Math.floor((endDate.getTime() - startInEndYear.getTime()) / MS_PER_DAY);
    }

    default:
      return "#NUM!";
  }
}
