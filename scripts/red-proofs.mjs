#!/usr/bin/env node
/**
 * Red proofs for the API's and search's guarantees: break each one in the source, run the
 * suite that claims to hold it, and require that suite to FAIL. A check that
 * has never failed is a check whose meaning nobody knows.
 *
 *   node scripts/red-proofs.mjs            # every proof
 *   node scripts/red-proofs.mjs revoked    # proofs whose name matches
 *   node scripts/red-proofs.mjs outbox webhook   # proofs matching any of them
 *
 * Each mutation must match its file exactly once (so a refactor that moves
 * the line fails here loudly instead of "proving" nothing), and the original
 * file is restored afterwards, also on Ctrl-C. A hard kill (SIGKILL, a closed
 * terminal) cannot run that restore, so the original is also written next to
 * the file as `<file>.red-proof-orig` before it is broken, and the next run
 * puts any leftover back before doing anything else. A killed run once left
 * the outbox check deleted from posts.service.ts. Needs the datastores up, like
 * `./scripts/integration.sh`, which it calls. The publisher lane runs its
 * suite directly against cms_it, so `./scripts/integration.sh` must have run
 * once (it creates and migrates that database).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** name, file, exact text, its broken replacement, and the suite that must go red. */
const PROOFS = [
  {
    name: 'stale save without the row lock',
    file: 'apps/api/src/posts/posts.service.ts',
    from: 'FROM posts WHERE id = ${id} FOR UPDATE`;',
    to: 'FROM posts WHERE id = ${id}`;',
    suite: ['integration', 'posts'],
  },
  {
    name: 'transition without the head check',
    file: 'apps/api/src/posts/posts.service.ts',
    from: 'if (post.headRevisionId !== input.revisionId) {',
    to: 'if (false) {',
    suite: ['integration', 'workflow'],
  },
  {
    name: 'publish without an excerpt',
    file: 'apps/api/src/posts/posts.service.ts',
    from: "if (head.excerpt.trim() === '') {",
    to: 'if (false) {',
    suite: ['integration', 'workflow'],
  },
  {
    name: 'publish without the outbox row',
    file: 'apps/api/src/posts/posts.service.ts',
    from: 'if (published !== post.publishedRevisionId) {',
    to: 'if (false) {',
    suite: ['integration', 'workflow'],
  },
  {
    name: 'revoked key still accepted',
    file: 'apps/api/src/common/api-key.guard.ts',
    from: 'if (row === null || row.revokedAt !== null) throw refused();',
    to: 'if (row === null) throw refused();',
    suite: ['integration', 'content'],
  },
  {
    name: 'role read from the token instead of the row',
    file: 'apps/api/src/common/actor.guard.ts',
    from: 'const refused = refusal(actor, action);',
    to: 'const refused = refusal({ ...actor, role: request.user.role }, action);',
    suite: ['integration', 'roles'],
  },
  {
    name: 'last-admin check without the lock',
    file: 'apps/api/src/users/users.controller.ts',
    from: "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id FOR UPDATE`;",
    to: "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id`;",
    suite: ['integration', 'roles'],
  },
  {
    name: 'content API lists unpublished posts',
    file: 'apps/api/src/content/content.service.ts',
    from: 'publishedRevisionId: { not: null },',
    to: '',
    suite: ['integration', 'content'],
  },
  {
    name: 'tag order counts as a change',
    file: 'apps/api/src/posts/stale.ts',
    from: 'a.length === b.length && [...a].sort().every((tag, i) => tag === [...b].sort()[i]);',
    to: 'a.length === b.length && a.every((tag, i) => tag === b[i]);',
    suite: ['unit'],
  },
  {
    name: 'weak ETags never match',
    file: 'apps/api/src/common/etag.ts',
    from: "const bare = (tag: string) => tag.trim().replace(/^W\\//u, '');",
    to: 'const bare = (tag: string) => tag.trim();',
    suite: ['unit'],
  },
  // --- comments (step 8) -------------------------------------------------
  {
    name: 'comment honeypot ignored',
    file: 'apps/api/src/comments/comments.service.ts',
    from: "if (honeypot !== undefined && honeypot.trim() !== '') {",
    to: 'if (false) {',
    suite: ['integration', 'comments'],
  },
  {
    name: 'comment decision without the state the moderator saw',
    file: 'apps/api/src/comments/comments.service.ts',
    from: 'WHERE id = ${id} AND status = ${input.from}::"CommentStatus"',
    to: 'WHERE id = ${id}',
    suite: ['integration', 'comments'],
  },
  {
    name: 'comment decision without its revalidation event',
    file: 'apps/api/src/comments/comments.service.ts',
    from: 'if (changesWhatReadersSee(input.from, input.to) && post.publishedRevisionId !== null) {',
    to: 'if (false) {',
    suite: ['integration', 'comments'],
  },
  {
    name: 'content API lists comments nobody approved',
    file: 'apps/api/src/comments/comments.service.ts',
    from: "        status: 'APPROVED',\n",
    to: '',
    suite: ['integration', 'content'],
  },
  {
    name: 'comment route without its budget',
    file: 'apps/api/src/comments/comments.controller.ts',
    from: "  @Budget('comment')\n",
    to: '',
    suite: ['integration', 'comments'],
  },
  {
    name: 'anonymous rate-limit key holds the address in the clear',
    file: 'apps/api/src/common/throttle.ts',
    from: "return `ip:${addressHash(secret, request.ip ?? 'unknown')}`;",
    to: "return `ip:${request.ip ?? 'unknown'}`;",
    suite: ['unit'],
  },
  // --- publisher and revalidation (step 7) -------------------------------
  {
    name: 'scheduled publish without the row lock or the status re-check',
    file: 'services/publisher/src/schedule.ts',
    from: `        LIMIT \${limit}
        FOR UPDATE SKIP LOCKED
      )`,
    to: `        LIMIT \${limit}
      )`,
    also: { from: "WHERE p.id = due.id AND p.status = 'SCHEDULED'", to: 'WHERE p.id = due.id' },
    suite: ['publisher'],
  },
  {
    name: 'outbox claim without SKIP LOCKED',
    file: 'services/publisher/src/outbox.ts',
    from: `      LIMIT \${limit}
      FOR UPDATE SKIP LOCKED`,
    to: `      LIMIT \${limit}`,
    suite: ['publisher'],
  },
  {
    name: 'outbox claim without the lease',
    file: 'services/publisher/src/outbox.ts',
    from: 'next_attempt_at = now() + make_interval(secs => ${leaseMs / 1000})',
    to: 'next_attempt_at = now()',
    suite: ['publisher'],
  },
  {
    name: 'outbox backoff without the cap',
    file: 'services/publisher/src/outbox.ts',
    from: 'return Math.min(1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);',
    to: 'return 1000 * 2 ** Math.max(0, attempts - 1);',
    suite: ['unit', '@cms/publisher'],
  },
  {
    name: 'outbox counts a redirect as a delivery',
    file: 'services/publisher/src/outbox.ts',
    from: 'if (response.ok) {',
    to: 'if (response.status < 400) {',
    suite: ['unit', '@cms/publisher'],
  },
  {
    name: 'webhook signature without the replay window',
    file: 'packages/shared/src/server/webhook.ts',
    from: "if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' };",
    to: '',
    suite: ['unit', '@cms/shared'],
  },
  {
    name: 'revalidate route acts on a body with a bad signature',
    file: 'apps/web/lib/revalidate.ts',
    from: 'if (!verdict.ok) return { status: 401, reason: verdict.reason };',
    to: 'if (!verdict.ok && request.signature === null) return { status: 401, reason: verdict.reason };',
    suite: ['unit', '@cms/web'],
  },
  // --- search (step 5) ---------------------------------------------------
  {
    name: 'search without the title tier',
    file: 'services/search/src/search.ts',
    from: '(d.title_vector @@ q.query)::int AS title_hit,',
    to: '0 AS title_hit,',
    suite: ['integration', 'search'],
  },
  {
    // Either defense alone holds (the live flag, or the published join), so
    // only removing both may turn the suite red.
    name: 'search reads every revision, not the published one',
    file: 'services/search/src/search.ts',
    from: `JOIN search_documents d ON d.live AND d.vector @@ q.query
      JOIN posts p ON p.published_revision_id = d.revision_id`,
    to: `JOIN search_documents d ON d.vector @@ q.query
      JOIN revisions r ON r.id = d.revision_id
      JOIN posts p ON p.id = r.post_id`,
    suite: ['integration', 'search'],
  },
  {
    name: 'search lets a query of only exclusions walk the index',
    file: 'services/search/src/search.ts',
    from: "WHERE querytree(q.query) NOT IN ('', 'T')",
    to: 'WHERE TRUE',
    suite: ['integration', 'search'],
  },
  {
    name: 'search snippet window trusted without a match in it',
    file: 'services/search/src/search.ts',
    from: "WHEN w.headline = '' OR strpos(w.headline, ${MATCH_START}) > 0 THEN w.headline",
    to: 'WHEN w.headline IS NOT NULL THEN w.headline',
    suite: ['integration', 'search'],
  },
  {
    name: 'search cursor not bound to its query',
    file: 'services/search/src/cursor.ts',
    from: 'if (!result.success || result.data.q !== queryKey(query)) throw invalid();',
    to: 'if (!result.success) throw invalid();',
    suite: ['unit', '@cms/search'],
  },
  {
    name: 'search text keeps control characters (forged highlights)',
    file: 'packages/shared/src/contracts/search.ts',
    from: ".replace(/[\\u0000-\\u001f\\u007f\\u0080-\\u009f]/gu, ' ')",
    to: '',
    suite: ['unit', '@cms/shared'],
  },
  {
    name: 'search ranks on the whole body (the first design, 513 ms)',
    file: 'services/search/src/search.ts',
    from: 'ts_rank(d.lead_vector, q.query, 1) AS rank',
    to: 'ts_rank_cd(d.vector, q.query, 1) AS rank',
    suite: ['bench'],
  },
  // --- studio (step 9) ---------------------------------------------------
  {
    name: 'studio schedules a wall-clock time the clocks skip',
    file: 'apps/web/lib/studio/schedule-time.ts',
    from: 'if (isoToLocalInput(iso) !== value) {',
    to: 'if (false) {',
    suite: ['unit', '@cms/web'],
  },
  {
    name: 'studio counts reordered tags as an unsaved change',
    file: 'apps/web/lib/studio/post-values.ts',
    from: 'return a.tags.length === b.tags.length && b.tags.every((tag) => tags.has(tag));',
    to: 'return a.tags.join() === b.tags.join() && tags.size >= 0;',
    suite: ['unit', '@cms/web'],
  },
  {
    name: 'studio takes a post down without asking',
    file: 'apps/web/lib/studio/workflow-ui.ts',
    from: '    primary: false,\n    confirm:\n',
    to: '    primary: false,\n    _confirm:\n',
    suite: ['unit', '@cms/web'],
  },
  {
    name: 'studio history shows a long body whole instead of the change',
    file: 'apps/web/lib/studio/revision-diff.ts',
    from: 'parts: foldUnchanged(parts(diffLines(from.body, to.body))),',
    to: 'parts: parts(diffLines(from.body, to.body)),',
    suite: ['unit', '@cms/web'],
  },
  {
    name: 'studio formats a time with dateStyle and a zone name (V8 throws)',
    file: 'apps/web/lib/studio/when.ts',
    from: "  year: 'numeric',\n  month: 'short',\n  day: 'numeric',\n  hour: 'numeric',\n  minute: '2-digit',\n",
    to: "  dateStyle: 'medium',\n  timeStyle: 'short',\n",
    suite: ['unit', '@cms/web'],
  },
  {
    name: 'studio stores a form-posted body with CRLF line endings',
    file: 'packages/shared/src/contracts/studio.ts',
    from: ".transform((body) => body.replace(/\\r\\n?/gu, '\\n'))",
    to: '.transform((body) => body)',
    suite: ['unit', '@cms/shared'],
  },
];

