import { describe, expect, it } from 'vitest';
import { wavHeader } from '../src/domain/wav.js';

describe('wavHeader', () => {
  it('writes a canonical 44-byte PCM header for 16 kHz mono 16-bit', () => {
    const h = wavHeader(32000);
    expect(h.length).toBe(44);
    expect(h.toString('ascii', 0, 4)).toBe('RIFF');
    expect(h.readUInt32LE(4)).toBe(36 + 32000);
    expect(h.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(h.readUInt32LE(16)).toBe(16);
    expect(h.readUInt16LE(20)).toBe(1); // PCM
    expect(h.readUInt16LE(22)).toBe(1); // mono
    expect(h.readUInt32LE(24)).toBe(16000);
    expect(h.readUInt32LE(28)).toBe(32000); // byte rate
    expect(h.readUInt16LE(32)).toBe(2); // block align
    expect(h.readUInt16LE(34)).toBe(16);
    expect(h.toString('ascii', 36, 40)).toBe('data');
    expect(h.readUInt32LE(40)).toBe(32000);
  });

  it('supports a zero-length placeholder header', () => {
    const h = wavHeader(0);
    expect(h.readUInt32LE(4)).toBe(36);
    expect(h.readUInt32LE(40)).toBe(0);
  });
});
