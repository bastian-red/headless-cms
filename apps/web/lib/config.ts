/**
 * Every environment variable this app reads, in one module.
 *
 * All of them are server-only. There is deliberately no `NEXT_PUBLIC_*` name:
 * the browser never calls the API. Server components read through `apiFetch`,
 * server actions write through it, and anything the browser starts goes to this
 * app's own route handlers, which call the API with a service token. So the API has no CORS
 * surface and no service token ever reaches browser JavaScript.
 *
 * Every read is spelled out literally because `scripts/env-contract.mjs` finds
 * reads by pattern and turbo runs in strict env mode: a name it cannot see is a
 * name that is silently stripped from the process.
 */

/** Where the server reaches the API. A service name inside compose, localhost on a laptop. */
export const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** Reported on `/status`, so two builds are tellable apart. */
export const appVersion = process.env.APP_VERSION ?? '0.0.0';

/**
 * The shared HS256 secret.
 *
 * Asserted here rather than where it is used: a missing secret makes every
 * signed-in call fail at once, which presents as an empty studio rather than an
 * error. Failing here turns that into one sentence.
 */
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret === undefined || secret.length < 16) {
    throw new Error(
      'AUTH_SECRET must be set and at least 16 characters. Without it the web app cannot mint ' +
        'the service token the API verifies.',
    );
  }
  return secret;
}

/**
 * The site's public origin. Canonical URLs, the sitemap, the feed and Open Graph
 * tags are absolute URLs built from it (build step 6), so it must be the address
 * readers and crawlers use, never the API's.
 */
export const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

/**
 * The public site's content API key (`hcms_...`). The site reads published
 * content through `GET /v1/*` like any other headless client, so it holds a
 * key; `pnpm db:seed` registers this one (by its hash) for local use.
 *
 * Asserted at the first read rather than at import: the studio and sign-in
 * never need it, and a missing key should name itself, not surface as a 401.
 */
export function contentApiKey(): string {
  const key = process.env.CONTENT_API_KEY;
  if (key === undefined || !/^hcms_[A-Za-z0-9_-]{51}$/u.test(key)) {
    throw new Error(
      'CONTENT_API_KEY must be a content API key (hcms_ + 51 characters). Generate one and ' +
        'reseed so the API knows it: see README.md, "Running it".',
    );
  }
  return key;
}

/**
 * `deferred` builds without the API: every public page renders per request
 * and only the content reads are cached. Set by `infra/Dockerfile.web`, whose
 * build has no API to read; any other build prerenders, and fails if the API
 * is unreachable rather than shipping empty pages.
 */
export const contentAtBuild = process.env.CONTENT_AT_BUILD === 'deferred' ? 'deferred' : 'required';
