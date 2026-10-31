/**
 * Content API keys: made here, stored as a hash, shown once.
 *
 * A key is `hcms_` + 8 characters + 43 characters (32 random bytes,
 * base64url). The first 13 characters are the `prefix`, stored in the clear
 * so the studio can tell keys apart; the whole key is stored only as its
 * SHA-256. A plain hash, not scrypt: the key is 256 bits of randomness, so
 * there is nothing for a slow hash to protect against, and the lookup runs on
 * every content API request.
 */
import { createHash, randomBytes } from 'node:crypto';

import { API_KEY_PATTERN, API_KEY_PREFIX } from '../contracts/content-api';

export interface NewApiKey {
  readonly key: string;
  readonly prefix: string;
  readonly keyHash: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): NewApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(6).toString('base64url')}${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 8), keyHash: hashApiKey(key) };
}

/** True when `value` has the shape of a key. Checked before any database lookup. */
export function looksLikeApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}
