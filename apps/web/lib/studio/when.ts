/**
 * Times in the studio. The server does not know the viewer's zone, so the
 * first render is in UTC, labelled, and the browser re-renders the same
 * instant in its own zone once it has loaded (`components/studio/when.tsx`).
 *
 * Fields, not `dateStyle`/`timeStyle`: those cannot be combined with
 * `timeZoneName` (V8 throws "Invalid option"), and the zone's name is the
 * point. That throw once took down every studio page that showed a time.
 */
const OPTIONS = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
} as const;

/** The instant in `timeZone`, with the zone's short name. */
export function zonedText(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', { ...OPTIONS, timeZone }).format(new Date(instant));
}

export function utcText(instant: string): string {
  return zonedText(instant, 'UTC');
}
