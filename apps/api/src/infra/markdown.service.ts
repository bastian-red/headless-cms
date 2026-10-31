/**
 * `@cms/markdown`, from a CommonJS process.
 *
 * The package is ESM only, so it is loaded with `import()`, which TypeScript's
 * Node16 emit leaves as a real dynamic import (a `require` would throw
 * ERR_REQUIRE_ESM on a Node without require(esm)). Loaded once, on first use.
 *
 * Two jobs:
 *
 * - `check(body)`: the save-time gate. One long-lived `RenderChecker` per
 *   process (a worker thread with a deadline), so a save pays thread start-up
 *   once, not every time. A body that fails is a 422 in the posts service.
 * - `render(revisionId, body)`: the content API's `html`. Revisions are
 *   immutable, so a render is cached by revision id forever, in a bounded map;
 *   a new publish is a new id. Every body that reaches here passed `check`
 *   when it was saved (the seed's bodies are checked by @cms/markdown's own
 *   corpus test), so this render runs in-process.
 */
import { Injectable, type OnModuleDestroy } from '@nestjs/common';

// `resolution-mode`: a type import of an ESM package from a CommonJS file has
// to say it means the `import` condition.
type Markdown = typeof import('@cms/markdown', { with: { 'resolution-mode': 'import' } });
type MarkdownServer = typeof import('@cms/markdown/server', {
  with: { 'resolution-mode': 'import' },
});
export type RenderCheck = Awaited<
  ReturnType<InstanceType<MarkdownServer['RenderChecker']>['check']>
>;

export interface RenderedBody {
  readonly html: string;
  readonly outline: { depth: number; id: string; text: string }[];
  readonly words: number;
  readonly readingMinutes: number;
  /** The text a reader sees: the search index's input (step 5). */
  readonly text: string;
}

const CACHE_LIMIT = 500;

@Injectable()
export class MarkdownService implements OnModuleDestroy {
  private markdown: Promise<Markdown> | null = null;
  private checker: Promise<InstanceType<MarkdownServer['RenderChecker']>> | null = null;
  private readonly cache = new Map<string, RenderedBody>();

  async check(body: string): Promise<RenderCheck> {
    this.checker ??= import('@cms/markdown/server').then((m) => new m.RenderChecker());
    return (await this.checker).check(body);
  }

  async render(revisionId: string, body: string): Promise<RenderedBody> {
    const cached = this.cache.get(revisionId);
    if (cached !== undefined) return cached;

    this.markdown ??= import('@cms/markdown');
    const { render, renderHtml } = await this.markdown;
    const rendered = render(body);
    const result: RenderedBody = {
      html: renderHtml(rendered.tree),
      outline: rendered.outline.map((entry) => ({ ...entry })),
      words: rendered.words,
      readingMinutes: rendered.readingMinutes,
      text: rendered.text,
    };
    if (this.cache.size >= CACHE_LIMIT) {
      // Oldest first: a Map iterates in insertion order.
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(revisionId, result);
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.checker !== null) await (await this.checker).close();
  }
}
