import { render } from '@cms/markdown';
import Link from 'next/link';

import { ArticleBody } from '../../../../../components/article-body';
import { Status } from '../../../../../components/studio/status';
import { loadPost } from '../../../../../lib/studio/load-post';
import { studioUser } from '../../../../../lib/studio/me';

export const metadata = { title: 'Preview', robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * The saved head revision in the public article's own body component, for
 * the person who has to decide whether it is ready. Behind sign-in, never
 * cached (the studio is dynamic), and `noindex` besides.
 */
export default async function PreviewPage({ params }: Props) {
  const { id } = await params;
  const { session } = await studioUser(`/studio/posts/${id}/preview`);
  const post = await loadPost(session, id);
  const rendered = render(post.head.body);

  return (
    <div data-surface="read">
      <p className="preview-banner" role="note">
        <span aria-hidden="true">◐ </span>
        Preview of revision {String(post.head.number)} (<Status status={post.status} />
        ).{' '}
        {post.status === 'PUBLISHED'
          ? 'This is what readers see.'
          : 'Readers do not see this yet.'}{' '}
        <Link href={`/studio/posts/${post.id}`}>Back to the editor</Link>
      </p>
      <main id="main" className="page page-sheet">
        <article className="post">
          <ArticleBody
            rendered={rendered}
            header={
              <header className="post-header">
                <h1>{post.head.title}</h1>
                <p className="byline">By {post.author.name}</p>
                {post.head.excerpt === '' ? null : (
                  <p className="post-excerpt">{post.head.excerpt}</p>
                )}
              </header>
            }
          />
        </article>
      </main>
    </div>
  );
}
