import { describe, expect, it } from 'vitest';
import { wavDurationSeconds, whisperTimeoutMs } from '../src/adapters/whisper-cli-transcriber.js';

describe('whisperTimeoutMs', () => {
  it('never goes below 10 minutes', () => {
    expect(whisperTimeoutMs(0)).toBe(10 * 60 * 1000);
    expect(whisperTimeoutMs(60)).toBe(10 * 60 * 1000);
  });
  it('allows 3x the audio length for long recordings', () => {
    expect(whisperTimeoutMs(2 * 3600)).toBe(3 * 2 * 3600 * 1000);
  });
});

describe('wavDurationSeconds', () => {
  it('derives the duration of a 16 kHz mono 16-bit WAV from its size', () => {
    expect(wavDurationSeconds(44 + 32000 * 10)).toBe(10);
    expect(wavDurationSeconds(10)).toBe(0);
  });
});
