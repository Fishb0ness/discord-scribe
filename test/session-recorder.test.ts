import { describe, expect, it } from 'vitest';
import { SessionRecorder, type WavSink } from '../src/app/session-recorder.js';
import type { PcmDecoder } from '../src/domain/track-assembler.js';

const FRAME = 960;
const decoder: PcmDecoder = { decode: (p) => new Int16Array(FRAME * 2).fill(p[0]! * 100) };

function setup() {
  const sinks = new Map<string, { samples: number; closed: boolean; path: string }>();
  let nowNs = 0n;
  const rec = new SessionRecorder({
    nowNs: () => nowNs,
    startNs: 0n,
    createDecoder: () => decoder,
    createWav: (userId): WavSink => {
      const s = { samples: 0, closed: false, path: `/w/${userId}.wav` };
      sinks.set(userId, s);
      return { path: s.path, write: (pcm) => void (s.samples += pcm.length), close: () => void (s.closed = true) };
    }
  });
  return { rec, sinks, advanceMs: (ms: number) => void (nowNs += BigInt(ms) * 1_000_000n) };
}

describe('SessionRecorder', () => {
  it('creates one track per speaker and aligns each to the recording start', () => {
    const { rec, sinks, advanceMs } = setup();
    advanceMs(1000);
    rec.handlePacket(Buffer.from([5, 1, 1]), 'ana', 1000);
    advanceMs(1000);
    rec.handlePacket(Buffer.from([5, 1, 1]), 'luis', 99);
    advanceMs(1000);
    const tracks = rec.finish();
    expect(tracks.map((t) => t.userId).sort()).toEqual(['ana', 'luis']);
    // total recording is 3 s -> every track is padded to 3 s at 16 kHz
    expect(sinks.get('ana')!.samples).toBe(48000);
    expect(sinks.get('luis')!.samples).toBe(48000);
    expect(sinks.get('ana')!.closed).toBe(true);
  });

  it('counts accepted packets and ignores zero packets', () => {
    const { rec } = setup();
    rec.handlePacket(Buffer.alloc(30), 'ana', 0);
    expect(rec.packetsAccepted).toBe(0);
    expect(rec.speakerIds()).toEqual([]);
    rec.handlePacket(Buffer.from([5, 1]), 'ana', 0);
    expect(rec.packetsAccepted).toBe(1);
  });

  it('ignores packets after finish', () => {
    const { rec } = setup();
    rec.finish();
    rec.handlePacket(Buffer.from([5, 1]), 'ana', 0);
    expect(rec.speakerIds()).toEqual([]);
  });

  it('keeps finishing the other tracks when one WAV cannot be closed', () => {
    const errors: string[] = [];
    const rec = new SessionRecorder({
      nowNs: () => 0n,
      startNs: 0n,
      createDecoder: () => decoder,
      createWav: (userId): WavSink => ({
        path: `/w/${userId}.wav`,
        write: () => {},
        close: () => {
          if (userId === 'ana') throw new Error('disk full');
        }
      }),
      onTrackError: (userId) => errors.push(userId)
    });
    rec.handlePacket(Buffer.from([5, 1, 1]), 'ana', 0);
    rec.handlePacket(Buffer.from([5, 1, 1]), 'luis', 0);
    expect(rec.finish().map((t) => t.userId)).toEqual(['luis']);
    expect(errors).toEqual(['ana']);
  });
});
