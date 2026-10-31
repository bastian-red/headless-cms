import { ImageResponse } from 'next/og';

import { contentAtBuild } from '../../../../../lib/config';
import { longDate } from '../../../../../lib/dates';
import { allPosts, postBySlug } from '../../../../../lib/content';
import { CARD, SITE } from '../../../../../lib/seo';

/**
 * The social card for one post (`og:image`, `twitter:image` and the JSON-LD
 * `image`), prerendered with the page and revalidated by the same
 * `post:<slug>` tag. A route handler rather than `opengraph-image.tsx`: that
 * convention serves under a hashed name, and the JSON-LD needs to name the
 * same address the meta tags do. The title is the card: an editor's question
 * is "what will the world see?", and this is it.
 *
 * Placeholder greys and the built-in face until the design step picks the
 * identity; the layout (publication, title, byline) is the part that stays.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  if (contentAtBuild === 'deferred') return [];
  return (await allPosts()).map((post) => ({ slug: post.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await postBySlug((await params).slug);
  if (found.kind !== 'post') return new Response('Not found', { status: 404 });
  const title = found.post.title;
  const byline = `${found.post.author.name} · ${longDate(found.post.publishedAt)}`;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 80,
        background: '#f4f4f2',
        color: '#1c1c1a',
      }}
    >
      <div style={{ fontSize: 36, color: '#5c5c58' }}>{SITE.name}</div>
      <div
        style={{
          fontSize: title.length > 60 ? 64 : 80,
          lineHeight: 1.1,
          display: 'flex',
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 32, color: '#5c5c58' }}>{byline}</div>
    </div>,
    { width: CARD.width, height: CARD.height },
  );
}
