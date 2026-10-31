/**
 * The search query against the real Postgres and the seeded newsroom.
 *
 * Seed facts are read from its catalog rather than retyped. Posts this suite
 * needs for itself (a title-only word, a body that tries to forge a
 * highlight) are written the way the API writes them, with words no seeded
 * post uses, so the suite passes on a database that has run it before.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPrismaClient } from '@cms/db';
import { searchDocument } from '@cms/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { searchPublished, type SearchHit } from '../src';

const catalog = readFileSync(
  join(__dirname, '../../../packages/db/prisma/content/catalog.ts'),
  'utf8',
);
function seedConstant(name: string): string {
  const match = new RegExp(`export const ${name} = '([^']+)';`, 'u').exec(catalog);
  if (match === null) throw new Error(`catalog.ts has no ${name}`);
  return match[1]!;
}
const DRAFT_CANARY = seedConstant('DRAFT_CANARY');
const COMMENT_CANARY = seedConstant('COMMENT_CANARY');
const LIVE_WITH_DRAFT_SLUG = seedConstant('LIVE_WITH_DRAFT_SLUG');
const HOSTILE_SLUG = seedConstant('HOSTILE_SLUG');
const TAKEN_DOWN_SLUG = 'a-correction-we-made-too-late';

const db = createPrismaClient();
/** Posts this suite made, deleted at the end so reruns do not accumulate live fixtures. */
const created: string[] = [];
afterAll(async () => {
  await db.post.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

const search = (query: string, limit = 50, cursor?: string) =>
  searchPublished(db, { query, limit, ...(cursor === undefined ? {} : { cursor }) });

/** Letters only, so the stemmer sees one word: digits would split it. */
const letters = () =>
  randomUUID()
    .replace(/-/gu, '')
    .slice(0, 8)
    .replace(/\d/gu, (d) => 'qrstuvwxyz'[Number(d)]!);

async function slugsOf(hits: readonly SearchHit[]): Promise<string[]> {
  const rows = await db.post.findMany({
    where: { id: { in: hits.map((h) => h.postId) } },
    select: { id: true, slug: true },
  });
  return hits.map((h) => rows.find((r) => r.id === h.postId)!.slug);
}

/** A live post written as the API writes one: revision, its document, then the pointers. */
async function livePost(fields: { title: string; excerpt: string; text: string }) {
  const run = randomUUID().slice(0, 8);
  const author = await db.user.create({
    data: {
      email: `search-${run}@cms.test`,
      name: 'Search suite',
      role: 'AUTHOR',
      passwordHash: 'x',
    },
  });
  const post = await db.post.create({ data: { slug: `search-${run}`, authorId: author.id } });
  created.push(post.id);
  const revision = await db.revision.create({
    data: {
      postId: post.id,
      number: 1,
      authorId: author.id,
      title: fields.title,
      excerpt: fields.excerpt,
      body: fields.text,
    },
  });
  await db.searchDocument.create({ data: searchDocument(revision.id, fields) });
  await db.post.update({
    where: { id: post.id },
    data: {
      headRevisionId: revision.id,
      publishedRevisionId: revision.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return post;
}

describe('ranking', () => {
  const QUERIES = ['text', 'reader', 'publish', 'tag', 'caching', 'rendering', 'search'];

  it.each(QUERIES)('"%s": every title hit comes before every body-only hit', async (query) => {
    const { hits, total } = await search(query);
    expect(total).toBeGreaterThan(1);
    const firstBodyOnly = hits.findIndex((h) => !h.titleHit);
    const lastTitle = hits.map((h) => h.titleHit).lastIndexOf(true);
    expect(lastTitle).toBeGreaterThanOrEqual(0);
    if (firstBodyOnly !== -1) expect(lastTitle).toBeLessThan(firstBodyOnly);
    // Within each group, by rank.
    for (const group of [true, false]) {
      const ranks = hits.filter((h) => h.titleHit === group).map((h) => h.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    }
  });

  it('holds where the weights alone would not: a body with every word out-scores a title with one', async () => {
    // Built, not found: on the seed the lead's weights happen to agree with
    // the tier. Here they cannot. ts_rank averages over the query's terms and
    // divides by the lead's length, so a short body that says all five words
    // beats a long post that has one of them, once, in its title.
    const run = letters();
    const words = ['alpha', 'bravo', 'delta', 'kilo', 'tango'].map((w) => `zyx${run}${w}`);
    const body = await livePost({
      title: 'Notes',
      excerpt: 'x',
      text: `${words.join(' ')} `.repeat(20),
    });
    const distinct = Array.from({ length: 200 }, (_, i) => `w${String(100 + i)}`).join(' ');
    const title = await livePost({
      title: `Gardens, tides, ledgers, kettles and ${words[0]!}`,
      excerpt: 'x',
      text: distinct,
    });
    const { hits } = await search(words.join(' or '));
    const rankOf = (id: string) => hits.find((h) => h.postId === id)!.rank;
    expect(rankOf(body.id)).toBeGreaterThan(rankOf(title.id));
    expect(hits.map((h) => h.postId)).toEqual([title.id, body.id]);
  });

  it('puts the post about the subject first', async () => {
    expect((await slugsOf((await search('title match')).hits))[0]).toBe(
      'why-a-title-match-should-win',
    );
  });
});

describe('only published text can match', () => {
  it('finds no draft, pending revision or comment canary', async () => {
    expect((await search(DRAFT_CANARY)).total).toBe(0);
    expect((await search(COMMENT_CANARY)).total).toBe(0);
    // The documents exist: drafts are indexed, and the join keeps them out.
    const indexed = await db.searchDocument.count({
      where: { excerpt: { contains: DRAFT_CANARY } },
    });
    expect(indexed).toBeGreaterThan(0);
  });

  it('matches the live revision of a post with a pending draft, not the draft', async () => {
    // Published: "Caching at the edge, a year in". Pending: "... two years in".
    const live = await slugsOf((await search('"a year in"')).hits);
    expect(live).toContain(LIVE_WITH_DRAFT_SLUG);
    const draft = await slugsOf((await search('"two years in"')).hits);
    expect(draft).not.toContain(LIVE_WITH_DRAFT_SLUG);
  });

  it('never finds a post that was taken down', async () => {
    expect(await slugsOf((await search('correction')).hits)).not.toContain(TAKEN_DOWN_SLUG);
  });
});

describe('the query language readers already know', () => {
  it('"-word" excludes, quotes mean a phrase, "or" widens', async () => {
    const caching = await slugsOf((await search('caching')).hits);
    const withoutEdge = await slugsOf((await search('caching -edge')).hits);
    expect(caching).toContain(LIVE_WITH_DRAFT_SLUG);
    expect(withoutEdge).not.toContain(LIVE_WITH_DRAFT_SLUG);
    expect(withoutEdge.length).toBeLessThan(caching.length);

    // "or" is exactly the union of its two sides.
    const comment = await slugsOf((await search('comment')).hits);
    const either = await slugsOf((await search('caching or comment')).hits);
    expect(new Set(either)).toEqual(new Set([...caching, ...comment]));
    expect(either.length).toBeGreaterThan(Math.max(caching.length, comment.length));
  });

  it('answers stop words, punctuation or only exclusions with nothing, not an error', async () => {
    // Only exclusions too: "-caching" alone would be every other post.
    for (const query of [
      'the',
      'and the of',
      '!!!',
      '"',
      '-',
      'or',
      '-caching',
      'caching or -edge',
    ]) {
      expect(await search(query)).toMatchObject({ total: 0, hits: [], nextCursor: null });
    }
  });
});

describe('snippets', () => {
  it('mark the words that matched, stemmed, as data', async () => {
    const { hits } = await search('caching');
    for (const hit of hits) {
      const matches = hit.snippet.filter((p) => p.match);
      if (matches.length === 0) continue;
      for (const m of matches) expect(m.text).toMatch(/^cach/iu);
    }
    expect(hits.some((h) => h.snippet.some((p) => p.match))).toBe(true);
  });

  it('fall back to the excerpt when only the title matched', async () => {
    const word = `zyxtitleonly${randomUUID().slice(0, 6)}`;
    await livePost({
      title: `A post about ${word}`,
      excerpt: 'The excerpt says why.',
      text: 'Nothing in the body.',
    });
    const { hits } = await search(word);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      titleHit: true,
      snippet: [{ text: 'The excerpt says why.', match: false }],
    });
  });

  it('cannot be forged by a body that carries the marker characters', async () => {
    const word = `zyxforged${randomUUID().slice(0, 6)}`;
    await livePost({
      title: 'Forgery attempt',
      excerpt: 'x',
      text: `Before \u0002not a match\u0003 after, and then ${word} once.`,
    });
    const [hit] = (await search(word)).hits;
    expect(hit!.snippet.filter((p) => p.match).map((p) => p.text)).toEqual([word]);
    // eslint-disable-next-line no-control-regex -- asserting their absence
    expect(hit!.snippet.map((p) => p.text).join('')).not.toMatch(/[\u0000-\u001f]/u);
  });

  // Past the lead (600 characters) and past one window (900), so each of the
  // three snippet paths is the one that has to find the word.
  const FILLER = 'Plain filler sentence without anything to find. '.repeat(60);

  it('find a match deep in a long body (the window path)', async () => {
    const word = `zyxdeep${letters()}`;
    await livePost({
      title: 'Deep',
      excerpt: 'x',
      text: `${FILLER}Here at last is ${word}. ${FILLER}`,
    });
    const [hit] = (await search(word)).hits;
    expect(hit!.snippet.filter((p) => p.match).map((p) => p.text)).toEqual([word]);
  });

  it('find a word whose stem is not a prefix of it (the whole-body path)', async () => {
    // Porter stems "...happy" to "...happi", which no strpos finds in the text.
    const word = `zyx${letters()}happy`;
    await livePost({
      title: 'Stem',
      excerpt: 'x',
      text: `${FILLER}Very ${word} indeed. ${FILLER}`,
    });
    const [hit] = (await search(word)).hits;
    expect(hit!.snippet.filter((p) => p.match).map((p) => p.text)).toEqual([word]);
  });

  it('are not fooled by a longer word that starts with the stem', async () => {
    // "...cachet" holds the stem of "...caching" as text, but is another
    // word; the window it opens has no match, so the whole body is used.
    const stem = `zyx${letters()}cach`;
    await livePost({
      title: 'Decoy',
      excerpt: 'x',
      text: `${FILLER}A ${stem}et first. ${FILLER}${FILLER}Then real ${stem}ing here.`,
    });
    const [hit] = (await search(`${stem}ing`)).hits;
    expect(hit!.snippet.filter((p) => p.match).map((p) => p.text)).toEqual([`${stem}ing`]);
  });

  it("never carry the hostile post's payloads", async () => {
    const { hits } = await search('hostile');
    const slugs = await slugsOf(hits);
    const hostile = hits[slugs.indexOf(HOSTILE_SLUG)];
    expect(hostile).toBeDefined();
    expect(hostile!.snippet.map((p) => p.text).join('')).not.toContain('__quireHostile');
    expect((await search('__quireHostile')).total).toBe(0);
  });
});

describe('pages', () => {
  it('a cursor crawl returns every hit once, in order, and total counts them all', async () => {
    const query = 'page';
    const all = (await search(query, 50)).hits;
    const crawled: SearchHit[] = [];
    let cursor: string | undefined;
    let total = -1;
    do {
      const page = await search(query, 3, cursor);
      total = page.total;
      crawled.push(...page.hits);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(total).toBeGreaterThan(6);
    expect(crawled).toHaveLength(total);
    expect(crawled.map((h) => h.postId)).toEqual(all.map((h) => h.postId));
  });

  it('refuses a cursor issued for another query', async () => {
    const { nextCursor } = await search('page', 2);
    expect(nextCursor).not.toBeNull();
    await expect(search('caching', 2, nextCursor!)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(search('page', 2, 'garbage')).rejects.toMatchObject({ code: 'INVALID' });
  });
});
