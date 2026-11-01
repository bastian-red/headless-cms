import { COMMENT_STATUSES } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { COMMENT_STATUS_UI, decisionsFrom } from './comment-ui';

describe('moderation wording', () => {
  it('offers every decision except the current state', () => {
    expect(decisionsFrom('PENDING')).toEqual(['APPROVED', 'REJECTED', 'SPAM']);
    expect(decisionsFrom('APPROVED')).toEqual(['REJECTED', 'SPAM']);
    expect(decisionsFrom('SPAM')).toEqual(['APPROVED', 'REJECTED']);
  });

  it('gives every state its own glyph', () => {
    const glyphs = COMMENT_STATUSES.map((s) => COMMENT_STATUS_UI[s].glyph);
    expect(new Set(glyphs).size).toBe(COMMENT_STATUSES.length);
  });
});
