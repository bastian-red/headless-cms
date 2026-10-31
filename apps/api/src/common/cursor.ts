/**
 * Keyset pagination cursors.
 *
 * A cursor is the sort key of the last row a page returned: a timestamp and an
 * id, the id breaking ties between rows written in the same millisecond.
 * Keyset, not OFFSET: a post published while a reader pages through the list
 * would shift an offset by one and show a row twice; a keyset cursor resumes
 * after the row it names, whatever was inserted above it.
 *
 * Opaque to clients (base64url JSON), and parsed strictly: a forged or
 * truncated cursor is a 400, never a query on garbage.
 */
import { DomainError, idSchema } from '@cms/shared';
import { z } from 'zod';

export interface Cursor {
  readonly at: Date;
  readonly id: string;
}

const wire = z.object({ t: z.string().datetime(), i: idSchema });

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.at.toISOString(), i: cursor.id })).toString(
    'base64url',
  );
}

export function decodeCursor(value: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const result = wire.safeParse(parsed);
  if (!result.success) throw invalid();
  return { at: new Date(result.data.t), id: result.data.i };
}

function invalid(): DomainError {
  return new DomainError('INVALID', 'That cursor is not one this API issued.');
}

/**
 * The page and the next cursor from `limit + 1` rows: the extra row only
 * proves there is a next page and is never returned.
 */
export function page<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => Cursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}
