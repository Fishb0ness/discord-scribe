import { describe, expect, it } from 'vitest';
import { createPacketGuard } from '../src/domain/packet-guard.js';

function setup(failures: number[]) {
  const errors: unknown[] = [];
  let gaveUp = 0;
  let calls = 0;
  const handler = (_n: number) => {
    calls++;
    if (failures.includes(calls)) throw new Error(`boom ${calls}`);
  };
  const guarded = createPacketGuard(handler, {
    maxConsecutiveFailures: 3,
    onError: (e) => errors.push(e),
    onGiveUp: () => void gaveUp++
  });
  return { guarded, errors, gaveUp: () => gaveUp, calls: () => calls };
}

describe('createPacketGuard', () => {
  it('swallows and reports handler errors', () => {
    const g = setup([1]);
    expect(() => g.guarded(1)).not.toThrow();
    expect(g.errors).toHaveLength(1);
  });
  it('resets the failure count after a success', () => {
    const g = setup([1, 2, 4, 5]);
    for (let i = 0; i < 6; i++) g.guarded(i);
    expect(g.gaveUp()).toBe(0);
  });
  it('gives up once after too many consecutive failures and then ignores packets', () => {
    const g = setup([1, 2, 3, 4, 5]);
    for (let i = 0; i < 8; i++) g.guarded(i);
    expect(g.gaveUp()).toBe(1);
    expect(g.calls()).toBe(3);
  });
});
