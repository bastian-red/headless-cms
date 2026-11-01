'use client';

import { render } from '@cms/markdown';
import { LIMITS, MAX_TAGS_PER_REVISION, type StudioPost } from '@cms/shared';
import { useRouter } from 'next/navigation';
import {
  useActionState,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';

import { savePost, type SaveState } from '../../app/studio/actions';
import { ArticleBody } from '../article-body';
import { patchLines } from '../../lib/studio/patch';
import { sameValues, valuesOf, type PostValues } from '../../lib/studio/post-values';
import { Counter, FieldError } from './field';
import { useCodeMirror } from './use-codemirror';
import { useFocusFirstError } from './use-focus-first-error';
import { Workflow } from './workflow';

interface Tag {
  readonly slug: string;
  readonly name: string;
}

interface Props {
  readonly post: StudioPost;
  readonly tags: readonly Tag[];
  /** Side panels the page renders on the server (rename, new tag). */
  readonly aside?: ReactNode;
}

interface Base {
  readonly id: string;
  readonly number: number;
  readonly values: PostValues;
}

const baseOf = (post: StudioPost): Base => ({
  id: post.headRevisionId,
  number: post.head.number,
  values: valuesOf(post.head),
});

const FIELD_NAMES: Record<string, string> = {
  title: 'Title',
  excerpt: 'Excerpt',
  body: 'Body',
  seoTitle: 'Search title',
  seoDescription: 'Search description',
  tags: 'Tags',
};

/**
 * The post editor.
 *
 * - **A save never overwrites somebody else's.** It names the revision the
 *   editor started from (`baseRevisionId`); if another save landed first the
 *   API answers 409 with what changed, the panel shows the diff, and the
 *   person chooses: save theirs on top ("keep mine") or load the newer one.
 *   The base moves only on this person's own save or their choice to load,
 *   never because the page refreshed behind them.
 * - **What the preview shows is what readers get**: the same `render()` and
 *   `toReact()` the public post page uses, in the browser, on every edit.
 * - **Unsaved work is visible and guarded**: a status line, a warning before
 *   leaving, and the workflow buttons wait for a save, because a transition
 *   acts on the saved revision, not on what is in the editor.
 * - Ctrl/Cmd+S saves. Without JavaScript the form still posts, with a plain
 *   textarea for the body.
 */
export function PostEditor({ post, tags, aside }: Props) {
  const id = useId();
  const router = useRouter();
  const [state, action, pending] = useActionState<SaveState, FormData>(savePost, {
    kind: 'idle',
  });
  const [base, setBase] = useState<Base>(() => baseOf(post));
  const [values, setValues] = useState<PostValues>(() =>
    state.kind === 'error' || state.kind === 'stale' ? state.values : valuesOf(post.head),
  );
  const [loadingTheirs, setLoadingTheirs] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const submitted = useRef<PostValues | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const dirty = !sameValues(values, base.values);
  useFocusFirstError(form, state);

  const replaceBody = useCodeMirror({
    textarea: body,
    onChange: (next) => setValues((now) => ({ ...now, body: next })),
    label: 'Body, in markdown',
    describedBy: `${id}-body-hint`,
  });

  /** Make `next` both the base and what the fields hold. */
  const adopt = (next: Base) => {
    setBase(next);
    setValues(next.values);
    replaceBody(next.values.body);
  };

  // My own save moved the head: that is the new base. If nothing was typed
  // while it was in flight, take the API's normalised text too.
  useEffect(() => {
    if (state.kind !== 'saved' && state.kind !== 'unchanged') return;
    const next = baseOf(state.post);
    if (submitted.current !== null && sameValues(values, submitted.current)) adopt(next);
    else setBase(next);
    // Runs once per save result; `values` is read, not watched.
  }, [state]);

  // The page refreshed with a newer head (after a transition, or a rename).
  // Adopt it only when there is nothing of mine to lose.
  useEffect(() => {
    if (post.headRevisionId !== base.id && !dirty) adopt(baseOf(post));
    // `dirty` is read, not watched: typing must not trigger an adoption.
  }, [post.headRevisionId]);

  // "Load theirs": once the refresh it started has landed, take whatever the
  // page now holds, whatever is in the editor. The flag is cleared only
  // then; clearing it as the refresh starts left the newer revision unloaded.
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (!loadingTheirs || refreshing) return;
    adopt(baseOf(post));
    setLoadingTheirs(false);
  }, [loadingTheirs, refreshing, post]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        form.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', save);
    return () => window.removeEventListener('keydown', save);
  }, []);

  const set = (field: keyof Omit<PostValues, 'tags'>) => (event: { target: { value: string } }) =>
    setValues((now) => ({ ...now, [field]: event.target.value }));

  const toggleTag = (slug: string, on: boolean) =>
    setValues((now) => ({
      ...now,
      tags: on ? [...now.tags, slug] : now.tags.filter((tag) => tag !== slug),
    }));

  const onSubmit = (_event: FormEvent<HTMLFormElement>) => {
    submitted.current = values;
  };

  const deferredBody = useDeferredValue(values.body);
  const preview = useMemo(() => {
    try {
      return { ok: true as const, rendered: render(deferredBody) };
    } catch {
      return { ok: false as const };
    }
  }, [deferredBody]);

  const error = state.kind === 'error' ? state : null;
  const stale = state.kind === 'stale' && dirty ? state : null;
  const fieldError = (name: string) => error?.fields[name];
  const described = (name: string, ...more: string[]) => {
    const ids = [...more, ...(fieldError(name) === undefined ? [] : [`${id}-${name}-error`])];
    return ids.length === 0 ? undefined : ids.join(' ');
  };

  const statusLine = pending
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes.'
      : state.kind === 'saved'
        ? `Saved as revision ${String(base.number)}.`
        : state.kind === 'unchanged'
          ? 'Nothing had changed, so no revision was written.'
          : `Revision ${String(base.number)}, saved.`;

  return (
    <div className="editor">
      <form
        ref={form}
        action={action}
        onSubmit={onSubmit}
        className="editor-form"
        aria-labelledby={`${id}-heading`}
        noValidate
      >
        <h2 id={`${id}-heading`} className="visually-hidden">
          Edit the post
        </h2>
        <input type="hidden" name="postId" value={post.id} />
        <input type="hidden" name="baseRevisionId" value={base.id} />

        <div className="editor-bar">
          <p className="editor-state" role="status" data-dirty={dirty ? 'true' : undefined}>
            <span aria-hidden="true">{dirty ? '● ' : '✓ '}</span>
            {statusLine}
          </p>
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <span className="muted editor-shortcut">or Ctrl+S</span>
        </div>

        {error === null ? null : (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}

        {stale === null ? null : (
          <section className="panel stale" aria-labelledby={`${id}-stale`} role="alert">
            <h3 id={`${id}-stale`}>Somebody saved first</h3>
            <p>{stale.message}</p>
            <p>
              They changed:{' '}
              {stale.details.changed.length === 0
                ? 'nothing you can see.'
                : stale.details.changed.map((f) => FIELD_NAMES[f] ?? f).join(', ')}
              .
            </p>
            {stale.details.bodyPatch === '' ? null : (
              <details>
                <summary>What they changed in the body</summary>
                <ol className="patch" role="list" aria-label="Their changes to the body">
                  {patchLines(stale.details.bodyPatch).map((line, i) => (
                    <li key={i} className="patch-line" data-kind={line.kind}>
                      <span className="patch-sign" aria-hidden="true">
                        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                      </span>
                      {line.kind === 'added' ? (
                        <span className="visually-hidden">added: </span>
                      ) : line.kind === 'removed' ? (
                        <span className="visually-hidden">removed: </span>
                      ) : null}
                      <span className="patch-text">{line.text === '' ? ' ' : line.text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <input type="hidden" name="rebaseOnto" value={stale.details.current.id} />
            <div className="stale-actions">
              <button className="button" type="submit" name="intent" value="keep-mine">
                Save mine on top of revision {String(stale.details.current.number)}
              </button>
              <a
                className="button"
                href={`/studio/posts/${post.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  setLoadingTheirs(true);
                  startRefresh(() => router.refresh());
                }}
              >
                Discard mine and load theirs
              </a>
            </div>
          </section>
        )}

        <div className="field">
          <div className="field-label-row">
            <label htmlFor={`${id}-title`}>Title</label>
            <Counter id={`${id}-title-count`} used={values.title.length} max={LIMITS.title} />
          </div>
          <input
            id={`${id}-title`}
            className="field-input editor-title"
            name="title"
            autoComplete="off"
            required
            maxLength={LIMITS.title}
            value={values.title}
            onChange={set('title')}
            aria-invalid={fieldError('title') === undefined ? undefined : true}
            aria-describedby={described('title', `${id}-title-count`)}
          />
          <FieldError id={`${id}-title-error`} message={fieldError('title')} />
        </div>

        <div className="field">
          <div className="field-label-row">
            <label htmlFor={`${id}-excerpt`}>Excerpt</label>
            <Counter id={`${id}-excerpt-count`} used={values.excerpt.length} max={LIMITS.excerpt} />
          </div>
          <textarea
            id={`${id}-excerpt`}
            className="field-input"
            name="excerpt"
            autoComplete="off"
            rows={2}
            maxLength={LIMITS.excerpt}
            value={values.excerpt}
            onChange={set('excerpt')}
            aria-invalid={fieldError('excerpt') === undefined ? undefined : true}
            aria-describedby={described('excerpt', `${id}-excerpt-hint`, `${id}-excerpt-count`)}
          />
          <span id={`${id}-excerpt-hint`} className="field-hint">
            One or two sentences under the title in lists, feeds and search results. Needed to
            publish.
          </span>
          <FieldError id={`${id}-excerpt-error`} message={fieldError('excerpt')} />
        </div>

        <div className="editor-split" data-tab={tab}>
          <div className="editor-tabs" role="tablist" aria-label="Show the body or its preview">
            <button
              type="button"
              role="tab"
              id={`${id}-tab-write`}
              aria-selected={tab === 'write'}
              aria-controls={`${id}-panel-write`}
              onClick={() => setTab('write')}
            >
              Write
            </button>
            <button
              type="button"
              role="tab"
              id={`${id}-tab-preview`}
              aria-selected={tab === 'preview'}
              aria-controls={`${id}-panel-preview`}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
          </div>
          <div
            className="editor-pane editor-write"
            id={`${id}-panel-write`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-write`}
          >
            <label htmlFor={`${id}-body`} className="editor-pane-title">
              Body
            </label>
            <span id={`${id}-body-hint`} className="field-hint">
              Markdown: ## for a section, **bold**, [a link](https://…), - for a list.
            </span>
            <textarea
              ref={body}
              id={`${id}-body`}
              className="field-input editor-body"
              name="body"
              rows={24}
              maxLength={LIMITS.body}
              value={values.body}
              onChange={set('body')}
              aria-describedby={`${id}-body-hint`}
            />
          </div>
          <section
            className="editor-pane editor-preview"
            id={`${id}-panel-preview`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-preview`}
            data-testid="preview"
          >
            <h3 className="editor-pane-title">Preview</h3>
            <article className="post editor-preview-article">
              {preview.ok ? (
                <ArticleBody
                  rendered={preview.rendered}
                  header={<h1 className="editor-preview-title">{values.title || 'Untitled'}</h1>}
                />
              ) : (
                <>
                  <h1 className="editor-preview-title">{values.title || 'Untitled'}</h1>
                  <p className="form-error">
                    <span aria-hidden="true">⚠ </span>
                    This text cannot be rendered safely. Saving it will be refused.
                  </p>
                </>
              )}
            </article>
          </section>
        </div>

        <fieldset className="field editor-tags">
          <legend>
            Tags{' '}
            <span className="muted">
              ({String(values.tags.length)} of at most {String(MAX_TAGS_PER_REVISION)})
            </span>
          </legend>
          {tags.length === 0 ? <p className="muted">No tags exist yet.</p> : null}
          <ul role="list" className="editor-tag-list">
            {tags.map((tag) => {
              const on = values.tags.includes(tag.slug);
              return (
                <li key={tag.slug}>
                  <label>
                    <input
                      type="checkbox"
                      name="tags"
                      value={tag.slug}
                      checked={on}
                      disabled={!on && values.tags.length >= MAX_TAGS_PER_REVISION}
                      onChange={(event) => toggleTag(tag.slug, event.target.checked)}
                    />{' '}
                    {tag.name}
                  </label>
                </li>
              );
            })}
          </ul>
          <FieldError id={`${id}-tags-error`} message={fieldError('tags')} />
        </fieldset>

        <details
          className="editor-seo"
          open={values.seoTitle !== '' || values.seoDescription !== ''}
        >
          <summary>Search and sharing (optional)</summary>
          <div className="field">
            <div className="field-label-row">
              <label htmlFor={`${id}-seoTitle`}>Search title</label>
              <Counter
                id={`${id}-seoTitle-count`}
                used={values.seoTitle.length}
                max={LIMITS.seoTitle}
              />
            </div>
            <input
              id={`${id}-seoTitle`}
              className="field-input"
              name="seoTitle"
              autoComplete="off"
              maxLength={LIMITS.seoTitle}
              value={values.seoTitle}
              onChange={set('seoTitle')}
              placeholder="The title, if left empty…"
              aria-describedby={described('seoTitle', `${id}-seoTitle-count`)}
            />
            <FieldError id={`${id}-seoTitle-error`} message={fieldError('seoTitle')} />
          </div>
          <div className="field">
            <div className="field-label-row">
              <label htmlFor={`${id}-seoDescription`}>Search description</label>
              <Counter
                id={`${id}-seoDescription-count`}
                used={values.seoDescription.length}
                max={LIMITS.seoDescription}
              />
            </div>
            <textarea
              id={`${id}-seoDescription`}
              className="field-input"
              name="seoDescription"
              autoComplete="off"
              rows={2}
              maxLength={LIMITS.seoDescription}
              value={values.seoDescription}
              onChange={set('seoDescription')}
              placeholder="The excerpt, if left empty…"
              aria-describedby={described('seoDescription', `${id}-seoDescription-count`)}
            />
            <FieldError id={`${id}-seoDescription-error`} message={fieldError('seoDescription')} />
          </div>
        </details>
      </form>

      <aside className="editor-aside" aria-label="Publishing">
        <Workflow post={post} revisionId={base.id} dirty={dirty} />
        {aside}
      </aside>
    </div>
  );
}
