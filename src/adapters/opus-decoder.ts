import { createRequire } from 'node:module';
import type { PcmDecoder } from '../domain/track-assembler.js';

/** A way to decode Opus. Native libopus is preferred; opusscript (WebAssembly) is the portable fallback. */
export interface OpusBackend {
  name: string;
  /** Creates a decoder; throws if the backend cannot be loaded on this platform. */
  create(): PcmDecoder;
}

// Loaded lazily with require so a missing native binary does not break importing this module.
const require = createRequire(import.meta.url);

function toInt16(pcm: Uint8Array): Int16Array {
  // Copy: the Buffer may sit at an unaligned offset of a shared pool.
  return new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength - (pcm.byteLength % 2)));
}

/**
 * Native libopus via @discordjs/opus, one stateful 48 kHz stereo decoder per speaker.
 * Despite its name, its `OpusEncoder` class both encodes and decodes; we only call `decode`.
 */
export const nativeOpusBackend: OpusBackend = {
  name: '@discordjs/opus',
  create() {
    const mod = require('@discordjs/opus') as { OpusEncoder: new (rate: number, channels: number) => { decode(p: Buffer): Buffer } };
    const opus = new mod.OpusEncoder(48000, 2);
    return { decode: (payload) => toInt16(opus.decode(payload)) };
  }
};

/** WebAssembly build of libopus: slower, but needs no prebuilt binary (e.g. unusual Linux or Windows ARM). */
export const opusscriptBackend: OpusBackend = {
  name: 'opusscript',
  create() {
    const OpusScript = require('opusscript') as {
      new (rate: number, channels: number, application: number): { decode(p: Buffer): Buffer };
      Application: { AUDIO: number };
    };
    const opus = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    return { decode: (payload) => toInt16(opus.decode(payload)) };
  }
};

/** Returns the first backend that can create a decoder, reporting each one that failed. */
export function selectOpusBackend(backends: OpusBackend[], onSkipped?: (backend: OpusBackend, error: Error) => void): OpusBackend {
  const failures: string[] = [];
  for (const backend of backends) {
    try {
      backend.create();
      return backend;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      onSkipped?.(backend, error);
      failures.push(`${backend.name}: ${error.message}`);
    }
  }
  throw new Error(`No Opus decoder could be loaded (${failures.join('; ')})`);
}

let selected: OpusBackend | undefined;

/** One Opus decoder per speaker, using the best backend available on this machine. */
export function createOpusDecoder(): PcmDecoder {
  selected ??= selectOpusBackend([nativeOpusBackend, opusscriptBackend], (b, e) =>
    console.warn(`Opus backend ${b.name} unavailable (${e.message}); trying the next one`)
  );
  return selected.create();
}