const filters = process.argv.slice(2);
const chosen = PROOFS.filter(
  (p) => filters.length === 0 || filters.some((filter) => p.name.includes(filter)),
);
if (chosen.length === 0) {
  console.error(`red-proofs: no proof matches ${filters.map((f) => `"${f}"`).join(' or ')}`);
  process.exit(2);
}

/** cms_it, derived the way scripts/integration.sh derives it. */
function integrationDatabase() {
  const base = process.env.DATABASE_URL ?? 'postgresql://cms:cms@localhost:5444/cms?schema=public';
  return process.env.INTEGRATION_DATABASE_URL ?? base.replace('/cms?', '/cms_it?');
}

function run(suite) {
  const [lane, arg] = suite;
  const options = { cwd: ROOT, encoding: 'utf8' };
  const result =
    lane === 'publisher'
      ? spawnSync(
          'pnpm',
          [
            '--filter',
            '@cms/publisher',
            'exec',
            'vitest',
            'run',
            '--config',
            'vitest.integration.config.ts',
          ],
          { ...options, env: { ...process.env, DATABASE_URL: integrationDatabase() } },
        )
      : lane === 'unit'
        ? spawnSync('pnpm', ['--filter', arg ?? '@cms/api', 'exec', 'vitest', 'run'], options)
        : lane === 'bench'
          ? spawnSync('pnpm', ['search:bench'], options)
          : spawnSync('./scripts/integration.sh', [arg], options);
  return {
    status: result.status,
    tail: `${result.stdout}${result.stderr}`
      .split('\n')
      .filter((l) => /×|FAIL|error TS|search-bench: \d+ searches/u.test(l))
      .slice(0, 3),
  };
}

