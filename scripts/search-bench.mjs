#!/usr/bin/env node
/**
 * Search latency over 2,000 published posts: p95 must stay under 50 ms
 * (docs: measurable outcome 6).
 *
 *   node scripts/search-bench.mjs          # DATABASE_URL names the dev database; the bench uses <db>_bench
 *
 * What it measures: `searchPublished` from the built `@cms/search`, the exact
 * function `/v1/search` calls, through a warm Prisma connection: ranking,
 * the published-only join, the total count and the snippets, one page of 10.
 * HTTP and the API key lookup are not in the number; they are the same for
 * every route.
 *
 * The corpus is synthetic and deterministic (one seeded PRNG): 2,000 live
 * posts, each with an older revision that is not published, and 500 drafts,
 * so the index holds 4,500 documents and the join really has to filter.
 * Words come from the seeded publication's own posts with a Zipf
 * distribution, as in real prose, so the common-word queries match most of
 * the corpus: the worst case for ranking and counting, which is the case a
 * budget has to hold for. Bodies run 300 to 2,400 words. Query words are
 * drawn from the same ranking with stop words removed, so no shape is
 * quietly a query that matches nothing.
 *
 *   pnpm search:bench                      # builds @cms/search first
 *
 * Its database is its own: `<name>_bench`, created on first run and never
 * dropped. A database holding this corpus version is reused; one holding
 * anything else is refused, and you drop it yourself.
 *
 * 0 = within budget. 1 = over budget, or the GIN index is not usable.
 * 2 = could not run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createPrismaClient } = require(join(ROOT, 'packages/db/dist/index.js'));
const { searchDocument } = require(join(ROOT, 'packages/shared/dist/index.js'));
const { searchPublished } = require(join(ROOT, 'services/search/dist/index.js'));
const { SEARCH_VECTOR_INDEX } = require(join(ROOT, 'packages/db/dist/constraints.js'));

const BUDGET_P95_MS = 50;
const LIVE = 2000;
const DRAFTS = 500;
const PAGE = 10;
const WARMUP = 3;
const REPEATS = 10;
const CORPUS_VERSION = 'v1';
const AUTHOR_EMAIL = `bench-${CORPUS_VERSION}@cms.test`;

// --- The database ------------------------------------------------------------

const base = process.env.DATABASE_URL;
if (!base) {
  console.error('search-bench: DATABASE_URL is not set.');
  process.exit(2);
}
const url = new URL(base);
const name = url.pathname.slice(1);
const benchName = name.endsWith('_bench') ? name : `${name}_bench`;
url.pathname = `/${benchName}`;
const BENCH_URL = url.toString();

async function ensureDatabase() {
  const adminUrl = new URL(BENCH_URL);
  adminUrl.pathname = '/postgres';
  const admin = createPrismaClient({ url: adminUrl.toString() });
  try {
    const rows = await admin.$queryRawUnsafe(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      benchName,
    );
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${benchName}"`);
  } finally {
    await admin.$disconnect();
  }
  execFileSync('pnpm', ['--filter', '@cms/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: BENCH_URL },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

// --- The corpus --------------------------------------------------------------

/** mulberry32: small, fast, and the same sequence on every machine. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seeded posts' words, most frequent first (ties alphabetical), for a Zipf draw. */
function vocabulary() {
  const dir = join(ROOT, 'packages/db/prisma/content/posts');
  const counts = new Map();
  for (const file of readdirSync(dir).sort()) {
    for (const word of readFileSync(join(dir, file), 'utf8')
      .toLowerCase()
      .match(/[a-z]{3,}/gu) ?? []) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([w]) => w);
}

function zipf(words, random, s = 1.07) {
  const cumulative = [];
  let sum = 0;
  for (let rank = 1; rank <= words.length; rank += 1) {
    sum += 1 / rank ** s;
    cumulative.push(sum);
  }
  return () => {
    const target = random() * sum;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return words[lo];
  };
}

function corpus() {
  const random = prng(2026);
  const words = vocabulary();
  const word = zipf(words, random);
  const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const phrase = (n) => Array.from({ length: n }, word).join(' ');
  const sentenceText = (n) => {
    const out = [];
    while (n > 0) {
      const len = Math.min(n, between(8, 22));
      const s = phrase(len);
      out.push(`${s[0].toUpperCase()}${s.slice(1)}.`);
      n -= len;
    }
    return out.join(' ');
  };
  const revision = () => {
    const title = phrase(between(4, 9));
    return {
      title: `${title[0].toUpperCase()}${title.slice(1)}`,
      excerpt: sentenceText(between(18, 30)).slice(0, 300),
      body: sentenceText(between(300, 2400)),
    };
  };
  const day = 86_400_000;
  const start = Date.UTC(2023, 0, 1);
  const posts = [];
  for (let i = 0; i < LIVE + DRAFTS; i += 1) {
    const live = i < LIVE;
    const at = new Date(start + Math.floor(random() * 1000) * day);
    posts.push({
      slug: `bench-${String(i).padStart(4, '0')}`,
      live,
      at,
      revisions: live ? [revision(), revision()] : [revision()],
    });
  }
  return { posts, words };
}

