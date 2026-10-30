# @cms/markdown

The one markdown renderer. Studio preview, post page, RSS feed and search index all go through
`render()`, so they cannot disagree about what a body says or what it is allowed to do.

```ts
import { render, renderHtml } from '@cms/markdown';
import { toReact } from '@cms/markdown/react';
import { checkRenderable } from '@cms/markdown/server';

const { tree, outline, text, words, readingMinutes } = render(body);
toReact(tree, { a: Link });                    // page and preview: React elements
renderHtml(render(body, { base: postUrl }).tree); // feed: HTML with absolute URLs
await checkRenderable(body);                   // before saving: { ok } or { ok: false, reason }
```

| Entry | Runs in | For |
|---|---|---|
| `@cms/markdown` | browser and server | `render`, `renderHtml`, the audit and the policy |
| `@cms/markdown/react` | browser and server | `toReact` (needs `react` as a peer) |
| `@cms/markdown/server` | Node only | `checkRenderable`: the render in a worker thread, under a deadline |

ESM only, because the unified ecosystem is. The CommonJS API loads it with
`await import('@cms/markdown')`.

## What it guarantees, and the test that holds each

| Guarantee | Test |
|---|---|
| No element outside the markdown vocabulary, no event handler, no style, no `name`, no URL outside `http`/`https`/`mailto` (images: `http`/`https`) | `sanitize.test.ts`: 46 vectors, a property test, the seeded hostile post |
| A sanitizer regression fails the render instead of reaching a reader | `render.test.ts` "fail closed"; removing `rehype-sanitize` makes 35 tests fail |
| The serialized HTML parses back to the same tree (no mutation XSS) | `sanitize.test.ts` `assertInert` |
| Page/preview (React) and feed (HTML) produce the same document | `surfaces.test.ts`, all 41 seeded bodies plus every vector |
| No id can shadow a global the page's script reads | `render.test.ts` headings, `sanitize.test.ts` audit cases |
| Footnote links point at ids that exist | `render.test.ts` footnotes, `surfaces.test.ts` |
| A body that renders slowly or crashes the parser is stopped at a deadline | `server.test.ts` |
| Browser entry points import nothing from Node | `surfaces.test.ts` |

`src/server.test.ts` runs against `dist/` (the file `new Worker()` actually loads), so turbo builds
this package before testing it. Run `FUZZ_RUNS=6000 FUZZ_SEED=<n> pnpm vitest run -t random` for a
longer property run than the gate's 150 cases.
