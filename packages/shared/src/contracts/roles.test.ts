import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ACTIONS, atLeast, can, PERMISSIONS, ROLES, type Role } from './roles';

describe('the role matrix', () => {
  it('is monotonic: a more powerful role can do everything a weaker one can', () => {
    for (let i = 0; i < ROLES.length - 1; i += 1) {
      const weaker = ROLES[i]!;
      const stronger = ROLES[i + 1]!;
      for (const action of PERMISSIONS[weaker])
        expect(can(stronger, action), `${stronger} ${action}`).toBe(true);
    }
  });

  it('never lets an author decide what readers see', () => {
    for (const action of ['post.publish', 'post.write.any', 'comment.moderate'] as const)
      expect(can('AUTHOR', action), action).toBe(false);
  });

  it('reserves people and API keys for the admin', () => {
    for (const role of ROLES) {
      expect(can(role, 'user.manage')).toBe(role === 'ADMIN');
      expect(can(role, 'apikey.manage')).toBe(role === 'ADMIN');
    }
  });

  it('grants the admin every action there is', () => {
    for (const action of ACTIONS) expect(can('ADMIN', action), action).toBe(true);
  });
});

describe('atLeast', () => {
  const role = fc.constantFrom<Role>(...ROLES);

  it('agrees with the matrix: at least X can do everything X can', () => {
    fc.assert(
      fc.property(role, role, (actor, floor) => {
        if (!atLeast(actor, floor)) return;
        for (const action of PERMISSIONS[floor]) expect(can(actor, action)).toBe(true);
      }),
    );
  });

  it('is reflexive and ordered', () => {
    expect(atLeast('EDITOR', 'EDITOR')).toBe(true);
    expect(atLeast('ADMIN', 'AUTHOR')).toBe(true);
    expect(atLeast('AUTHOR', 'EDITOR')).toBe(false);
  });
});
