import { afterEach, describe, expect, it } from 'vitest';

import { isoToLocalInput, localInputToIso, scheduleProblem } from './schedule-time';

const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

// Expected instants computed with `new Date(...)` under each TZ before typing.
describe('schedule time', () => {
  it.each([
    ['Asia/Kolkata', '2026-11-01T04:00:00.000Z'],
    ['America/Santiago', '2026-11-01T12:30:00.000Z'],
    ['UTC', '2026-11-01T09:30:00.000Z'],
  ])('reads a wall-clock time in %s as that zone', (zone, iso) => {
    process.env.TZ = zone;
    expect(localInputToIso('2026-11-01T09:30')).toBe(iso);
    expect(isoToLocalInput(iso)).toBe('2026-11-01T09:30');
  });

  it('refuses what the input cannot mean', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-11-01')).toBeNull();
    expect(localInputToIso('2026-11-01T09:30:00Z')).toBeNull();
    expect(localInputToIso('2026-13-40T09:30')).toBeNull();
  });

  it('refuses a time inside a daylight-saving gap instead of moving it', () => {
    process.env.TZ = 'America/Santiago';
    const before = Date.parse('2026-09-01T00:00:00Z');
    expect(scheduleProblem('2026-09-06T00:30', before)).toMatch(/does not exist/u);
    expect(scheduleProblem('2026-09-06T01:30', before)).toBeNull();
  });

  it('asks for at least a minute of lead time', () => {
    process.env.TZ = 'UTC';
    const now = Date.parse('2026-11-01T09:00:00Z');
    expect(scheduleProblem('2026-11-01T09:00', now)).toMatch(/at least a minute/u);
    expect(scheduleProblem('2026-11-01T09:01', now)).toBeNull();
    expect(scheduleProblem('', now)).toBe('Choose a date and a time.');
  });
});