async function load(db, posts) {
  const author = await db.user.create({
    data: {
      email: AUTHOR_EMAIL,
      name: 'Bench author',
      role: 'AUTHOR',
      passwordHash: 'not-a-login',
    },
  });
  for (let i = 0; i < posts.length; i += 100) {
    const batch = posts.slice(i, i + 100);
    await db.$transaction(
      async (tx) => {
        for (const post of batch) {
          const row = await tx.post.create({
            data: { slug: post.slug, authorId: author.id, createdAt: post.at },
          });
          let parent = null;
          for (const [n, fields] of post.revisions.entries()) {
            const rev = await tx.revision.create({
              data: {
                postId: row.id,
                number: n + 1,
                parentRevisionId: parent,
                authorId: author.id,
                createdAt: post.at,
                ...fields,
              },
            });
            // Plain prose is its own rendered text, so the document is the body itself.
            await tx.searchDocument.create({
              data: searchDocument(rev.id, { ...fields, text: fields.body }),
            });
            parent = rev.id;
          }
          await tx.post.update({
            where: { id: row.id },
            data: post.live
              ? {
                  headRevisionId: parent,
                  publishedRevisionId: parent,
                  status: 'PUBLISHED',
                  publishedAt: post.at,
                }
              : { headRevisionId: parent, status: 'DRAFT' },
          });
        }
      },
      { timeout: 120_000 },
    );
    process.stdout.write(
      `\rsearch-bench: loading ${String(Math.min(i + 100, posts.length))}/${String(posts.length)}`,
    );
  }
  process.stdout.write('\n');
  // VACUUM, not only ANALYZE: a bulk load leaves every new GIN entry in the
  // index's pending list, which the planner prices as a full scan and which
  // every query must read. Autovacuum merges it on a live database; measured
  // here, skipping it made a selective query a 140 ms sequential scan.
  await db.$executeRawUnsafe('VACUUM ANALYZE');
}

// --- The queries -------------------------------------------------------------

/**
 * The vocabulary without its stop words, in the same order. The corpus keeps
 * them (prose has them), but a query word drawn as "the" or "same" is a query
 * that matches nothing, which would flatter the numbers; the stop-word case
 * is measured once, on its own. Postgres decides, with the config search uses.
 */
async function contentWords(db, words) {
  const rows = await db.$queryRawUnsafe(
    `SELECT w FROM unnest($1::text[]) WITH ORDINALITY AS t(w, i)
     WHERE to_tsvector('english'::regconfig, w) <> ''::tsvector ORDER BY i`,
    words,
  );
  return rows.map((r) => r.w);
}

