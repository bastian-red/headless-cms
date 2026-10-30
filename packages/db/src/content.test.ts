/**
 * The database and the shared contract must agree on every content rule.
 *
 * LIMITS, SLUG_PATTERN and the status lists live in @cms/shared, where the API
 * validates a request; the same rules live in the migrations as CHECK
 * constraints and enums, where Postgres refuses a write. Two copies drift, so
 * this reads the SQL that actually ran and compares it to the contract.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMMENT_STATUSES, LIMITS, POST_STATUSES, ROLES, SLUG_PATTERN } from '@cms/shared';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');
const sql = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => readFileSync(join(MIGRATIONS, e.name, 'migration.sql'), 'utf8'))
  .join('\n');

/** The single line declaring this constraint. */
function constraintLine(name: string): string {
  const lines = sql.split('\n').filter((line) => line.includes(`"${name}" CHECK`));
  expect(lines, `exactly one line declares ${name}`).toHaveLength(1);
  return lines[0]!;
}

/** The upper bound a length CHECK enforces: the number after `<=`. */
function upperBound(name: string): number {
  const match = /<= (\d+)\)/u.exec(constraintLine(name));
  expect(match, `${name} has a "<= n" bound`).not.toBeNull();
  return Number(match![1]);
}

function enumValues(type: string): string[] {
  const match = new RegExp(`CREATE TYPE "${type}" AS ENUM \\(([^)]*)\\)`, 'u').exec(sql);
  expect(match, `CREATE TYPE "${type}"`).not.toBeNull();
  return match![1]!.split(',').map((v) => v.trim().replace(/^'|'$/gu, ''));
}

const LENGTH_CHECKS: Record<keyof typeof LIMITS, readonly string[]> = {
  slug: [
    'posts_slug_format_check',
    'tags_slug_format_check',
    'slug_redirects_from_slug_format_check',
  ],
  title: ['revisions_title_length_check'],
  excerpt: ['revisions_excerpt_length_check'],
  body: ['revisions_body_length_check'],
  seoTitle: ['revisions_seo_title_length_check'],
  seoDescription: ['revisions_seo_description_length_check'],
  tagName: ['tags_name_length_check'],
  commentName: ['comments_name_length_check'],
  commentBody: ['comments_body_length_check'],
  mediaAlt: ['media_alt_length_check'],
};

describe('every length limit in the contract is the one Postgres enforces', () => {
  for (const [key, constraints] of Object.entries(LENGTH_CHECKS)) {
    for (const constraint of constraints) {
      it(`LIMITS.${key} (${String(LIMITS[key as keyof typeof LIMITS])}) = ${constraint}`, () => {
        expect(upperBound(constraint)).toBe(LIMITS[key as keyof typeof LIMITS]);
      });
    }
  }
});

describe('the slug format', () => {
  // JS spells the group (?:...), POSIX regex in Postgres spells it (...).
  const posix = SLUG_PATTERN.source.replace('(?:', '(');

  it.each([
    'posts_slug_format_check',
    'tags_slug_format_check',
    'slug_redirects_from_slug_format_check',
  ])('%s uses the contract pattern', (constraint) => {
    expect(constraintLine(constraint)).toContain(`~ '${posix}'`);
  });
});

describe('the enums are the contract lists, in order', () => {
  it('PostStatus', () => {
    expect(enumValues('PostStatus')).toEqual([...POST_STATUSES]);
  });
  it('CommentStatus', () => {
    expect(enumValues('CommentStatus')).toEqual([...COMMENT_STATUSES]);
  });
  it('Role', () => {
    expect(enumValues('Role')).toEqual([...ROLES]);
  });
});