const BACKUP = '.red-proof-orig';
for (const file of new Set(PROOFS.map((p) => p.file))) {
  const path = join(ROOT, file);
  if (existsSync(path + BACKUP)) {
    renameSync(path + BACKUP, path);
    console.log(`red-proofs: restored ${file} from a run that was killed mid-proof`);
  }
}

let restore = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restore?.();
    process.exit(130);
  });
}

const results = [];
for (const proof of chosen) {
  const path = join(ROOT, proof.file);
  const original = readFileSync(path, 'utf8');
  const edits = [proof, ...(proof.also === undefined ? [] : [proof.also])];
  const counts = edits.map((edit) => original.split(edit.from).length - 1);
  if (counts.some((count) => count !== 1)) {
    results.push({ name: proof.name, verdict: `MOVED (matches ${counts.join('/')} times)` });
    continue;
  }
  writeFileSync(path + BACKUP, original);
  restore = () => renameSync(path + BACKUP, path);
  try {
    writeFileSync(
      path,
      edits.reduce((text, edit) => text.replace(edit.from, edit.to), original),
    );
    process.stdout.write(`red-proofs: ${proof.name} ... `);
    const { status, tail } = run(proof.suite);
    const verdict = status === 0 ? 'STAYED GREEN' : 'red';
    console.log(verdict);
    for (const line of tail) console.log(`    ${line.trim()}`);
    results.push({ name: proof.name, verdict });
  } finally {
    restore();
    restore = null;
  }
}

const bad = results.filter((r) => r.verdict !== 'red');
console.log(
  `\nred-proofs: ${String(results.length - bad.length)}/${String(results.length)} went red`,
);
for (const r of bad) console.log(`  ${r.verdict}: ${r.name}`);
process.exit(bad.length === 0 ? 0 : 1);
