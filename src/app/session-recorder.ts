import { isMostlyZeroPacket, stripRtpExtension } from '../domain/rtp.js';
import { TrackAssembler, type PcmDecoder } from '../domain/track-assembler.js';

export interface WavSink {
  readonly path: string;
  write(pcm: Int16Array): void;
  close(): void;
}

export interface SessionRecorderDeps {
  /** Monotonic clock in nanoseconds (process.hrtime.bigint in production). */
  nowNs: () => bigint;
  startNs: bigint;
  createDecoder: () => PcmDecoder;
  createWav: (userId: string) => WavSink;
  /** Called when one track cannot be finalized; that track is left out of the result. */
  onTrackError?: (userId: string, error: unknown) => void;
}

export interface FinishedTrack {
  userId: string;
  wavPath: string;
  samples: number;
}

interface Track {
  assembler: TrackAssembler;
  wav: WavSink;
}

const SAMPLES_PER_NS_48K = 48000 / 1e9;

/** Receives raw voice packets from the transport and maintains one aligned WAV per speaker. */
export class SessionRecorder {
  private readonly tracks = new Map<string, Track>();
  private finished = false;
  packetsAccepted = 0;

  constructor(private readonly deps: SessionRecorderDeps) {}

  speakerIds(): string[] {
    return [...this.tracks.keys()];
  }

  handlePacket(rawPayload: Buffer, userId: string, rtpTimestamp: number): void {
    if (this.finished || !userId) return;
    const payload = stripRtpExtension(rawPayload);
    const arrival = Number(this.deps.nowNs() - this.deps.startNs) * SAMPLES_PER_NS_48K;

    let track = this.tracks.get(userId);
    if (!track) {
      // Do not create a track for packets that will be dropped as zero-filled noise.
      if (isMostlyZeroPacket(payload)) return;
      const wav = this.deps.createWav(userId);
      track = { wav, assembler: new TrackAssembler({ decoder: this.deps.createDecoder(), sink: (pcm) => wav.write(pcm) }) };
      this.tracks.set(userId, track);
    }
    const before = track.assembler.stats.packets;
    track.assembler.push({ payload, rtpTimestamp, arrivalSamples48k: arrival });
    if (track.assembler.stats.packets > before) this.packetsAccepted++;
  }

  /** Flushes every track, pads them to the recording length and closes the WAV files. */
  finish(): FinishedTrack[] {
    if (this.finished) return [];
    this.finished = true;
    const total = Number(this.deps.nowNs() - this.deps.startNs) * SAMPLES_PER_NS_48K;
    const out: FinishedTrack[] = [];
    for (const [userId, t] of this.tracks) {
      try {
        t.assembler.finish(total);
        t.wav.close();
        out.push({ userId, wavPath: t.wav.path, samples: t.assembler.samplesWritten });
      } catch (e) {
        this.deps.onTrackError?.(userId, e);
      }
    }
    return out;
  }
}