/** Query shapes a reader types, drawn from the content words by how common they are. */
function queries(words, posts) {
  const at = (rank) => words[Math.min(rank, words.length - 1)];
  const live = posts.filter((p) => p.live);
  const bodyPair = (i) =>
    live[i].revisions[1].body
      .toLowerCase()
      .match(/[a-z]{3,}/gu)
      .slice(10, 12)
      .join(' ');
  return [
    ...[0, 1, 3, 6, 10].map((r) => ({ kind: 'common word', q: at(r) })),
    ...[60, 120, 250, 400].map((r) => ({ kind: 'mid word', q: at(r) })),
    ...[900, 1300, words.length - 40].map((r) => ({ kind: 'rare word', q: at(r) })),
    ...[
      [2, 40],
      [15, 200],
      [80, 300],
    ].map(([a, b]) => ({ kind: 'two words', q: `${at(a)} ${at(b)}` })),
    ...[5, 500, 1500].map((i) => ({ kind: 'phrase', q: `"${bodyPair(i)}"` })),
    ...[
      [30, 700],
      [100, 1000],
    ].map(([a, b]) => ({ kind: 'or', q: `${at(a)} or ${at(b)}` })),
    ...[
      [4, 50],
      [20, 90],
    ].map(([a, b]) => ({ kind: 'negation', q: `${at(a)} -${at(b)}` })),
    // Only exclusions: matches nothing by design, and must not walk the index.
    { kind: 'only -word', q: `-${at(3)}` },
    { kind: 'no match', q: 'zyxnotawordanywhere' },
    { kind: 'stop words', q: 'the and of' },
  ];
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function main() {
  await ensureDatabase();
  const db = createPrismaClient({ url: BENCH_URL });
  try {
    await db.$executeRawUnsafe('VACUUM ANALYZE search_documents');
    const { posts, words } = corpus();
    const ours = await db.user.findUnique({ where: { email: AUTHOR_EMAIL } });
    const existing = await db.post.count();
    if (ours === null && existing > 0) {
      console.error(
        `search-bench: ${benchName} holds data that is not corpus ${CORPUS_VERSION}. Drop it yourself and rerun.`,
      );
      return 2;
    }
    if (ours === null) await load(db, posts);
    const liveCount = await db.post.count({ where: { publishedRevisionId: { not: null } } });
    const documents = await db.searchDocument.count();
    console.log(
      `search-bench: ${benchName}, ${String(liveCount)} live posts, ${String(documents)} documents`,
    );
    if (liveCount !== LIVE) {
      console.error(
        `search-bench: expected ${String(LIVE)} live posts, found ${String(liveCount)}.`,
      );
      return 2;
    }

    // The index has to be usable at all: a selective query must go through it.
    // The word is the live corpus's rarest (148 of 2,000 live posts in this
    // corpus), read from ts_stat, never a fixed position in the vocabulary:
    // `words[words.length - 40]` was "type", in 1,277 of 2,000 live posts,
    // where a sequential scan is the right plan, and a fresh CI database
    // failed the check for planning correctly.
    const [rare] = await db.$queryRawUnsafe(
      `SELECT word, ndoc FROM ts_stat('SELECT vector FROM search_documents WHERE live')
       ORDER BY ndoc, word LIMIT 1`,
    );
    if (rare === undefined) {
      console.error('search-bench: the live corpus has no words.');
      return 2;
    }
    const plan = await db.$queryRawUnsafe(
      `EXPLAIN (FORMAT JSON) SELECT revision_id FROM search_documents
       WHERE live AND vector @@ to_tsquery('english'::regconfig, $1)`,
      rare.word,
    );
    const indexUsed = JSON.stringify(plan).includes(SEARCH_VECTOR_INDEX);
    if (!indexUsed) {
      // Say which query and which plan, so a red run can be read, not guessed.
      console.error(
        `search-bench: the selective query for "${String(rare.word)}" (${String(rare.ndoc)} live documents) planned as`,
        JSON.stringify(plan),
      );
    }
    const shapes = queries(await contentWords(db, words), posts);

    const results = [];
    for (const { kind, q } of shapes) {
      for (let i = 0; i < WARMUP; i += 1) await searchPublished(db, { query: q, limit: PAGE });
      const times = [];
      let total = 0;
      for (let i = 0; i < REPEATS; i += 1) {
        const started = performance.now();
        const page = await searchPublished(db, { query: q, limit: PAGE });
        times.push(performance.now() - started);
        total = page.total;
      }
      results.push({ kind, q, total, times });
    }

    const all = results.flatMap((r) => r.times).sort((a, b) => a - b);
    const p50 = percentile(all, 50);
    const p95 = percentile(all, 95);
    const p99 = percentile(all, 99);
    const fmt = (ms) => `${ms.toFixed(1)} ms`;

    console.log('\n  kind          matches  p95       query');
    for (const r of results) {
      const sorted = [...r.times].sort((a, b) => a - b);
      console.log(
        `  ${r.kind.padEnd(13)} ${String(r.total).padStart(7)}  ${fmt(percentile(sorted, 95)).padEnd(9)} ${r.q}`,
      );
    }
    console.log(
      `\nsearch-bench: ${String(all.length)} searches: p50 ${fmt(p50)}, p95 ${fmt(p95)}, p99 ${fmt(p99)}, max ${fmt(all.at(-1))}` +
        ` (budget p95 < ${String(BUDGET_P95_MS)} ms); GIN index ${indexUsed ? 'used' : 'NOT used'} by a selective query`,
    );

    const outDir = join(tmpdir(), 'search-bench');
    mkdirSync(outDir, { recursive: true });
    const report = join(outDir, 'report.json');
    writeFileSync(
      report,
      JSON.stringify(
        { live: liveCount, documents, p50, p95, p99, budget: BUDGET_P95_MS, indexUsed, results },
        null,
        2,
      ),
    );
    console.log(`search-bench: report ${report}`);

    if (!indexUsed) return 1;
    return p95 < BUDGET_P95_MS ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('search-bench: could not run:', error);
    process.exit(2);
  },
);
