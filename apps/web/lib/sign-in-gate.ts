/**
 * Where a signed-out request for a protected page is sent: sign-in, with the
 * WHOLE path and query as `next`.
 *
 * Why this lives in the proxy and not in a layout: a layout runs before its
 * page and does not know the URL it is rendering, so a redirect from the
 * studio's layout could only say `next=/studio`, and a deep link to one draft
 * would come back to the post list. A sibling project's E2E suite caught
 * exactly that.
 *
 * Cookie PRESENCE only. Verifying the session is the pages' job (and the
 * API's, on every call); this only decides where a request with no session at
 * all should go first. A forged cookie gets past this and is then refused by
 * `auth()`, which redirects with the shorter `next`, which is fine.
 */
export const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'] as const;

const PROTECTED = /^\/studio(\/|$)/u;

export function signInRedirect(
  pathname: string,
  search: string,
  cookieNames: readonly string[],
): string | null {
  if (!PROTECTED.test(pathname)) return null;
  // Auth.js splits a large session into chunks: authjs.session-token.0, .1, ...
  const signedIn = cookieNames.some((name) =>
    SESSION_COOKIES.some((c) => name === c || name.startsWith(`${c}.`)),
  );
  if (signedIn) return null;
  return `/sign-in?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
