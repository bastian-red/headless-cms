import type { Rendered } from '@cms/markdown';
import { toReact } from '@cms/markdown/react';

/**
 * A post's body as readers get it: the "In this post" outline when there
 * are at least three sections, then the prose. One component for the public
 * post page and the studio's preview, so the preview cannot drift from what
 * is published.
 */
export function ArticleBody({ rendered }: { rendered: Rendered }) {
  return (
    <>
      {rendered.outline.length >= 3 ? (
        <nav aria-label="In this post" className="post-outline">
          <h2 className="post-outline-title">In this post</h2>
          <ol role="list">
            {rendered.outline
              .filter((entry) => entry.depth === 2)
              .map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`}>{entry.text}</a>
                </li>
              ))}
          </ol>
        </nav>
      ) : null}
      <div className="prose">{toReact(rendered.tree)}</div>
    </>
  );
}
