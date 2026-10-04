import { describe, expect, it } from 'vitest';
import { guildsToLeave, isGuildAllowed } from '../src/domain/access.js';

describe('access control', () => {
  const allowed = ['111111111111111111', '222222222222222222'];

  it('allows only listed guilds', () => {
    expect(isGuildAllowed(allowed, '111111111111111111')).toBe(true);
    expect(isGuildAllowed(allowed, '333333333333333333')).toBe(false);
  });

  it('rejects DMs (no guild) and an empty allow list', () => {
    expect(isGuildAllowed(allowed, undefined)).toBe(false);
    expect(isGuildAllowed([], '111111111111111111')).toBe(false);
  });

  it('lists the cached guilds that are not allowed', () => {
    expect(guildsToLeave(allowed, ['111111111111111111', '333333333333333333', '444444444444444444'])).toEqual([
      '333333333333333333',
      '444444444444444444'
    ]);
  });
});
