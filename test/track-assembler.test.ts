import { describe, expect, it } from 'vitest';
import { Decimator3, TrackAssembler, type PcmDecoder } from '../src/domain/track-assembler.js';

const FRAME = 960; // 20 ms at 48 kHz

/** Fake decoder: the payload's first byte is the constant sample value; output is interleaved stereo. */
const constDecoder: PcmDecoder = {
  decode(payload) {
    const v = payload[0]! * 100;
    return new Int16Array(FRAME * 2).fill(v);
  }
};

function collect() {
  const chunks: Int16Array[] = [];
  return {
    sink: (c: Int16Array) => chunks.push(c),
    all: () => {
      const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    }
  };
}

const pkt = (value: number, rtp: number, arrivalFrames: number) => ({
  payload: Buffer.from([value, 1, 2, 3]),
  rtpTimestamp: rtp,
  arrivalSamples48k: arrivalFrames * FRAME
});

describe('Decimator3', () => {
  it('produces one output sample per three inputs', () => {
    const d = new Decimator3();
    expect(d.process(new Int16Array(960)).length).toBe(320);
    expect(d.process(new Int16Array(960)).length).toBe(320);
  });

  it('preserves DC level once settled', () => {
    const d = new Decimator3();
    const out = d.process(new Int16Array(4800).fill(1000));
    expect(out[out.length - 1]).toBeGreaterThan(995);
    expect(out[out.length - 1]).toBeLessThan(1005);
  });

  it('passes a 1 kHz tone and strongly attenuates a 20 kHz tone', () => {
    const tone = (hz: number) => {
      const x = new Int16Array(48000);
      for (let i = 0; i < x.length; i++) x[i] = Math.round(10000 * Math.sin((2 * Math.PI * hz * i) / 48000));
      const out = new Decimator3().process(x);
      let peak = 0;
      for (let i = 1000; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
      return peak;
    };
    expect(tone(1000)).toBeGreaterThan(9500);
    expect(tone(20000)).toBeLessThan(500);
  });
});

describe('TrackAssembler', () => {
  it('downmixes to mono and decimates to 16 kHz', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    for (let i = 0; i < 5; i++) a.push(pkt(10, i * FRAME, i));
    a.finish();
    const pcm = c.all();
    expect(pcm.length).toBe(5 * 320);
    expect(pcm[pcm.length - 1]).toBeGreaterThan(990);
    expect(pcm[pcm.length - 1]).toBeLessThan(1010);
  });

  it('pads leading silence so the track is aligned to the recording start', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    // first packet arrives 50 frames (1 s) after recording start
    a.push(pkt(10, 123456, 50));
    a.finish();
    const pcm = c.all();
    expect(pcm.length).toBe(50 * 320 + 320);
    expect(pcm.subarray(0, 50 * 320).every((s) => s === 0)).toBe(true);
    expect(pcm[50 * 320 + 319]).not.toBe(0);
  });

  it('pads silence for gaps in the RTP timeline (speaker stopped sending)', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push(pkt(10, 0, 0));
    // next packet is 100 frames later in both RTP and arrival time
    a.push(pkt(10, 100 * FRAME, 100));
    a.finish();
    expect(c.all().length).toBe(101 * 320);
  });

  it('re-anchors to arrival time when the RTP timeline jumps', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push(pkt(10, 0, 0));
    // RTP jumps backwards massively but 200 frames of real time passed
    a.push(pkt(10, 5, 200));
    a.finish();
    expect(c.all().length).toBe(201 * 320);
  });

  it('handles 32-bit RTP timestamp wraparound', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    const start = 0xffffffff - FRAME + 1; // next frame wraps to 0
    a.push(pkt(10, start, 0));
    a.push(pkt(10, 0, 1));
    a.push(pkt(10, FRAME, 2));
    a.finish();
    expect(c.all().length).toBe(3 * 320);
  });

  it('reorders out-of-order packets by RTP timestamp', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push(pkt(1, 0, 0));
    a.push(pkt(3, 2 * FRAME, 2));
    a.push(pkt(2, FRAME, 2)); // late: belongs between 1 and 3
    a.finish();
    const pcm = c.all();
    expect(pcm.length).toBe(3 * 320);
    // settle point of each frame (its last sample) must be ~100, 200, 300
    expect(Math.round(pcm[319]! / 100)).toBe(1);
    expect(Math.round(pcm[639]! / 100)).toBe(2);
    expect(Math.round(pcm[959]! / 100)).toBe(3);
  });

  it('drops packets that arrive after a later one was already emitted', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink, reorderDepth: 2 });
    for (let i = 0; i < 6; i++) a.push(pkt(5, (i + 1) * FRAME, i + 1));
    a.push(pkt(5, 0, 7)); // far too late
    a.finish();
    expect(c.all().length).toBe(7 * 320); // 1 frame of leading silence + 6 frames
    expect(a.stats.late).toBe(1);
  });

  it('drops mostly-zero packets', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push({ payload: Buffer.alloc(40), rtpTimestamp: 0, arrivalSamples48k: 0 });
    a.finish();
    expect(c.all().length).toBe(0);
    expect(a.stats.zeroPackets).toBe(1);
  });

  it('survives a decode failure and counts it', () => {
    const c = collect();
    const bad: PcmDecoder = {
      decode() {
        throw new Error('corrupt');
      }
    };
    const a = new TrackAssembler({ decoder: bad, sink: c.sink });
    a.push(pkt(1, 0, 0));
    a.finish();
    expect(a.stats.decodeErrors).toBe(1);
  });

  it('pads the tail up to the total recording length on finish', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push(pkt(10, 0, 0));
    a.finish(10 * FRAME);
    expect(c.all().length).toBe(10 * 320);
  });

  it('streams output incrementally instead of buffering everything', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink, reorderDepth: 4 });
    for (let i = 0; i < 100; i++) a.push(pkt(10, i * FRAME, i));
    // before finish, all but the last `reorderDepth` frames have been emitted
    expect(c.all().length).toBeGreaterThanOrEqual((100 - 4) * 320);
  });

  it('writes huge gaps in bounded chunks', () => {
    const sizes: number[] = [];
    const a = new TrackAssembler({ decoder: constDecoder, sink: (x) => sizes.push(x.length) });
    a.push(pkt(10, 0, 3600 * 50)); // one hour of leading silence
    a.finish();
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16000);
    expect(sizes.reduce((x, y) => x + y, 0)).toBe(3600 * 50 * 320 + 320);
  });
});

describe('TrackAssembler RTP discontinuities (reconnect)', () => {
  it('accepts packets after the RTP timeline restarts at a lower value', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push(pkt(10, 2_000_000_000, 0));
    a.push(pkt(10, 2_000_000_000 + FRAME, 1));
    // reconnect: new SSRC, timestamps restart from an unrelated value, 100 frames later
    a.push(pkt(10, 100, 100));
    a.push(pkt(10, 100 + FRAME, 101));
    a.finish();
    expect(a.stats.late).toBe(0);
    expect(c.all().length).toBe(102 * 320);
  });

  it('keeps order of packets across the discontinuity', () => {
    const c = collect();
    const a = new TrackAssembler({ decoder: constDecoder, sink: c.sink });
    a.push(pkt(1, 3_000_000_000, 0));
    a.push(pkt(2, 500, 50));
    a.finish();
    const pcm = c.all();
    expect(Math.round(pcm[319]! / 100)).toBe(1);
    expect(Math.round(pcm[50 * 320 + 319]! / 100)).toBe(2);
  });
});
