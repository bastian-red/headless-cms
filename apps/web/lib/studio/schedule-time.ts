/**
 * The schedule field: a `datetime-local` input, which is wall-clock time in
 * the editor's own time zone, to and from the instant the API stores.
 *
 * `new Date('2026-11-01T09:30')` reads a zone-less string as local time,
 * which is exactly what the input means, so the conversion is the platform's,
 * not ours. These functions only reject what the input cannot mean and
 * format the way back.
 */
import { MIN_SCHEDULE_LEAD_MS } from '@cms/shared';

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;

/** The instant a `datetime-local` value names, as ISO 8601 UTC; null if it names none. */
export function localInputToIso(value: string): string | null {
  if (!LOCAL.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** An instant as a `datetime-local` value in this runtime's zone (minutes, no seconds). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Why a `datetime-local` value cannot be scheduled, in the editor's words;
 * null if it can. A wall-clock time inside a daylight-saving gap names no
 * instant (Chile skips 00:00-00:59 on 2026-09-06, and `Date` silently moves
 * 00:30 to 01:30), so it is refused rather than published an hour late.
 */
export function scheduleProblem(value: string, now: number): string | null {
  const iso = localInputToIso(value);
  if (iso === null) return 'Choose a date and a time.';
  if (isoToLocalInput(iso) !== value) {
    return 'That time does not exist here: the clocks skip it. Choose another.';
  }
  if (Date.parse(iso) - now < MIN_SCHEDULE_LEAD_MS) {
    return 'Choose a time at least a minute from now.';
  }
  return null;
}
