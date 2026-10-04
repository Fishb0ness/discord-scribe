import DiscordJsOpus from '@discordjs/opus';
import { describe, expect, it } from 'vitest';
import { createOpusDecoder, opusscriptBackend, selectOpusBackend, type OpusBackend } from '../src/adapters/opus-decoder.js';

describe('createOpusDecoder', () => {
  it('decodes a real Opus frame to 20 ms of interleaved 48 kHz stereo PCM', () => {
    const enc = new DiscordJsOpus.OpusEncoder(48000, 2);
    const pcm = Buffer.alloc(960 * 2 * 2);
    for (let i = 0; i < 960; i++) {
      const v = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 48000));
      pcm.writeInt16LE(v, i * 4);
      pcm.writeInt16LE(v, i * 4 + 2);
    }
    const packet = enc.encode(pcm);
    const out = createOpusDecoder().decode(packet);
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(960 * 2);
  });

  it('decodes the Opus silence frame without throwing', () => {
    expect(createOpusDecoder().decode(Buffer.from([0xf8, 0xff, 0xfe])).length).toBeGreaterThan(0);
  });
});

describe('selectOpusBackend', () => {
  const working = (name: string): OpusBackend => ({ name, create: () => ({ decode: () => new Int16Array(2) }) });
  const broken = (name: string): OpusBackend => ({
    name,
    create: () => {
      throw new Error(`${name}: no prebuilt binary`);
    }
  });

  it('prefers the first backend that loads', () => {
    expect(selectOpusBackend([working('native'), working('wasm')]).name).toBe('native');
  });

  it('falls back when the native backend cannot load and reports why', () => {
    const skipped: string[] = [];
    const chosen = selectOpusBackend([broken('native'), working('opusscript')], (b, e) => skipped.push(`${b.name}: ${e.message}`));
    expect(chosen.name).toBe('opusscript');
    expect(skipped).toEqual(['native: native: no prebuilt binary']);
  });

  it('throws one error naming every backend when none loads', () => {
    expect(() => selectOpusBackend([broken('native'), broken('opusscript')])).toThrow(/native.*opusscript/s);
  });
});

describe('opusscript fallback decoder', () => {
  it('decodes a real Opus frame to the same PCM shape as the native one', () => {
    const enc = new DiscordJsOpus.OpusEncoder(48000, 2);
    const pcm = Buffer.alloc(960 * 2 * 2);
    for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 48000)), i * 4);
    const out = opusscriptBackend.create().decode(enc.encode(pcm));
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(960 * 2);
  });
});
