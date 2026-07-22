/**
 * Which order an ambiguous slash date is written in, per locale.
 *
 * Only dates whose two leading numbers are BOTH 12 or under are ambiguous —
 * `13/04/2025` can only be day-first, and `04/13/2025` can only be month-first,
 * so those decide themselves. This is purely about `03/04/2025`.
 */

// Day-first locales among the ones the app ships. The rest are month-first
// here: `en` because the app cannot see the region (`en-GB` is folded to `en`
// before it reaches any plugin), and ja / zh / ko because their conventional
// order is year-month-day, which puts the month before the day in a two-part
// date just as US order does.
const DAY_FIRST_LANGUAGES = new Set(["es", "pt", "fr", "de", "it", "nl", "ru", "pl", "tr", "id", "vi", "th"]);

/** True when an ambiguous `A/B/YYYY` should read as day-first. Accepts a full
 *  BCP 47 tag or a bare language subtag; the region is used when present so a
 *  caller that can supply `en-GB` gets the right answer even though the app's
 *  own locale resolution discards it. */
export function prefersDayFirst(locale: string | undefined | null): boolean {
  if (!locale) return false;
  const [language = "", region = ""] = locale.toLowerCase().split(/[-_]/);
  // English splits on region rather than language: US, Canada and the
  // Philippines write month-first, the rest of the English-speaking world does
  // not. A bare `en` cannot be resolved, so it keeps the US default.
  if (language === "en") return region !== "" && !["us", "ca", "ph"].includes(region);
  return DAY_FIRST_LANGUAGES.has(language);
}
