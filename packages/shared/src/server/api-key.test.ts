import { describe, expect, it } from 'vitest';

import { API_KEY_PATTERN } from '../contracts/content-api';
import { generateApiKey, hashApiKey, looksLikeApiKey } from './api-key';

describe('content API keys', () => {
  it('have the documented shape, and a prefix the database CHECK accepts', () => {
    for (let i = 0; i < 50; i += 1) {
      const { key, prefix, keyHash } = generateApiKey();
      expect(key).toMatch(API_KEY_PATTERN);
      // api_keys_prefix_check and api_keys_key_hash_check in the content migration.
      expect(prefix).toMatch(/^hcms_[A-Za-z0-9_-]{8}$/u);
      expect(key.startsWith(prefix)).toBe(true);
      expect(keyHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(hashApiKey(key)).toBe(keyHash);
    }
  });

  it('are never the same twice', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
    expect(keys.size).toBe(200);
  });

  it('are recognised by shape before any lookup', () => {
    expect(looksLikeApiKey(generateApiKey().key)).toBe(true);
    expect(looksLikeApiKey('hcms_short')).toBe(false);
    expect(looksLikeApiKey(`Bearer ${generateApiKey().key}`)).toBe(false);
  });
});
