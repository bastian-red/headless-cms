import { TRANSITIONS } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { orderedTransitions, readersSee, STATUS_UI, TRANSITION_UI } from './workflow-ui';

describe('workflow wording', () => {
  it('gives every status a glyph and a word, all different', () => {
    const glyphs = Object.values(STATUS_UI).map((s) => s.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const status of Object.values(STATUS_UI)) expect(status.word).not.toBe('');
  });

  it('words every transition, and only unpublish asks first', () => {
    for (const name of TRANSITIONS) expect(TRANSITION_UI[name].label).not.toBe('');
    const asking = TRANSITIONS.filter((name) => TRANSITION_UI[name].confirm !== undefined);
    expect(asking).toEqual(['unpublish']);
  });

  it('puts the main action first and the destructive one last', () => {
    expect(orderedTransitions(['unpublish', 'schedule', 'publish'])).toEqual([
      'publish',
      'schedule',
      'unpublish',
    ]);
    expect(orderedTransitions(['withdraw', 'submit'])).toEqual(['submit', 'withdraw']);
  });

  it('says what readers see, which the status alone does not', () => {
    expect(readersSee({ status: 'DRAFT', live: false })).toMatch(/Not public yet/u);
    expect(readersSee({ status: 'IN_REVIEW', live: true })).toMatch(/earlier revision/u);
    expect(readersSee({ status: 'PUBLISHED', live: true })).toBe('Readers see this revision.');
    expect(readersSee({ status: 'UNPUBLISHED', live: false })).toMatch(/404/u);
  });
});
