import { describe, expect, it } from 'vitest';

import {
  changesWhatReadersSee,
  commentParagraphs,
  moderateCommentSchema,
  normalizeCommentBody,
  normalizeCommentName,
  submitCommentSchema,
} from './comments';
import { COMMENT_STATUSES } from './content';
import { cacheTagSchema, commentsTag } from './revalidation';

// Expected values below were printed by running these functions, not typed from memory.
describe('normalizeCommentBody', () => {
  it('unifies line endings, drops control and direction-override characters, keeps one blank line', () => {
    expect(
      normalizeCommentBody('  Hello\r\nworld\t!  \r\n\r\n\r\n\r\nSecond\u202e para \u0007\n'),
    ).toBe('Hello\nworld !\n\nSecond para');
  });
});

describe('normalizeCommentName', () => {
  it('is one line with single spaces and no zero-width characters', () => {
    expect(normalizeCommentName('  Ada \n\t Lovelace\u200b ')).toBe('Ada Lovelace');
  });
});

describe('commentParagraphs', () => {
  it('splits on blank lines and keeps single line breaks inside a paragraph', () => {
    expect(commentParagraphs('One\nline two\n\nThree')).toEqual(['One\nline two', 'Three']);
  });
});

describe('submitCommentSchema', () => {
  const issues = (input: unknown) =>
    submitCommentSchema.safeParse(input).error?.issues.map((i) => [i.path.join('.'), i.message]);

  it('judges the text after normalizing it, so whitespace or invisible characters are not a comment', () => {
    expect(issues({ postSlug: 'a-b', name: '  ', body: 'x' })).toEqual([['name', 'Give a name.']]);
    expect(issues({ postSlug: 'a-b', name: 'A', body: ' \n\u0000 ' })).toEqual([
      ['body', 'Write a comment.'],
    ]);
  });

  it('holds the database limits', () => {
    expect(issues({ postSlug: 'a-b', name: 'n'.repeat(81), body: 'x' })?.[0]?.[0]).toBe('name');
    expect(issues({ postSlug: 'a-b', name: 'n', body: 'b'.repeat(2001) })?.[0]?.[0]).toBe('body');
    expect(
      issues({ postSlug: 'a-b', name: 'n'.repeat(80), body: 'b'.repeat(2000) }),
    ).toBeUndefined();
  });
});

describe('moderation', () => {
  it('refuses a no-op and any return to PENDING', () => {
    expect(moderateCommentSchema.safeParse({ from: 'APPROVED', to: 'APPROVED' }).success).toBe(
      false,
    );
    expect(moderateCommentSchema.safeParse({ from: 'APPROVED', to: 'PENDING' }).success).toBe(
      false,
    );
    expect(moderateCommentSchema.safeParse({ from: 'SPAM', to: 'APPROVED' }).success).toBe(true);
  });

  it('revalidates exactly when a comment enters or leaves the public block', () => {
    const changes = COMMENT_STATUSES.flatMap((from) =>
      (['APPROVED', 'REJECTED', 'SPAM'] as const)
        .filter((to) => to !== from)
        .filter((to) => changesWhatReadersSee(from, to))
        .map((to) => `${from}>${to}`),
    );
    expect(changes).toEqual([
      'PENDING>APPROVED',
      'APPROVED>REJECTED',
      'APPROVED>SPAM',
      'REJECTED>APPROVED',
      'SPAM>APPROVED',
    ]);
  });

  it('names the comments block with a tag the webhook accepts', () => {
    expect(commentsTag('hello-world')).toBe('comments:hello-world');
    expect(cacheTagSchema.safeParse(commentsTag('hello-world')).success).toBe(true);
    expect(cacheTagSchema.safeParse('comments:../x').success).toBe(false);
  });
});
