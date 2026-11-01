import { describe, expect, it } from 'vitest';

import { utcText, zonedText } from './when';

// Expected strings printed by Node's Intl (ICU) for this instant, then pasted.
describe('studio times', () => {
  const instant = '2026-11-01T12:30:00.000Z';

  it('names the zone, in UTC on the server', () => {
    expect(utcText(instant)).toBe('Nov 1, 2026, 12:30 PM UTC');
  });

  it('renders the same instant in the viewer zone', () => {
    expect(zonedText(instant, 'America/Santiago')).toBe('Nov 1, 2026, 9:30 AM GMT-3');
    expect(zonedText(instant, 'Asia/Kolkata')).toBe('Nov 1, 2026, 6:00 PM GMT+5:30');
  });
});
