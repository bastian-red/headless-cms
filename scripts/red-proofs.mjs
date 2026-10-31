#!/usr/bin/env node
/**
 * Red proofs for the API's and search's guarantees: break each one in the source, run the
 * suite that claims to hold it, and require that suite to FAIL. A check that
 * has never failed is a check whose meaning nobody knows.
 *
 *   node scripts/red-proofs.mjs            # every proof
 *   node scripts/red-proofs.mjs revoked    # proofs whose name matches
 *
 * Each mutation must match its file exactly once (so a refactor that moves
 * the line fails here loudly instead of "proving" nothing), and the original
 * file is restored afterwards, also on Ctrl-C. Needs the datastores up, like
 * `./scripts/integration.sh`, which it calls.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
];

const filter = process.argv[2];
const chosen = PROOFS.filter((p) => filter === undefined || p.name.includes(filter));
if (chosen.length === 0) {
  console.error(`red-proofs: no proof matches "${filter}"`);
  process.exit(2);
}

function run(suite) {
  const [lane, arg] = suite;
  const options = { cwd: ROOT, encoding: 'utf8' };
  const result =
    lane === 'unit'
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
  const count = original.split(proof.from).length - 1;
  if (count !== 1) {
    results.push({ name: proof.name, verdict: `MOVED (matches ${String(count)} times)` });
    continue;
  }
  restore = () => writeFileSync(path, original);
  try {
    writeFileSync(path, original.replace(proof.from, proof.to));
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
