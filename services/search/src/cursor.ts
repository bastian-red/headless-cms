/**
 * Keyset cursors for ranked results.
 *
 * Results are ordered by (title hit, rank, published at, id), all descending,
 * and a cursor is that key for the last hit on a page. Keyset rather than
 * OFFSET for the same reason as `/v1/posts`: a post published while a reader
 * pages through results would shift an offset and show a hit twice.
 *
 * `rank` is Postgres `real` (float4). It reaches JavaScript as the exact
 * double of that float, survives JSON exactly, and is cast back with
 * `::real`, so the comparison resumes on the very row it stopped at.
 *
 * A cursor belongs to one query. It carries a hash of the query it was issued
 * for, and replaying it with another query is a 400 rather than a page of
 * somebody else's results.
 */
import { createHash } from 'node:crypto';

import { DomainError, idSchema } from '@cms/shared';
import { z } from 'zod';

export interface SearchCursor {
  readonly titleHit: 0 | 1;
  readonly rank: number;
  readonly publishedAt: Date;
  readonly id: string;
}

const wire = z.object({
  h: z.union([z.literal(0), z.literal(1)]),
  r: z.number().finite().nonnegative(),
  t: z.string().datetime(),
  i: idSchema,
  q: z.string(),
});

export const queryKey = (query: string): string =>
  createHash('sha256').update(query, 'utf8').digest('base64url').slice(0, 16);

export function encodeSearchCursor(cursor: SearchCursor, query: string): string {
  const body = {
    h: cursor.titleHit,
    r: cursor.rank,
    t: cursor.publishedAt.toISOString(),
    i: cursor.id,
    q: queryKey(query),
  };
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

export function decodeSearchCursor(value: string, query: string): SearchCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const result = wire.safeParse(parsed);
  if (!result.success || result.data.q !== queryKey(query)) throw invalid();
  const { h, r, t, i } = result.data;
  return { titleHit: h, rank: r, publishedAt: new Date(t), id: i };
}

function invalid(): DomainError {
  return new DomainError('INVALID', 'That cursor is not one this API issued for this query.');
}
