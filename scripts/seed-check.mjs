#!/usr/bin/env node
/**
 * The work behind scripts/seed-check.sh (read its header for what it proves).
 *
 * It reads the database through the db package's built Prisma client, so it
 * needs nothing on the machine beyond the repo's own dependencies, and it
 * reads the canary words and fixed slugs out of the catalog by regex rather
 * than by import, so a renamed constant fails here with a sentence.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DB = join(ROOT, 'packages', 'db');
const { createPrismaClient } = createRequire(import.meta.url)(join(DB, 'dist', 'index.js'));

const CATALOG = readFileSync(join(DB, 'prisma', 'content', 'catalog.ts'), 'utf8');
function constant(name) {
  const value = new RegExp(`^export const ${name} = '([^']+)';`, 'mu').exec(CATALOG)?.[1];
  if (value === undefined) {
    console.error(
      `seed-check: could not read ${name} out of packages/db/prisma/content/catalog.ts.`,
    );
    process.exit(2);
  }
  return value;
}
const DRAFT_CANARY = constant('DRAFT_CANARY');
const COMMENT_CANARY = constant('COMMENT_CANARY');
const LONG_FORM_SLUG = constant('LONG_FORM_SLUG');
const RENAMED_SLUG = constant('RENAMED_SLUG');
const RENAMED_FROM = constant('RENAMED_FROM');
const HOSTILE_SLUG = constant('HOSTILE_SLUG');

/**
 * Every seeded row, as text. Password hashes are left out (scrypt salts them,
 * on purpose) and the scheduled time is reduced to whether it is set: it is a
 * week from now, so it moves between runs by design. Everything else,
 * timestamps and ids included, must repeat exactly.
 */
const DIGEST_SQL = `
WITH x AS (
  SELECT 'user ' || email || ' ' || name || ' ' || role AS x FROM users
  UNION ALL SELECT 'tag ' || id || ' ' || slug || ' ' || name || ' ' || coalesce(description, '-') FROM tags
  UNION ALL SELECT 'post ' || id || ' ' || slug || ' ' || status || ' ' || author_id || ' ' ||
                   coalesce(head_revision_id, '-') || ' ' || coalesce(published_revision_id, '-') || ' ' ||
                   coalesce(published_at::text, '-') || ' ' || (scheduled_for IS NOT NULL)::text || ' ' ||
                   created_at::text || ' ' || updated_at::text FROM posts
  UNION ALL SELECT 'revision ' || id || ' ' || post_id || ' ' || number || ' ' || coalesce(parent_revision_id, '-') || ' ' ||
                   author_id || ' ' || md5(title || '|' || excerpt || '|' || body || '|' ||
                   coalesce(seo_title, '-') || '|' || coalesce(seo_description, '-')) || ' ' || created_at::text FROM revisions
  UNION ALL SELECT 'revision_tag ' || revision_id || ' ' || tag_id FROM revision_tags
  UNION ALL SELECT 'redirect ' || from_slug || ' ' || post_id || ' ' || created_at::text FROM slug_redirects
  UNION ALL SELECT 'comment ' || id || ' ' || post_id || ' ' || name || ' ' || md5(body) || ' ' || status || ' ' ||
                   ip_hash || ' ' || created_at::text || ' ' || coalesce(moderated_at::text, '-') FROM comments
  UNION ALL SELECT 'search ' || revision_id || ' ' || live::text || ' ' ||
                   md5(title || '|' || excerpt || '|' || body) || ' ' || created_at::text FROM search_documents
)
SELECT count(*)::int AS n, md5(string_agg(x, '|' ORDER BY x)) AS digest FROM x`;

