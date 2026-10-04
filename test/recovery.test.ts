import { describe, expect, it, vi } from 'vitest';
import { EncryptionRecoveryMonitor, retry } from '../src/domain/recovery.js';
import { isOpusSilence } from '../src/domain/rtp.js';

describe('EncryptionRecoveryMonitor', () => {
  it('signals a stop after the threshold of invalidated transitions', () => {
    const m = new EncryptionRecoveryMonitor(3);
    expect(m.onWarning('Invalidating transition 5')).toBe(false);
    expect(m.onWarning('Invalidating transition 6')).toBe(false);
    expect(m.onWarning('Invalidating transition 7')).toBe(true);
  });
  it('ignores unrelated warnings', () => {
    const m = new EncryptionRecoveryMonitor(1);
    expect(m.onWarning('Failed to decrypt received E2EE packet')).toBe(false);
  });
  it('resets when real audio arrives', () => {
    const m = new EncryptionRecoveryMonitor(2);
    m.onWarning('Invalidating transition 1');
    m.onAudio(Buffer.from([1, 2, 3]));
    expect(m.onWarning('Invalidating transition 2')).toBe(false);
  });
  it('does not reset on Opus silence frames', () => {
    const m = new EncryptionRecoveryMonitor(2);
    m.onWarning('Invalidating transition 1');
    m.onAudio(Buffer.from([0xf8, 0xff, 0xfe]));
    expect(m.onWarning('Invalidating transition 2')).toBe(true);
  });
  it('fires only once', () => {
    const m = new EncryptionRecoveryMonitor(1);
    expect(m.onWarning('Invalidating transition 1')).toBe(true);
    expect(m.onWarning('Invalidating transition 2')).toBe(false);
  });
});

describe('isOpusSilence', () => {
  it('matches the 3-byte Opus silence frame only', () => {
    expect(isOpusSilence(Buffer.from([0xf8, 0xff, 0xfe]))).toBe(true);
    expect(isOpusSilence(Buffer.from([0xf8, 0xff, 0xfd]))).toBe(false);
  });
});

describe('retry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retry(3, fn, async () => {})).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('retries up to the attempt limit, waiting between attempts', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockResolvedValue('ok');
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(retry(3, fn, wait)).resolves.toBe('ok');
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it('throws the last error when all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValue(new Error('last'));
    await expect(retry(2, fn, async () => {})).rejects.toThrow('last');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
