/**
 * The demo publication, Quire: a small journal about how pages get made and
 * read. Forty posts, in every workflow state the product has.
 *
 * Bodies live beside this file as `posts/<slug>.md` (markdown only; the title
 * is not repeated in the body, because the page renders it as the h1). A
 * pending revision of a live post is `posts/<slug>.draft.md`.
 *
 * Everything here is fixed data. The seed derives ids from these keys and
 * takes every date from this file, so two runs write the same rows. The one
 * exception is the scheduled post, whose time must be in the future to be a
 * schedule at all; `scripts/seed-check.mjs` digests everything else.
 */

export type Person = 'ines' | 'tomas' | 'mara';

/** A reader's comment, in any moderation state. */
export interface CommentSeed {
  name: string;
  body: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM';
  at: string;
}

export interface PostSeed {
  slug: string;
  title: string;
  excerpt: string;
  tags: readonly string[];
  author: Person;
  /**
   * - `live`: published, nothing pending.
   * - `live-with-draft`: published, with a newer revision (`<slug>.draft.md`)
   *   readers must not see.
   * - `draft`, `in-review`, `scheduled`: never published.
   * - `unpublished`: was live, taken down.
   */
  state: 'live' | 'live-with-draft' | 'draft' | 'in-review' | 'scheduled' | 'unpublished';
  /** First publication (or, for never-published posts, creation). */
  date: string;
  /**
   * Earlier revisions before the current one, oldest first. Each one is the
   * current body without its last `count` sections, so a history view has real
   * differences to show.
   */
  history?: readonly { title: string; trimSections: number }[];
  seoTitle?: string;
  seoDescription?: string;
  /** Older slugs that now answer with a 308 to this post. */
  formerSlugs?: readonly string[];
  /** For `live-with-draft`: the pending revision's metadata. */
  draft?: { title: string; excerpt: string; tags: readonly string[]; seoDescription?: string };
  comments?: readonly CommentSeed[];
}

export interface TagSeed {
  slug: string;
  name: string;
  description: string;
}

/**
 * A word that appears in no real text, written into every row readers must
 * never see: pending revisions, unpublished posts, unmoderated comments. Any
 * public surface (page, feed, sitemap, content API, search, the build output)
 * containing it is a leak. One lowercase token, so full-text search indexes it
 * as a single lexeme and a plain grep finds it in HTML.
 */
export const DRAFT_CANARY = 'unpublishedwrenfeather';
export const COMMENT_CANARY = 'pendingmothwing';

export const TAGS: readonly TagSeed[] = [
  { slug: 'rendering', name: 'Rendering', description: 'Static, server and everything between.' },
  {
    slug: 'caching',
    name: 'Caching',
    description: 'Keeping pages fast without keeping them stale.',
  },
  { slug: 'typography', name: 'Typography', description: 'Type, measure and the shape of a page.' },
  { slug: 'performance', name: 'Performance', description: 'What a reader waits for, and why.' },
  { slug: 'search', name: 'Search', description: 'Finding things, inside the site and out.' },
  { slug: 'seo', name: 'SEO', description: 'Being understood by the machines that send readers.' },
  {
    slug: 'accessibility',
    name: 'Accessibility',
    description: 'Pages that work for everyone who arrives.',
  },
  {
    slug: 'markdown',
    name: 'Markdown',
    description: 'Writing in plain text and trusting the pipeline.',
  },
  { slug: 'publishing', name: 'Publishing', description: 'Review, schedule, publish, correct.' },
  // Used only by revisions readers cannot see. A public tag list that shows it
  // is listing tags of unpublished work.
  { slug: 'unannounced', name: 'Unannounced', description: `Work in progress (${DRAFT_CANARY}).` },
];

export const LONG_FORM_SLUG = 'the-long-way-to-a-fast-page';
export const HOSTILE_SLUG = 'we-never-render-raw-html';
export const RENAMED_SLUG = 'what-happens-to-a-link-when-a-title-changes';
export const RENAMED_FROM = 'links-and-renamed-titles';
export const LIVE_WITH_DRAFT_SLUG = 'caching-at-the-edge-a-year-in';

