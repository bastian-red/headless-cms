#!/usr/bin/env node
/**
 * The search bench's corpus, and the version that says which corpus a bench
 * database holds.
 *
 *   node scripts/bench-corpus.mjs --self-test
 *
 * The version is a hash of what the bench writes, never a hand-kept label.
 * The corpus draws its words from the seeded posts, so editing one seeded
 * post changes every generated body; a constant `'v1'` stayed `'v1'` across
 * that, and a bench database loaded before the edit was reused as if it held
 * this corpus. Hashing every row the bench would write, through the same
 * search-document derivation the API uses, makes "the database holds the
 * corpus this script generates" a fact that is checked, not a label someone
 * has to remember to bump.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = join(ROOT, 'packages/db/prisma/content/posts');

export const LIVE = 2000;
export const DRAFTS = 500;

/** mulberry32: small, fast, and the same sequence on every machine. */
export function prng(seed) {
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
export function vocabulary(dir = CONTENT_DIR) {
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

/** 2,000 live posts with two revisions each and 500 one-revision drafts. */
export function corpus({ dir = CONTENT_DIR, live = LIVE, drafts = DRAFTS } = {}) {
  const random = prng(2026);
  const words = vocabulary(dir);
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
  for (let i = 0; i < live + drafts; i += 1) {
    const isLive = i < live;
    const at = new Date(start + Math.floor(random() * 1000) * day);
    posts.push({
      slug: `bench-${String(i).padStart(4, '0')}`,
      live: isLive,
      at,
      revisions: isLive ? [revision(), revision()] : [revision()],
    });
  }
  return { posts, words };
}

/**
 * Twelve hex characters of a SHA-256 over every post row and every search
 * document the bench writes. `derive` is the API's `searchDocument`; a change
 * to how a document is derived changes what the index holds, so it changes
 * the version too. The revision id is a placeholder: the database assigns it.
 */
export function corpusVersion(posts, derive) {
  const hash = createHash('sha256');
  for (const post of posts) {
    hash.update(JSON.stringify([post.slug, post.live, post.at.toISOString()]));
    for (const fields of post.revisions) {
      hash.update(JSON.stringify(derive('revision', { ...fields, text: fields.body })));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

/** The bench author's address carries the version, so the database says which corpus it holds. */
export const authorEmail = (version) => `bench-${version}@cms.test`;
export const versionOfEmail = (email) => /^bench-([^@]+)@cms\.test$/u.exec(email)?.[1] ?? null;

// --- Self-test ---------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (ok, what) => {
    if (!ok) failures.push(what);
  };
  const dir = mkdtempSync(join(tmpdir(), 'bench-corpus-'));
  const derive = (id, f) => ({ id, title: f.title, text: f.text });
  try {
    writeFileSync(join(dir, 'a.md'), 'alpha beta gamma beta gamma gamma delta words here\n');
    writeFileSync(join(dir, 'b.md'), 'gamma delta epsilon zeta eta theta\n');
    const small = { dir, live: 4, drafts: 2 };

    const first = corpusVersion(corpus(small).posts, derive);
    expect(/^[0-9a-f]{12}$/u.test(first), `version is 12 hex characters (got ${first})`);
    expect(
      corpusVersion(corpus(small).posts, derive) === first,
      'the same content gives the same version',
    );

    writeFileSync(join(dir, 'b.md'), 'gamma delta epsilon zeta eta iota\n');
    expect(
      corpusVersion(corpus(small).posts, derive) !== first,
      'one changed word in a seeded post changes the version',
    );
    writeFileSync(join(dir, 'b.md'), 'gamma delta epsilon zeta eta theta\n');
    expect(
      corpusVersion(corpus(small).posts, derive) === first,
      'restoring the word restores the version',
    );

    const otherDerive = (id, f) => ({ id, title: f.title.toLowerCase(), text: f.text });
    expect(
      corpusVersion(corpus(small).posts, otherDerive) !== first,
      'a different search-document derivation changes the version',
    );
    expect(
      corpusVersion(corpus({ ...small, drafts: 3 }).posts, derive) !== first,
      'a different post count changes the version',
    );

    expect(versionOfEmail(authorEmail(first)) === first, 'the author address round-trips');
    expect(versionOfEmail('bench-v1@cms.test') === 'v1', 'an old label is read back as itself');
    expect(versionOfEmail('editor@cms.test') === null, 'a seeded account is not a bench author');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`bench-corpus self-test: FAIL ${f}`);
    process.exit(1);
  }
  console.log('bench-corpus self-test: 9 cases pass.');
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  selfTest();
}
