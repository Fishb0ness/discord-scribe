import { isMostlyZeroPacket } from './rtp.js';

/** Decodes one Opus packet into interleaved 48 kHz PCM (`channels` channels). */
export interface PcmDecoder {
  decode(opusPayload: Buffer): Int16Array;
}

export interface VoicePacket {
  /** Opus payload (RTP extension already stripped). */
  payload: Buffer;
  /** 32-bit RTP timestamp (48 kHz units). */
  rtpTimestamp: number;
  /** Arrival time of the packet, in 48 kHz samples since the recording started. */
  arrivalSamples48k: number;
}

export interface TrackAssemblerOptions {
  decoder: PcmDecoder;
  /** Receives mono 16 kHz PCM chunks in order, covering the track from the recording start. */
  sink: (pcm: Int16Array) => void;
  /** Interleaved channel count produced by the decoder. Default 2. */
  channels?: number;
  /** Packets held for reordering before the oldest is emitted. Craig uses 16. */
  reorderDepth?: number;
}

export interface TrackStats {
  packets: number;
  zeroPackets: number;
  late: number;
  decodeErrors: number;
}

const DECIMATION = 3;
const TAPS = 31;
/** Re-anchor to arrival time when the RTP timeline drifts further than this (500 ms). */
const REANCHOR_SAMPLES_48K = 24000;
const SILENCE_CHUNK = 16000;
/** An RTP timestamp step larger than this (5 s) is treated as a new timeline (reconnect or long pause). */
const DISCONTINUITY_SAMPLES_48K = 240000;

function buildLowPass(): Float32Array {
  const cutoff = 7500 / 48000; // cycles per sample, below the 8 kHz Nyquist of the output
  const mid = (TAPS - 1) / 2;
  const taps = new Float32Array(TAPS);
  let sum = 0;
  for (let n = 0; n < TAPS; n++) {
    const k = n - mid;
    const sinc = k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (TAPS - 1));
    taps[n] = sinc * hamming;
    sum += taps[n]!;
  }
  for (let n = 0; n < TAPS; n++) taps[n]! /= sum;
  return taps;
}

const LOW_PASS = buildLowPass();

/** Streaming 48 kHz -> 16 kHz decimator (windowed-sinc low-pass, then keep every third sample). */
export class Decimator3 {
  private history = new Float32Array(TAPS - 1);
  private phase = 0;

  process(input: Int16Array): Int16Array {
    const ext = new Float32Array(this.history.length + input.length);
    ext.set(this.history);
    for (let i = 0; i < input.length; i++) ext[this.history.length + i] = input[i]!;

    const out: number[] = [];
    // ext[j] is the newest sample of the window ending at j; windows start at index j - (TAPS - 1).
    for (let j = TAPS - 1 + this.phase; j < ext.length; j += DECIMATION) {
      let acc = 0;
      for (let t = 0; t < TAPS; t++) acc += ext[j - t]! * LOW_PASS[t]!;
      out.push(Math.max(-32768, Math.min(32767, Math.round(acc))));
    }
    const consumedUpTo = TAPS - 1 + this.phase + out.length * DECIMATION;
    this.phase = consumedUpTo - ext.length;
    this.history = ext.slice(ext.length - (TAPS - 1));
    return Int16Array.from(out);
  }

  reset(): void {
    this.history.fill(0);
    this.phase = 0;
  }
}

interface Pending {
  ext: number;
  payload: Buffer;
  arrival: number;
}

/**
 * Turns one speaker's stream of Opus packets into a continuous, start-aligned mono 16 kHz PCM
 * stream. Output is pushed to the sink incrementally; nothing but a small reorder window is kept.
 */
export class TrackAssembler {
  readonly stats: TrackStats = { packets: 0, zeroPackets: 0, late: 0, decodeErrors: 0 };

  private readonly decoder: PcmDecoder;
  private readonly sink: (pcm: Int16Array) => void;
  private readonly channels: number;
  private readonly depth: number;
  private readonly decimator = new Decimator3();

