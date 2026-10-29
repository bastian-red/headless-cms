import { describe, expect, it } from 'vitest';

import { signInRedirect } from './sign-in-gate';

describe('the signed-out deep link', () => {
  it('keeps the whole path and query', () => {
    expect(signInRedirect('/studio/posts/cpost00000000000000000000', '?revision=3', [])).toBe(
      '/sign-in?next=%2Fstudio%2Fposts%2Fcpost00000000000000000000%3Frevision%3D3',
    );
    expect(signInRedirect('/studio', '', ['other'])).toBe('/sign-in?next=%2Fstudio');
  });

  it('lets a request with a session (or a chunked one) through', () => {
    expect(signInRedirect('/studio', '', ['authjs.session-token'])).toBeNull();
    expect(signInRedirect('/studio', '', ['__Secure-authjs.session-token.0'])).toBeNull();
  });

  it('leaves every public page alone, including ones that merely start with "studio"', () => {
    for (const path of ['/', '/sign-in', '/status', '/api/auth/session', '/studios', '/posts/x']) {
      expect(signInRedirect(path, '', []), path).toBeNull();
    }
  });
});
