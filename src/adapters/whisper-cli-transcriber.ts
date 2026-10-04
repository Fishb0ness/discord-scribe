import { readFile, rm, stat } from 'node:fs/promises';
import type { Transcriber } from '../app/ports.js';
import { parseWhisperJson, type Segment } from '../domain/transcript.js';
import { runProcess } from './run-process.js';

export interface WhisperOptions {
  bin: string;
  model: string;
  vadModel: string | undefined;
  language: string;
  prompt: string;
  beamSize: number;
}

export function buildWhisperArgs(
  opts: Omit<WhisperOptions, 'bin'>,
  wavPath: string,
  outputBase: string
): string[] {
  const args = [
    '-m', opts.model,
    '-f', wavPath,
    '-l', opts.language,
    '-oj',
    '-of', outputBase,
    '-np', // keep stdout quiet: only the JSON file matters
    '-mc', '0', // do not condition on previous text: avoids repetition loops and carried-over hallucinations
    '-sns', // suppress non-speech tokens
    '-bs', String(opts.beamSize),
    '-bo', String(opts.beamSize)
  ];
  // -mc 0 drops context between windows, so the prompt must be re-applied to every window.
  if (opts.prompt) args.push('--prompt', opts.prompt, '--carry-initial-prompt');
  // Longer segments (more context per decode) than whisper's defaults of 100 ms / 30 ms.
  if (opts.vadModel) args.push('--vad', '-vm', opts.vadModel, '-vsd', '500', '-vp', '200');
  return args;
}

const MIN_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_AUDIO_FACTOR = 3;
const WAV_HEADER_BYTES = 44;
const WAV_BYTES_PER_SECOND = 16000 * 2; // 16 kHz mono 16-bit

/** Duration of a 16 kHz mono 16-bit WAV file derived from its size. */
export function wavDurationSeconds(fileBytes: number): number {
  return Math.max(0, fileBytes - WAV_HEADER_BYTES) / WAV_BYTES_PER_SECOND;
}

/** Generous bound for one whisper run: at least 10 minutes, or 3x the audio length for long recordings. */
export function whisperTimeoutMs(audioSeconds: number): number {
  return Math.max(MIN_TIMEOUT_MS, TIMEOUT_AUDIO_FACTOR * audioSeconds * 1000);
}

export class WhisperCliTranscriber implements Transcriber {
  constructor(private readonly opts: WhisperOptions) {}

  async transcribe(wavPath: string): Promise<Segment[]> {
    const base = wavPath.replace(/\.wav$/i, '');
    const jsonPath = `${base}.json`;
    const timeoutMs = whisperTimeoutMs(wavDurationSeconds((await stat(wavPath)).size));
    // On timeout runProcess kills the child and rejects; the WAV stays on disk (it is only discarded after success).
    const run = await runProcess(this.opts.bin, buildWhisperArgs(this.opts, wavPath, base), { timeoutMs });
    if (run.code !== 0) throw new Error(`whisper-cli exited with code ${run.code}: ${run.stderr.trim().slice(-500)}`);
    try {
      return parseWhisperJson(await readFile(jsonPath, 'utf8'));
    } finally {
      await rm(jsonPath, { force: true });
    }
  }
}
