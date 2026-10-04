import type { Segment } from '../domain/transcript.js';

export interface Transcriber {
  /** Transcribes one 16 kHz mono WAV file into segments with millisecond offsets. */
  transcribe(wavPath: string): Promise<Segment[]>;
}

export interface Summarizer {
  summarize(transcriptMarkdown: string): Promise<string>;
}

export interface OutputStore {
  /** Creates (and returns the path of) `<recordings>/<YYYY-MM-DD_HHmm>-<channel-slug>`. */
  createRecordingDir(startedAt: Date, channelName: string): Promise<string>;
  /** Writes a text file inside the recording directory and returns its path. */
  writeFile(dir: string, name: string, content: string): Promise<string>;
  /** Deletes raw per-user audio that has been transcribed successfully. */
  discardAudio(paths: string[]): Promise<void>;
}

export interface ProcessResult {
  channelName: string;
  dir: string;
  transcriptPath?: string;
  summaryPath?: string;
  summary?: string;
  /** True when summaries are disabled by configuration (not a failure). */
  summarySkipped?: boolean;
  /** User-facing (Spanish) problems encountered while processing. */
  warnings: string[];
}

export interface ChatNotifier {
  postResult(textChannelId: string, result: ProcessResult): Promise<void>;
}
