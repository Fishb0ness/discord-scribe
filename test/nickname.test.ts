import { describe, expect, it } from 'vitest';
import { RECORDING_PREFIX, withRecordingIndicator, withoutRecordingIndicator, staleIndicatorFix } from '../src/domain/nickname.js';

describe('recording nickname indicator', () => {
  it('prefixes the base name', () => {
    expect(withRecordingIndicator('Scribe')).toBe(`${RECORDING_PREFIX} Scribe`);
  });
  it('is idempotent', () => {
    expect(withRecordingIndicator(withRecordingIndicator('Scribe'))).toBe(`${RECORDING_PREFIX} Scribe`);
  });
  it('never exceeds the 32 character Discord limit and keeps the prefix', () => {
    const n = withRecordingIndicator('x'.repeat(60));
    expect(n.length).toBeLessThanOrEqual(32);
    expect(n.startsWith(RECORDING_PREFIX)).toBe(true);
  });
  it('removes the indicator, returning null when nothing else remains', () => {
    expect(withoutRecordingIndicator(`${RECORDING_PREFIX} Scribe`)).toBe('Scribe');
    expect(withoutRecordingIndicator(RECORDING_PREFIX)).toBeNull();
    expect(withoutRecordingIndicator('Scribe')).toBe('Scribe');
    expect(withoutRecordingIndicator(null)).toBeNull();
  });
});

describe('staleIndicatorFix', () => {
  it('returns nothing to fix for a clean or missing nickname', () => {
    expect(staleIndicatorFix(null)).toBeUndefined();
    expect(staleIndicatorFix('Scribe')).toBeUndefined();
  });
  it('returns the cleaned nickname for a stale indicator', () => {
    expect(staleIndicatorFix(`${RECORDING_PREFIX} Scribe`)).toEqual({ nick: 'Scribe' });
  });
  it('resets to the default name when only the indicator is left', () => {
    expect(staleIndicatorFix(RECORDING_PREFIX)).toEqual({ nick: null });
  });
});
