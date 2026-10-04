import { describe, expect, it } from 'vitest';
import { isMostlyZeroPacket, stripRtpExtension } from '../src/domain/rtp.js';

describe('isMostlyZeroPacket', () => {
  it('flags packets that are all zeros', () => {
    expect(isMostlyZeroPacket(Buffer.alloc(60))).toBe(true);
  });
  it('flags packets with a single non-zero byte', () => {
    const b = Buffer.alloc(60);
    b[30] = 7;
    expect(isMostlyZeroPacket(b)).toBe(true);
  });
  it('keeps real audio', () => {
    expect(isMostlyZeroPacket(Buffer.from([0, 1, 2, 3]))).toBe(false);
    expect(isMostlyZeroPacket(Buffer.from([0xf8, 0xff, 0xfe]))).toBe(false);
  });
});

describe('stripRtpExtension', () => {
  it('returns the payload untouched when there is no extension', () => {
    const p = Buffer.from([0x78, 1, 2, 3, 4]);
    expect(stripRtpExtension(p)).toEqual(p);
  });

  it('removes a one-byte-header extension block', () => {
    // 0xBE 0xDE, length=1 word-group (as Craig counts: 1 element), element header 0x10 (id=1,len=1 -> 2 bytes data)
    const ext = Buffer.from([0xbe, 0xde, 0x00, 0x01, 0x10, 0xaa, 0x00, 0x00]);
    const opus = Buffer.from([0x78, 9, 9, 9]);
    expect(stripRtpExtension(Buffer.concat([ext, opus]))).toEqual(opus);
  });

  it('skips the extension by its length in 32-bit words (RFC 8285), not by element count', () => {
    // 3 words = 12 bytes of extension data: one element of 8 data bytes (header 0x17) plus 3 padding bytes.
    // Counting elements instead of words would run into the Opus payload and swallow its first byte.
    const ext = Buffer.from([0xbe, 0xde, 0x00, 0x03, 0x17, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0]);
    const opus = Buffer.from([0x78, 9, 9, 9]);
    expect(stripRtpExtension(Buffer.concat([ext, opus]))).toEqual(opus);
  });

  it('keeps a payload that starts with a zero byte after the extension', () => {
    const ext = Buffer.from([0xbe, 0xde, 0x00, 0x01, 0x10, 0xaa, 0x00, 0x00]);
    const opus = Buffer.from([0x00, 9, 9]);
    expect(stripRtpExtension(Buffer.concat([ext, opus]))).toEqual(opus);
  });
});
