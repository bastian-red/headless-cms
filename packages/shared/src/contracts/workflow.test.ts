/**
 * The workflow table against the database's own rules.
 *
 * `posts_*_state_check` in the content migration are the truth about which
 * rows may exist. This test models them, enumerates every row state they
 * allow, applies every transition and every save, and requires each result to
 * be a row they allow too. A table entry that would make Postgres refuse the
 * update (a 500 in the studio) fails here first.
 */
import { describe, expect, it } from 'vitest';

import { POST_STATUSES, type PostStatus } from './content';
import { can } from './roles';
import {
  availableTransitions,
  planTransition,
  SAVE_CANCELS_SCHEDULE,
  statusAfterSave,
  TRANSITIONS,
  WORKFLOW,
} from './workflow';

/** A post row, reduced to what the CHECKs read. `old` is a revision before the head. */
interface Row {
  status: PostStatus;
  head: 'head';
  published: null | 'head' | 'old';
  scheduled: boolean;
}

/** posts_published_state_check, _unpublished_, _pending_, _scheduled_ (migration.sql). */
function allowed(row: Row): boolean {
  if (row.status === 'PUBLISHED' && row.published !== 'head') return false;
  if (row.status === 'UNPUBLISHED' && row.published !== null) return false;
  if (['DRAFT', 'IN_REVIEW', 'SCHEDULED'].includes(row.status) && row.published === 'head')
    return false;
  return (row.status === 'SCHEDULED') === row.scheduled;
}

const rows: Row[] = POST_STATUSES.flatMap((status) =>
  ([null, 'head', 'old'] as const).flatMap((published) =>
    [true, false].map((scheduled) => ({ status, head: 'head' as const, published, scheduled })),
  ),
).filter(allowed);

describe('every transition from every allowed row gives an allowed row', () => {
  it('has rows in every status to start from', () => {
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(POST_STATUSES));
  });

  it.each(TRANSITIONS)('%s', (name) => {
    let applied = 0;
    for (const row of rows) {
      const decision = planTransition(name, { status: row.status, live: row.published !== null });
      if (!decision.ok) continue;
      applied += 1;
      const { plan } = decision;
      const next: Row = {
        status: plan.status,
        head: 'head',
        published:
          plan.published === 'head' ? 'head' : plan.published === 'clear' ? null : row.published,
        scheduled: plan.scheduledFor === 'set',
      };
      expect(allowed(next), `${name} from ${JSON.stringify(row)}`).toBe(true);
    }
    expect(applied, `${name} applies from no state at all`).toBeGreaterThan(0);
  });

  it('a save (new head, published revision now older) gives an allowed row', () => {
    for (const row of rows) {
      const next: Row = {
        status: statusAfterSave(row.status),
        head: 'head',
        published: row.published === null ? null : 'old',
        scheduled: false,
      };
      expect(allowed(next), `save from ${JSON.stringify(row)}`).toBe(true);
    }
  });
});

describe('the rules a newsroom expects', () => {
  it('lets an author submit and withdraw, and nothing that changes what readers see', () => {
    for (const name of TRANSITIONS) {
      expect(can('AUTHOR', WORKFLOW[name].requires), name).toBe(
        name === 'submit' || name === 'withdraw',
      );
    }
    expect(can('AUTHOR', SAVE_CANCELS_SCHEDULE)).toBe(false);
  });

  it('offers exactly these transitions per state', () => {
    expect(availableTransitions({ status: 'DRAFT', live: false })).toEqual([
      'submit',
      'publish',
      'schedule',
    ]);
    expect(availableTransitions({ status: 'DRAFT', live: true })).toEqual([
      'submit',
      'publish',
      'schedule',
      'unpublish',
    ]);
    expect(availableTransitions({ status: 'IN_REVIEW', live: false })).toEqual([
      'withdraw',
      'publish',
      'schedule',
    ]);
    expect(availableTransitions({ status: 'SCHEDULED', live: false })).toEqual([
      'publish',
      'schedule',
      'unschedule',
    ]);
    expect(availableTransitions({ status: 'PUBLISHED', live: true })).toEqual(['unpublish']);
    expect(availableTransitions({ status: 'UNPUBLISHED', live: false })).toEqual([
      'publish',
      'schedule',
    ]);
  });

  it('refuses with a sentence, not a code', () => {
    expect(planTransition('publish', { status: 'PUBLISHED', live: true })).toEqual({
      ok: false,
      reason: 'This post is already published with nothing pending.',
    });
  });

  it('keeps a post in review in review when it is edited, and drafts everything else', () => {
    expect(POST_STATUSES.map(statusAfterSave)).toEqual([
      'DRAFT',
      'IN_REVIEW',
      'DRAFT',
      'DRAFT',
      'DRAFT',
    ]);
  });
});
