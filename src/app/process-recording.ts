import { formatDateTime } from '../domain/naming.js';
import { formatNotesSection, mergeTranscript, type Note, type SpeakerTrack } from '../domain/transcript.js';
import type { ChatNotifier, OutputStore, ProcessResult, Summarizer, Transcriber } from './ports.js';

export interface RecordedTrack {
  speaker: string;
  wavPath: string;
}

export interface ProcessRecordingInput {
  channelName: string;
  textChannelId: string;
  startedAt: Date;
  tracks: RecordedTrack[];
  /** Notes added with /nota during the recording (offsets from recording start). */
  notes?: Note[];
}

export interface ProcessRecordingDeps {
  transcriber: Transcriber;
  /** Undefined disables the summary step (SUMMARY_ENABLED=false). */
  summarizer: Summarizer | undefined;
  output: OutputStore;
  notifier: ChatNotifier;
  log?: (message: string, error?: unknown) => void;
}

/** The "stop and process" use case: audio tracks in, transcript + summary on disk and in chat out. */
export async function processRecording(deps: ProcessRecordingDeps, input: ProcessRecordingInput): Promise<ProcessResult> {
  const log = deps.log ?? (() => {});
  const warnings: string[] = [];
  const dir = await deps.output.createRecordingDir(input.startedAt, input.channelName);
  const result: ProcessResult = { channelName: input.channelName, dir, warnings };

  const notes = input.notes ?? [];
  const speakerTracks: SpeakerTrack[] = [];
  const transcribed: string[] = [];
  for (const track of input.tracks) {
    try {
      const segments = await deps.transcriber.transcribe(track.wavPath);
      speakerTracks.push({ speaker: track.speaker, segments });
      transcribed.push(track.wavPath);
    } catch (e) {
      log(`Transcription failed for ${track.speaker}`, e);
      warnings.push(`No se pudo transcribir el audio de ${track.speaker}. Su audio se ha conservado en disco.`);
    }
  }

  const merged = mergeTranscript(speakerTracks, notes);
  const header = `# Transcripción: ${input.channelName}\n\n_${formatDateTime(input.startedAt)}_\n\n`;
  result.transcriptPath = await deps.output.writeFile(dir, 'transcript.md', header + merged.markdown);

  if (merged.segments.length === 0) {
    warnings.push(
      input.tracks.length === 0
        ? 'No se recibió audio de nadie, así que no hay nada que transcribir.'
        : 'No se detectó voz en la grabación, así que no hay resumen.'
    );
  } else if (!deps.summarizer) {
    result.summarySkipped = true;
  } else {
    try {
      const summary = (await deps.summarizer.summarize(merged.markdown)).trim();
      result.summary = summary;
      result.summaryPath = await deps.output.writeFile(
        dir,
        'summary.md',
        `# Resumen: ${input.channelName}\n\n_${formatDateTime(input.startedAt)}_\n\n${summary}\n${notes.length > 0 ? '\n' + formatNotesSection(notes) : ''}`
      );
    } catch (e) {
      log('Summarization failed', e);
      warnings.push(`No se pudo generar el resumen. La transcripción sí se ha guardado.`);
    }
  }

  try {
    await deps.output.discardAudio(transcribed);
  } catch (e) {
    log('Failed to discard audio', e);
  }

  try {
    await deps.notifier.postResult(input.textChannelId, result);
  } catch (e) {
    log('Failed to post result to Discord', e);
    warnings.push(`No se pudo publicar el resultado en Discord. Los archivos están en ${dir}.`);
  }

  return result;
}