function seed() {
  execFileSync('pnpm', ['--filter', '@cms/db', 'exec', 'tsx', 'prisma/seed.mts'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}

const db = createPrismaClient();
const failures = [];
const fail = (message) => failures.push(message);

/** One number out of one row. */
async function count(sql, ...params) {
  const rows = await db.$queryRawUnsafe(sql, ...params);
  return Number(Object.values(rows[0])[0]);
}

try {
  console.log('seed-check: first run');
  seed();
  const [first] = await db.$queryRawUnsafe(DIGEST_SQL);
  console.log(`  ${first.n} rows ${first.digest}`);

  console.log('seed-check: second run');
  seed();
  const [second] = await db.$queryRawUnsafe(DIGEST_SQL);
  console.log(`  ${second.n} rows ${second.digest}`);

  if (first.n !== second.n) {
    fail(`the second run changed the row count (${first.n} -> ${second.n}): it is not idempotent.`);
  } else if (first.digest !== second.digest) {
    fail('same row count, different digest: the seed read the clock or a random source.');
  }

  // --- The content model, as the public site will read it -------------------
  const headless = await count('SELECT count(*) FROM posts WHERE head_revision_id IS NULL');
  if (headless > 0) fail(`${headless} post(s) have no head revision.`);

  const statuses = await db.$queryRawUnsafe(`
    SELECT status::text, (published_revision_id IS NOT NULL) AS live, count(*)::int AS n
    FROM posts GROUP BY 1, 2 ORDER BY 1, 2`);
  const has = (status, live) => statuses.some((s) => s.status === status && s.live === live);
  for (const [status, live, what] of [
    ['PUBLISHED', true, 'a live post'],
    ['DRAFT', true, 'a live post with a pending revision'],
    ['DRAFT', false, 'a never-published draft'],
    ['IN_REVIEW', false, 'a post in review'],
    ['SCHEDULED', false, 'a scheduled post'],
    ['UNPUBLISHED', false, 'an unpublished post'],
  ]) {
    if (!has(status, live)) fail(`no ${what} (${status}): the leak checks need one of each state.`);
  }

  const stale = await count(
    "SELECT count(*) FROM posts WHERE status = 'SCHEDULED' AND scheduled_for <= now()",
  );
  if (stale > 0) fail(`${stale} scheduled post(s) are due in the past.`);

  // --- The canaries: nothing unpublished is in a public row -----------------
  // "Public" is exactly what the site may read: the published revision of a
  // live post, the tags on it, and approved comments on it.
  const publicText = `
    SELECT p.slug, concat_ws(' ', p.slug, r.title, r.excerpt, r.body, r.seo_title, r.seo_description) AS text
    FROM posts p JOIN revisions r ON r.id = p.published_revision_id
    UNION ALL
    SELECT p.slug, concat_ws(' ', t.slug, t.name, t.description)
    FROM posts p JOIN revision_tags rt ON rt.revision_id = p.published_revision_id JOIN tags t ON t.id = rt.tag_id
    UNION ALL
    SELECT p.slug, concat_ws(' ', c.name, c.body)
    FROM posts p JOIN comments c ON c.post_id = p.id
    WHERE p.published_revision_id IS NOT NULL AND c.status = 'APPROVED'`;
  for (const canary of [DRAFT_CANARY, COMMENT_CANARY]) {
    const leaks = await db.$queryRawUnsafe(
      `SELECT DISTINCT slug FROM (${publicText}) t WHERE text ILIKE '%' || $1 || '%'`,
      canary,
    );
    if (leaks.length > 0) {
      fail(`the canary "${canary}" is in public rows of: ${leaks.map((l) => l.slug).join(', ')}.`);
    }
  }
  // ...and it IS in the private rows, or the check above proves nothing.
  const privateRevisions = await count(
    "SELECT count(*) FROM revisions WHERE body ILIKE '%' || $1 || '%'",
    DRAFT_CANARY,
  );
  if (privateRevisions < 5) {
    fail(
      `only ${privateRevisions} revision(s) carry the draft canary; expected one per unpublished state.`,
    );
  }
  const privateComments = await count(
    "SELECT count(*) FROM comments WHERE status <> 'APPROVED' AND body ILIKE '%' || $1 || '%'",
    COMMENT_CANARY,
  );
  if (privateComments < 3)
    fail(`only ${privateComments} unapproved comment(s) carry the comment canary.`);

  // --- Search reads exactly what readers can read --------------------------
  const unindexed = await count(
    'SELECT count(*) FROM revisions r LEFT JOIN search_documents d ON d.revision_id = r.id WHERE d.revision_id IS NULL',
  );
  if (unindexed > 0) fail(`${unindexed} revision(s) have no search document.`);
  const wrongFlag = await count(`
    SELECT count(*) FROM search_documents d
    WHERE d.live <> EXISTS (SELECT 1 FROM posts p WHERE p.published_revision_id = d.revision_id)`);
  if (wrongFlag > 0) fail(`${wrongFlag} search document(s) disagree with posts about being live.`);
  const liveDocuments = await count('SELECT count(*) FROM search_documents WHERE live');
  const livePosts = await count(
    'SELECT count(*) FROM posts WHERE published_revision_id IS NOT NULL',
  );
  if (liveDocuments !== livePosts) {
    fail(`${liveDocuments} live search document(s) for ${livePosts} live post(s).`);
  }
  let darkCanaries = 0;
  for (const canary of [DRAFT_CANARY, COMMENT_CANARY]) {
    const leaks = await count(
      "SELECT count(*) FROM search_documents WHERE live AND concat_ws(' ', title, excerpt, body) ILIKE '%' || $1 || '%'",
      canary,
    );
    if (leaks > 0) fail(`the canary "${canary}" is in ${leaks} live search document(s).`);
    darkCanaries += await count(
      "SELECT count(*) FROM search_documents WHERE NOT live AND concat_ws(' ', title, excerpt, body) ILIKE '%' || $1 || '%'",
      canary,
    );
  }
  // The draft canary is indexed (drafts have documents) and kept dark.
  if (darkCanaries === 0)
    fail('no dark search document carries a canary; the leak check read nothing.');

  // --- Every internal link on a public page goes somewhere public ----------
  const live = await db.$queryRawUnsafe(`
    SELECT p.slug, r.body FROM posts p JOIN revisions r ON r.id = p.published_revision_id`);
  const liveSlugs = new Set(live.map((p) => p.slug));
  const redirects = await db.$queryRawUnsafe(`
    SELECT s.from_slug, p.slug FROM slug_redirects s JOIN posts p ON p.id = s.post_id
    WHERE p.published_revision_id IS NOT NULL`);
  const redirected = new Set(redirects.map((r) => r.from_slug));
  let links = 0;
  for (const post of live) {
    for (const [, target] of post.body.matchAll(/\]\(\/posts\/([^)#?\s]+)/gu)) {
      links += 1;
      if (!liveSlugs.has(target) && !redirected.has(target)) {
        fail(`${post.slug} links to /posts/${target}, which is not a live post.`);
      }
    }
  }
  if (links === 0) fail('no internal links found in public posts; the link check read nothing.');

  // --- The fixtures later steps depend on ------------------------------------
  const longForm = await db.$queryRawUnsafe(
    `SELECT array_length(regexp_split_to_array(btrim(r.body), '\\s+'), 1) AS words
     FROM posts p JOIN revisions r ON r.id = p.published_revision_id WHERE p.slug = $1`,
    LONG_FORM_SLUG,
  );
  const words = Number(longForm[0]?.words ?? 0);
  if (words < 3000)
    fail(`the long-form post has ${words} words; the Lighthouse budget is set on 3,000.`);

  if (!redirects.some((r) => r.from_slug === RENAMED_FROM && r.slug === RENAMED_SLUG)) {
    fail(`no redirect from ${RENAMED_FROM} to the live post ${RENAMED_SLUG}.`);
  }
  if (!live.some((p) => p.slug === HOSTILE_SLUG && p.body.includes('<script>'))) {
    fail(`the hostile post ${HOSTILE_SLUG} is not live with its raw <script> in the source.`);
  }

  if (failures.length > 0) {
    for (const message of failures) console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(
    `PASS: two runs, identical digests over ${first.n} rows; every workflow state present; ` +
      `no canary in a public row (${privateRevisions} private revisions and ${privateComments} ` +
      `comments carry one); ${liveDocuments} live search documents, one per live post, ` +
      `${darkCanaries} dark ones carry a canary; ${links} internal links all public; ` +
      `long-form post ${words} words.`,
  );
} finally {
  await db.$disconnect();
}
