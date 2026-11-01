/**
 * The constants a browser form needs, with no zod behind them.
 *
 * `@cms/shared` ships CommonJS, which a bundler cannot tree-shake: a client
 * component that imports one constant from the package root ships every zod
 * contract with it (about 500 KB on the public post page, measured by
 * Lighthouse on 2026-11-01). Client components import these from
 * `@cms/shared/constants` instead; `constants.test.ts` holds this file import-free
 * and `apps/web/lib/client-imports.test.ts` holds the client components to it.
 *
 * The contracts re-export every name here, so server code keeps one import.
 */

/**
 * Every length limit, in characters. The SEO pair follows what search results
 * show before truncating (about 60-70 and 155-160), so a limit here is a
 * promise the snippet will not be cut mid-word by the engine.
 */
export const LIMITS = Object.freeze({
  slug: 96,
  title: 160,
  excerpt: 300,
  body: 200_000,
  seoTitle: 70,
  seoDescription: 160,
  tagName: 40,
  commentName: 80,
  commentBody: 2_000,
  mediaAlt: 300,
});

/** Tags one revision may carry. */
export const MAX_TAGS_PER_REVISION = 8;

/**
 * The honeypot: a field a person never sees and a form-filling bot fills. A
 * submission with it set is answered exactly like a real one (so the bot learns
 * nothing) and stored nowhere.
 */
export const COMMENT_HONEYPOT_FIELD = 'website';

export const ROLES = ['AUTHOR', 'EDITOR', 'ADMIN'] as const;

/** A schedule must be at least this far ahead, so it cannot fire before the editor's request returns. */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

/** What a moderator can decide. A comment never goes back to PENDING. */
export const DECISIONS = ['APPROVED', 'REJECTED', 'SPAM'] as const;