  private pending: Pending[] = [];
  private lastRawTs: number | null = null;
  private lastExt = 0;
  private lastEmittedExt: number | null = null;
  private anchor: { ext: number; pos48: number } | null = null;
  private writtenSamples16k = 0;

  constructor(opts: TrackAssemblerOptions) {
    this.decoder = opts.decoder;
    this.sink = opts.sink;
    this.channels = opts.channels ?? 2;
    this.depth = opts.reorderDepth ?? 16;
  }

  /** Number of 16 kHz samples emitted so far. */
  get samplesWritten(): number {
    return this.writtenSamples16k;
  }

  push(packet: VoicePacket): void {
    if (isMostlyZeroPacket(packet.payload)) {
      this.stats.zeroPackets++;
      return;
    }
    this.stats.packets++;

    // Unwrap the 32-bit RTP timestamp into a monotonic-ish number.
    const raw = packet.rtpTimestamp >>> 0;
    let ext: number;
    if (this.lastRawTs === null) {
      ext = raw;
    } else {
      const delta = (raw - this.lastRawTs) | 0;
      if (Math.abs(delta) > DISCONTINUITY_SAMPLES_48K) {
        // New RTP timeline: finish the old one, then position purely by arrival time.
        while (this.pending.length > 0) this.emit(this.pending.shift()!);
        this.lastEmittedExt = null;
        this.anchor = null;
        ext = raw;
      } else {
        ext = this.lastExt + delta;
      }
    }
    this.lastRawTs = raw;
    this.lastExt = ext;

    if (this.lastEmittedExt !== null && ext <= this.lastEmittedExt) {
      this.stats.late++;
      return;
    }

    const entry: Pending = { ext, payload: packet.payload, arrival: packet.arrivalSamples48k };
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1]!.ext > ext) i--;
    this.pending.splice(i, 0, entry);

    while (this.pending.length > this.depth) this.emit(this.pending.shift()!);
  }

  /** Flush the reorder window and optionally pad the tail to the recording length. */
  finish(totalSamples48k?: number): void {
    while (this.pending.length > 0) this.emit(this.pending.shift()!);
    if (totalSamples48k !== undefined) this.padTo(Math.ceil(totalSamples48k / DECIMATION));
  }

  private emit(p: Pending): void {
    this.lastEmittedExt = p.ext;

    let pcm: Int16Array;
    try {
      pcm = this.decoder.decode(p.payload);
    } catch {
      this.stats.decodeErrors++;
      return;
    }

    let pos48: number;
    if (this.anchor === null) {
      this.anchor = { ext: p.ext, pos48: p.arrival };
      pos48 = p.arrival;
    } else {
      pos48 = this.anchor.pos48 + (p.ext - this.anchor.ext);
      if (Math.abs(pos48 - p.arrival) > REANCHOR_SAMPLES_48K) {
        this.anchor = { ext: p.ext, pos48: p.arrival };
        pos48 = p.arrival;
      }
    }

    const target16k = Math.round(pos48 / DECIMATION);
    if (target16k > this.writtenSamples16k) {
      this.padTo(target16k);
      this.decimator.reset();
    }

    const mono = new Int16Array(Math.floor(pcm.length / this.channels));
    for (let i = 0; i < mono.length; i++) {
      let sum = 0;
      for (let c = 0; c < this.channels; c++) sum += pcm[i * this.channels + c]!;
      mono[i] = Math.round(sum / this.channels);
    }
    const out = this.decimator.process(mono);
    if (out.length > 0) {
      this.sink(out);
      this.writtenSamples16k += out.length;
    }
  }

  private padTo(target16k: number): void {
    while (this.writtenSamples16k < target16k) {
      const n = Math.min(SILENCE_CHUNK, target16k - this.writtenSamples16k);
      this.sink(new Int16Array(n));
      this.writtenSamples16k += n;
    }
  }
}