export const POSTS: readonly PostSeed[] = [
  {
    slug: LONG_FORM_SLUG,
    title: 'The long way to a fast page',
    excerpt:
      'A blog post is the simplest page on the web, and it still takes a dozen decisions to make one load before the reader notices. Here is every one of ours.',
    tags: ['rendering', 'performance', 'caching'],
    author: 'mara',
    state: 'live',
    date: '2026-10-20T08:00:00.000Z',
    history: [
      { title: 'The long way to a fast page (outline)', trimSections: 6 },
      { title: 'The long way to a fast page', trimSections: 2 },
    ],
    seoTitle: 'The long way to a fast page: rendering a blog post',
    seoDescription:
      'Static rendering, tag-based revalidation, fonts, images and the measure: every decision behind a post that loads before the reader notices.',
    comments: [
      {
        name: 'Hollis',
        body: 'The section on fonts is the clearest explanation of size-adjust I have read. Bookmarked.',
        status: 'APPROVED',
        at: '2026-10-20T14:12:00.000Z',
      },
      {
        name: 'Paz',
        body: 'Would love a follow-up on how you test the revalidation timing in CI.',
        status: 'APPROVED',
        at: '2026-10-21T09:40:00.000Z',
      },
      {
        name: 'Drive-by',
        body: `Great post, check out my site for cheap followers ${COMMENT_CANARY}`,
        status: 'SPAM',
        at: '2026-10-21T10:02:00.000Z',
      },
      {
        name: 'Ren',
        body: `First! (${COMMENT_CANARY}) Still waiting for a moderator, as it should.`,
        status: 'PENDING',
        at: '2026-10-22T07:30:00.000Z',
      },
    ],
  },
  {
    slug: 'why-we-render-static-first',
    title: 'Why we render static first',
    excerpt:
      'A page that is already built cannot be slow to build. Everything else is a trade we make on purpose.',
    tags: ['rendering'],
    author: 'tomas',
    state: 'live',
    date: '2026-01-08T09:00:00.000Z',
  },
  {
    slug: 'tags-are-cache-keys',
    title: 'Tags are cache keys, not categories',
    excerpt:
      'The same word does two jobs in our stack. Keeping them apart is what makes publishing instant.',
    tags: ['caching', 'rendering'],
    author: 'tomas',
    state: 'live',
    date: '2026-01-15T09:00:00.000Z',
  },
  {
    slug: 'a-measure-for-reading',
    title: 'A measure for reading',
    excerpt:
      'Why a line of body text stops at about sixty-six characters, and what happens when it does not.',
    tags: ['typography'],
    author: 'mara',
    state: 'live',
    date: '2026-01-22T09:00:00.000Z',
    history: [{ title: 'Measure', trimSections: 1 }],
  },
  {
    slug: 'writing-a-colophon',
    title: 'Writing a colophon',
    excerpt: 'The last page of a book says how it was made. A website can keep the habit.',
    tags: ['typography', 'publishing'],
    author: 'ines',
    state: 'live',
    date: '2026-01-29T09:00:00.000Z',
  },
  {
    slug: 'revisions-not-versions',
    title: 'Revisions, not versions',
    excerpt:
      'Our history is append-only. Restoring an old draft writes a new revision; nothing is ever rewritten.',
    tags: ['publishing'],
    author: 'tomas',
    state: 'live',
    date: '2026-02-05T09:00:00.000Z',
  },
  {
    slug: 'the-review-step-is-a-feature',
    title: 'The review step is a feature',
    excerpt:
      'An author cannot publish. That is not distrust; it is how a second pair of eyes becomes a habit.',
    tags: ['publishing'],
    author: 'ines',
    state: 'live',
    date: '2026-02-12T09:00:00.000Z',
  },
  {
    slug: 'markdown-is-the-source',
    title: 'Markdown is the source of truth',
    excerpt:
      'We store what the author typed, never the HTML it became. The renderer can improve; the text stays put.',
    tags: ['markdown'],
    author: 'mara',
    state: 'live',
    date: '2026-02-19T09:00:00.000Z',
  },
  {
    slug: 'footnotes-done-right',
    title: 'Footnotes done right',
    excerpt:
      'A footnote should be one tap away and one tap back. Most of them on the web are neither.',
    tags: ['markdown', 'typography'],
    author: 'mara',
    state: 'live',
    date: '2026-02-26T09:00:00.000Z',
    comments: [
      {
        name: 'Ayo',
        body: 'The back-link detail is the part everyone forgets. Thanks for spelling it out.',
        status: 'APPROVED',
        at: '2026-02-27T11:20:00.000Z',
      },
    ],
  },
  {
    slug: 'tables-on-a-phone',
    title: 'Tables on a phone',
    excerpt:
      'A table is the right tool for tabular data, even at 390 pixels wide. It just needs to be allowed to scroll.',
    tags: ['markdown', 'accessibility'],
    author: 'mara',
    state: 'live',
    date: '2026-03-05T09:00:00.000Z',
  },
  {
    slug: 'alt-text-is-writing',
    title: 'Alt text is writing, not metadata',
    excerpt:
      'Our editor will not publish an image without a text alternative. Here is how we ask authors to write one.',
    tags: ['accessibility'],
    author: 'ines',
    state: 'live',
    date: '2026-03-12T09:00:00.000Z',
  },
  {
    slug: 'headings-are-navigation',
    title: 'Headings are navigation',
    excerpt:
      'Screen reader users jump between headings the way sighted readers skim. A skipped level is a missing step.',
    tags: ['accessibility', 'seo'],
    author: 'mara',
    state: 'live',
    date: '2026-03-19T09:00:00.000Z',
  },
  {
    slug: 'one-page-one-canonical-url',
    title: 'One page, one canonical URL',
    excerpt:
      'Trailing slashes, query strings and old slugs all name the same post. Only one of them should be its name.',
    tags: ['seo'],
    author: 'tomas',
    state: 'live',
    date: '2026-03-26T09:00:00.000Z',
  },
  {
    slug: 'sitemaps-that-tell-the-truth',
    title: 'Sitemaps that tell the truth about lastmod',
    excerpt:
      'A sitemap that says every page changed today teaches crawlers to ignore it. Ours reports the revision time.',
    tags: ['seo'],
    author: 'tomas',
    state: 'live',
    date: '2026-04-02T09:00:00.000Z',
  },
  {
    slug: 'rss-is-a-front-door',
    title: "RSS is a reading app's front door",
    excerpt:
      'Some readers will only ever see the feed. The feed entry should be the whole post, sanitized like the page.',
    tags: ['publishing', 'seo'],
    author: 'ines',
    state: 'live',
    date: '2026-04-09T09:00:00.000Z',
  },
  {
    slug: 'structured-data-without-the-cargo-cult',
    title: 'Structured data without the cargo cult',
    excerpt:
      'Two JSON-LD types cover a blog post. Everything else we have seen pasted into a head tag was decoration.',
    tags: ['seo'],
    author: 'tomas',
    state: 'live',
    date: '2026-04-16T09:00:00.000Z',
  },
  {
    slug: 'search-with-the-database-you-have',
    title: 'Search with the database you already have',
    excerpt:
      'Postgres ranks, stems and highlights. For a publication of a few thousand posts, that is the whole search stack.',
    tags: ['search'],
    author: 'tomas',
    state: 'live',
    date: '2026-04-23T09:00:00.000Z',
  },
  {
    slug: 'why-a-title-match-should-win',
    title: 'Why a title match should win',
    excerpt:
      'When a word is in the title, the post is about it. When it is in paragraph nine, the post mentions it.',
    tags: ['search'],
    author: 'mara',
    state: 'live',
    date: '2026-04-30T09:00:00.000Z',
  },
  {
    slug: 'snippets-that-show-why',
    title: 'Snippets that show why a result matched',
    excerpt:
      'A search result that hides the matching words makes the reader open it to find out. Show them instead.',
    tags: ['search'],
    author: 'mara',
    state: 'live',
    date: '2026-05-07T09:00:00.000Z',
  },
  {
    slug: 'stale-while-revalidate-with-a-newspaper',
    title: 'Stale while revalidate, explained with a newspaper',
    excerpt:
      'The paper on the doorstep is already printed. The next edition is being set. Both are true at once.',
    tags: ['caching'],
    author: 'tomas',
    state: 'live',
    date: '2026-05-14T09:00:00.000Z',
  },
  {
    slug: 'the-outbox',
    title: 'The outbox: publishing that survives a crash',
    excerpt:
      'Writing the post and announcing it happen in one transaction. Delivering the announcement can be retried.',
    tags: ['publishing', 'caching'],
    author: 'tomas',
    state: 'live',
    date: '2026-05-21T09:00:00.000Z',
    history: [{ title: 'The outbox', trimSections: 1 }],
  },
  {
    slug: 'scheduled-means-exactly-once',
    title: 'Scheduled means exactly once',
    excerpt:
      'Two schedulers, one post, one publication. The job id is the revision, and that is the whole trick.',
    tags: ['publishing'],
    author: 'tomas',
    state: 'live',
    date: '2026-05-28T09:00:00.000Z',
  },
  {
    slug: 'lcp-is-usually-the-headline',
    title: 'LCP is usually the headline',
    excerpt:
      'On a text page the largest thing on screen is the title or the first paragraph. Make those arrive first.',
    tags: ['performance'],
    author: 'mara',
    state: 'live',
    date: '2026-06-04T09:00:00.000Z',
  },
  {
    slug: 'layout-shift-starts-with-fonts',
    title: 'Layout shift starts with fonts',
    excerpt:
      'The fallback face and the web face disagree about width. A few metric overrides make them agree.',
    tags: ['performance', 'typography'],
    author: 'mara',
    state: 'live',
    date: '2026-06-11T09:00:00.000Z',
  },
  {
    slug: 'self-hosting-fonts',
    title: 'Self-hosting fonts, licence and all',
    excerpt:
      'One less origin, one less privacy question, and a licence file next to the font where it belongs.',
    tags: ['typography', 'performance'],
    author: 'ines',
    state: 'live',
    date: '2026-06-18T09:00:00.000Z',
  },
  {
    slug: 'slugs-are-promises',
    title: 'Slugs are promises',
    excerpt:
      'Every link anyone ever made to a post uses its slug. Changing one is allowed; breaking one is not.',
    tags: ['seo', 'publishing'],
    author: 'ines',
    state: 'live',
    date: '2026-06-25T09:00:00.000Z',
  },
  {
    slug: RENAMED_SLUG,
    title: 'What happens to a link when a title changes',
    excerpt:
      'We renamed this post after publishing it. Its old address still works, and here is the mechanism.',
    tags: ['seo'],
    author: 'tomas',
    state: 'live',
    date: '2026-07-02T09:00:00.000Z',
    formerSlugs: [RENAMED_FROM],
    history: [{ title: 'Links and renamed titles', trimSections: 0 }],
  },
  {
    slug: 'comments-that-wait-for-a-person',
    title: 'Comments that wait for a person',
    excerpt:
      'Every comment here is read by an editor before anyone else sees it. That is slower, and it is the point.',
    tags: ['publishing'],
    author: 'ines',
    state: 'live',
    date: '2026-07-09T09:00:00.000Z',
    comments: [
      {
        name: 'Kit',
        body: 'Refreshing. The comment sections I still read are all moderated like this.',
        status: 'APPROVED',
        at: '2026-07-09T16:05:00.000Z',
      },
      {
        name: 'Anon',
        body: `This comment was turned down by an editor (${COMMENT_CANARY}).`,
        status: 'REJECTED',
        at: '2026-07-10T08:00:00.000Z',
      },
    ],
  },
  {
    slug: 'honeypots-still-work',
    title: 'Honeypots still work',
    excerpt:
      'A field no person can see, that a bot fills in anyway. Old trick, still the cheapest one we have.',
    tags: ['publishing'],
    author: 'ines',
    state: 'live',
    date: '2026-07-16T09:00:00.000Z',
  },
  {
    slug: HOSTILE_SLUG,
    title: 'We never render raw HTML',
    excerpt:
      'Markdown can carry HTML, and HTML can carry a script. Ours carries neither past the sanitizer.',
    tags: ['markdown'],
    author: 'mara',
    state: 'live',
    date: '2026-07-23T09:00:00.000Z',
  },
  {
    slug: 'code-blocks-people-copy',
    title: 'Code blocks people copy',
    excerpt:
      'A reader who copies a snippet wants the code, not the line numbers, the prompt or a curly quote.',
    tags: ['markdown', 'typography'],
    author: 'mara',
    state: 'live',
    date: '2026-07-30T09:00:00.000Z',
  },
  {
    slug: 'dark-mode-for-long-reads',
    title: 'Dark mode for long reads',
    excerpt:
      'White text on black is not the inverse of black on white. Long reads need softer contrast and more weight.',
    tags: ['typography', 'accessibility'],
    author: 'mara',
    state: 'live',
    date: '2026-08-06T09:00:00.000Z',
  },
  {
    slug: 'the-404-page-is-still-a-page',
    title: 'The 404 page is still a page',
    excerpt:
      'Someone followed a link and it broke. The least we can do is answer honestly and offer a way on.',
    tags: ['seo', 'accessibility'],
    author: 'ines',
    state: 'live',
    date: '2026-08-13T09:00:00.000Z',
  },
  {
    slug: 'what-an-excerpt-is-for',
    title: 'What an excerpt is for',
    excerpt:
      'The excerpt answers one question for a reader deciding whether to click. It is not the first paragraph.',
    tags: ['publishing', 'seo'],
    author: 'mara',
    state: 'live',
    date: '2026-08-20T09:00:00.000Z',
  },
  {
    slug: 'preview-what-readers-will-get',
    title: 'Preview what readers will get',
    excerpt:
      'The studio preview and the public page share one renderer. If they ever differ, that is a bug, not a setting.',
    tags: ['markdown', 'publishing'],
    author: 'tomas',
    state: 'live',
    date: '2026-08-27T09:00:00.000Z',
  },
  {
    slug: LIVE_WITH_DRAFT_SLUG,
    title: 'Caching at the edge, a year in',
    excerpt:
      'Twelve months of tag-based invalidation in front of a small publication: what held up and what did not.',
    tags: ['caching'],
    author: 'tomas',
    state: 'live-with-draft',
    date: '2026-09-03T09:00:00.000Z',
    draft: {
      title: 'Caching at the edge, two years in',
      excerpt: `An update in progress (${DRAFT_CANARY}): the second year's numbers.`,
      tags: ['caching', 'unannounced'],
      seoDescription: `Pending revision, not yet reviewed (${DRAFT_CANARY}).`,
    },
  },
  {
    slug: 'notes-toward-a-style-guide',
    title: 'Notes toward a style guide',
    excerpt: `Half a style guide (${DRAFT_CANARY}). Not ready for anyone.`,
    tags: ['publishing', 'unannounced'],
    author: 'mara',
    state: 'draft',
    date: '2026-10-01T09:00:00.000Z',
  },
  {
    slug: 'reading-time-is-a-guess',
    title: 'Reading time is a guess',
    excerpt: `Waiting for an editor (${DRAFT_CANARY}).`,
    tags: ['typography'],
    author: 'mara',
    state: 'in-review',
    date: '2026-10-08T09:00:00.000Z',
  },
  {
    slug: 'what-readers-read-this-year',
    title: 'What readers read this year',
    excerpt: `Scheduled for later (${DRAFT_CANARY}).`,
    tags: ['publishing', 'unannounced'],
    author: 'ines',
    state: 'scheduled',
    date: '2026-10-15T09:00:00.000Z',
  },
  {
    slug: 'a-correction-we-made-too-late',
    title: 'A correction we made too late',
    excerpt: `Taken down (${DRAFT_CANARY}).`,
    tags: ['publishing'],
    author: 'tomas',
    state: 'unpublished',
    date: '2026-09-10T09:00:00.000Z',
  },
];
