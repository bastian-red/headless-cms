import { can, tagSchema } from '@cms/shared';
import Link from 'next/link';
import { z } from 'zod';

import { PostEditor } from '../../../../components/studio/post-editor';
import { RenameForm } from '../../../../components/studio/rename-form';
import { TagForm } from '../../../../components/studio/tag-form';
import { apiFetch } from '../../../../lib/api';
import { loadPost } from '../../../../lib/studio/load-post';
import { studioUser } from '../../../../lib/studio/me';

export const metadata = { title: 'Edit post' };

type Props = { params: Promise<{ id: string }> };

export default async function EditPostPage({ params }: Props) {
  const { id } = await params;
  const { session, me } = await studioUser(`/studio/posts/${id}`);
  const [post, tags] = await Promise.all([
    loadPost(session, id),
    apiFetch(session, '/studio/tags', z.array(tagSchema)),
  ]);

  return (
    <main id="main" className="studio-page studio-page-wide">
      <nav aria-label="Breadcrumb" className="breadcrumbs muted">
        <ol role="list">
          <li>
            <Link href="/studio">Posts</Link>
          </li>
          <li aria-current="page">{post.head.title}</li>
        </ol>
      </nav>
      <div className="studio-title-row">
        <h1>{post.head.title}</h1>
        <ul className="studio-links" role="list">
          <li>
            <Link href={`/studio/posts/${post.id}/preview`}>Preview as readers see it</Link>
          </li>
          <li>
            <Link href={`/studio/posts/${post.id}/history`}>
              History ({String(post.head.number)} revisions)
            </Link>
          </li>
        </ul>
      </div>
      <PostEditor
        key={post.id}
        post={post}
        tags={tags}
        aside={
          <>
            <RenameForm postId={post.id} slug={post.slug} live={post.live} />
            {can(me.role, 'tag.manage') ? <TagForm /> : null}
          </>
        }
      />
    </main>
  );
}
