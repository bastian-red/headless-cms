import { can, idSchema, revisionSchema, revisionSummarySchema } from '@cms/shared';
import Link from 'next/link';
import { z } from 'zod';

import { RestoreForm } from '../../../../../components/studio/restore-form';
import { When } from '../../../../../components/studio/when';
import { apiFetch, query } from '../../../../../lib/api';
import { loadPost } from '../../../../../lib/studio/load-post';
import { studioUser } from '../../../../../lib/studio/me';
import { diffRevisions, type Part } from '../../../../../lib/studio/revision-diff';

export const metadata = { title: 'History' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string }>;
};

function Parts({ parts, block }: { parts: readonly Part[]; block: boolean }) {
  const Tag = block ? 'pre' : 'p';
  return (
    <Tag className={block ? 'diff diff-block' : 'diff'}>
      {parts.map((part, i) =>
        part.kind === 'added' ? (
          <ins key={i}>
            <span className="visually-hidden">[added: </span>
            {part.value}
            <span className="visually-hidden">]</span>
          </ins>
        ) : part.kind === 'removed' ? (
          <del key={i}>
            <span className="visually-hidden">[removed: </span>
            {part.value}
            <span className="visually-hidden">]</span>
          </del>
        ) : part.kind === 'fold' ? (
          <span key={i} className="diff-fold">
            {`… ${part.value} unchanged ${part.value === '1' ? 'line' : 'lines'} …\n`}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </Tag>
  );
}

/**
 * Every revision of a post, newest first. Choosing one compares it with the
 * current head, field by field; restoring writes a NEW head with its content,
 * so nothing in this list ever disappears.
 */
export default async function HistoryPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { compare } = await searchParams;
  const { session, me } = await studioUser(`/studio/posts/${id}/history${query({ compare })}`);
  const post = await loadPost(session, id);
  const revisions = await apiFetch(
    session,
    `/studio/posts/${post.id}/revisions`,
    z.array(revisionSummarySchema),
  );
  const chosen =
    compare !== undefined && idSchema.safeParse(compare).success && compare !== post.headRevisionId
      ? revisions.find((r) => r.id === compare)
      : undefined;
  const older =
    chosen === undefined
      ? null
      : await apiFetch(session, `/studio/posts/${post.id}/revisions/${chosen.id}`, revisionSchema);
  const diffs = older === null ? [] : diffRevisions(older, post.head);
  const mayRestore = can(me.role, 'post.restore');

  return (
    <main id="main" className="studio-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs muted">
        <ol role="list">
          <li>
            <Link href="/studio">Posts</Link>
          </li>
          <li>
            <Link href={`/studio/posts/${post.id}`}>{post.head.title}</Link>
          </li>
          <li aria-current="page">History</li>
        </ol>
      </nav>
      <h1>History</h1>
      <p className="muted">
        Revisions are never edited or deleted. Restoring one saves its content as a new revision.
      </p>

      {older === null || chosen === undefined ? null : (
        <section className="panel" aria-labelledby="compare-title">
          <h2 id="compare-title">
            Revision {String(chosen.number)} → current (revision {String(post.head.number)})
          </h2>
          {diffs.every((d) => !d.changed) ? (
            <p>The two revisions have the same content.</p>
          ) : (
            <dl className="diff-list">
              {diffs
                .filter((d) => d.changed)
                .map((d) => (
                  <div key={d.field} className="diff-field">
                    <dt>{d.label}</dt>
                    <dd>
                      {d.parts.length === 0 ? (
                        <p className="muted">Empty in both.</p>
                      ) : (
                        <Parts parts={d.parts} block={d.field === 'body'} />
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          <p className="muted">
            Unchanged:{' '}
            {diffs
              .filter((d) => !d.changed)
              .map((d) => d.label)
              .join(', ') || 'nothing'}
            .
          </p>
          {mayRestore ? (
            <RestoreForm
              postId={post.id}
              revisionId={chosen.id}
              number={chosen.number}
              baseRevisionId={post.headRevisionId}
            />
          ) : (
            <p className="muted">An editor can restore this revision.</p>
          )}
        </section>
      )}

      <table className="table history">
        <caption className="visually-hidden">Revisions, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Revision</th>
            <th scope="col">Title</th>
            <th scope="col">By</th>
            <th scope="col">Saved</th>
            <th scope="col">
              <span className="visually-hidden">Compare</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {revisions.map((r) => (
            <tr key={r.id} aria-current={r.id === chosen?.id ? 'true' : undefined}>
              <td data-label="Revision">
                {String(r.number)}
                {r.isHead ? <span className="muted"> · current</span> : null}
                {r.isPublished ? (
                  <span className="muted">
                    {' '}
                    · <span aria-hidden="true">● </span>readers see this
                  </span>
                ) : null}
                {r.restoredFromId === null ? null : (
                  <span className="muted">
                    {' '}
                    · restored from revision{' '}
                    {String(revisions.find((x) => x.id === r.restoredFromId)?.number ?? '?')}
                  </span>
                )}
              </td>
              <td data-label="Title">{r.title}</td>
              <td data-label="By">{r.author.name}</td>
              <td data-label="Saved">
                <When instant={r.createdAt} />
              </td>
              <td data-label="Compare">
                {r.isHead ? null : (
                  <Link
                    href={`/studio/posts/${post.id}/history?compare=${r.id}`}
                    aria-label={`Compare revision ${String(r.number)} with the current one`}
                  >
                    Compare
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
