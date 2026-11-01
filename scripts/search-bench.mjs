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
 * dropped. The corpus version is a hash of every row it writes
 * (scripts/bench-corpus.mjs), so a database loaded before a seeded post or
 * the search-document derivation changed is refused, with the command to
 * drop it, instead of being measured as if it held this corpus.
 *
 * Where the budget is judged: the CI runner (ubuntu-latest, the integration
 * job), the one machine every run shares. The number is a property of the
 * hardware as much as the query. On the dev laptop (i5-1135G7, `powersave`
 * governor) an interleaved comparison of the same build measured every shape
 * about 2x CI, the cheap ones too ("page" 27.6 ms against 13.6 ms), at a
 * load of 1.4 to 2 on 8 cores, so a local p95 near 55 ms is that machine,
 * not load and not the query: CI measured p95 25.5 ms on the same commit.
 * The report records the CPU model so two runs can be compared honestly.
 *
 * 0 = within budget. 1 = over budget, or the GIN index is not usable.
 * 2 = could not run.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIVE, authorEmail, corpus, corpusVersion, versionOfEmail } from './bench-corpus.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createPrismaClient } = require(join(ROOT, 'packages/db/dist/index.js'));
const { searchDocument } = require(join(ROOT, 'packages/shared/dist/index.js'));
const { searchPublished } = require(join(ROOT, 'services/search/dist/index.js'));
const { SEARCH_VECTOR_INDEX } = require(join(ROOT, 'packages/db/dist/constraints.js'));

const BUDGET_P95_MS = 50;
const PAGE = 10;
const WARMUP = 3;
const REPEATS = 10;

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

/**
 * Where to run the drop from, as psql takes it: the maintenance database, no
 * password (it would land in a terminal or a CI log), and no Prisma-only
 * query parameters such as `schema`, which libpq rejects.
 */
function adminTarget() {
  const target = new URL(BENCH_URL);
  target.password = '';
  target.pathname = '/postgres';
  target.search = '';
  return target.toString();
}

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

// --- The corpus (scripts/bench-corpus.mjs) ------------------------------------

async function load(db, posts, email) {
  const author = await db.user.create({
    data: {
      email,
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
    const version = corpusVersion(posts, searchDocument);
    const email = authorEmail(version);
    const ours = await db.user.findUnique({ where: { email } });
    const existing = await db.post.count();
    if (ours === null && existing > 0) {
      // Say what it holds, so the refusal can be acted on without digging.
      const others = await db.user.findMany({
        where: { email: { startsWith: 'bench-' } },
        select: { email: true },
      });
      const held = others.map((u) => versionOfEmail(u.email)).filter(Boolean);
      console.error(
        `search-bench: ${benchName} holds corpus ${held.join(', ') || '(unknown)'}, and this script generates corpus ${version}.\n` +
          `  The seeded posts or the search-document derivation changed since it was loaded. Drop it and rerun:\n` +
          `  psql "${adminTarget()}" -c 'DROP DATABASE "${benchName}"'   (psql asks for the password)`,
      );
      return 2;
    }
    if (ours === null) await load(db, posts, email);
    const liveCount = await db.post.count({ where: { publishedRevisionId: { not: null } } });
    const documents = await db.searchDocument.count();
    console.log(
      `search-bench: ${benchName}, corpus ${version}, ${String(liveCount)} live posts, ${String(documents)} documents`,
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
        {
          corpus: version,
          live: liveCount,
          documents,
          p50,
          p95,
          p99,
          budget: BUDGET_P95_MS,
          indexUsed,
          machine: cpus()[0]?.model ?? 'unknown',
          results,
        },
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
