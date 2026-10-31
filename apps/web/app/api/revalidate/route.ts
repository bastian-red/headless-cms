/**
 * `POST /api/revalidate`: the publisher tells the site which cache tags a
 * change made stale. Signed (see `lib/revalidate.ts`), so nobody else can make
 * the site refetch.
 *
 * `revalidateTag(tag, { expire: 0 })` expires the tag at once: the next
 * request for the page waits for fresh content instead of being served the
 * stale copy while it refetches. A reader who opens a just-published post must
 * see it, and "published, but you might get the old page once" is the bug the
 * e2e publish test exists to catch. (`updateTag` would say the same thing but
 * is only allowed in server actions; it throws in a route handler.)
 */
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { REVALIDATION_SIGNATURE_HEADER } from '@cms/shared/server';

import { revalidateSecret } from '../../../lib/config';
import { handleRevalidation } from '../../../lib/revalidate';

export async function POST(request: Request): Promise<Response> {
  const outcome = handleRevalidation({
    secret: revalidateSecret(),
    signature: request.headers.get(REVALIDATION_SIGNATURE_HEADER),
    body: await request.text(),
    nowSeconds: Math.floor(Date.now() / 1000),
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  });

  if (outcome.status === 200) {
    console.info(
      JSON.stringify({ event: 'revalidated', eventId: outcome.eventId, tags: outcome.tags }),
    );
    return NextResponse.json(
      { revalidated: outcome.tags },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  console.warn(JSON.stringify({ event: 'revalidate_refused', reason: outcome.reason }));
  return NextResponse.json(
    { error: outcome.status === 401 ? 'unauthorized' : 'bad payload' },
    { status: outcome.status, headers: { 'cache-control': 'no-store' } },
  );
}
