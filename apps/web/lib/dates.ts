/**
 * Dates as readers see them. Formatted in UTC, always: pages are prerendered,
 * and a build machine's time zone must not decide which day a post appears
 * to be from (the gate lane runs under Pacific/Kiritimati to catch exactly that).
 */
const LONG = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' });

export function longDate(instant: string): string {
  return LONG.format(new Date(instant));
}

/** `YYYY`, in UTC, for grouping an archive by year. */
export function yearOf(instant: string): string {
  return instant.slice(0, 4);
}
