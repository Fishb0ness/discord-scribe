export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SpeakerTrack {
  speaker: string;
  segments: Segment[];
}

export interface LabelledSegment extends Segment {
  speaker: string;
}

export interface MergedTranscript {
  segments: LabelledSegment[];
  markdown: string;
}

/** Parses the JSON written by `whisper-cli --output-json`. */
export function parseWhisperJson(raw: string): Segment[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid whisper JSON output: ${(e as Error).message}`);
  }
  const items = (data as { transcription?: unknown }).transcription;
  if (!Array.isArray(items)) return [];
  const out: Segment[] = [];
  for (const item of items) {
    const offsets = (item as { offsets?: { from?: unknown; to?: unknown } }).offsets;
    const text = (item as { text?: unknown }).text;
    if (typeof offsets?.from !== 'number' || typeof offsets.to !== 'number' || typeof text !== 'string') continue;
    out.push({ startMs: offsets.from, endMs: offsets.to, text: text.trim() });
  }
  return out;
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Phrases Whisper is known to invent on silence or noise, compared after normalization. */
const HALLUCINATION_PHRASES = new Set([
  'gracias por ver el video',
  'gracias por ver',
  'gracias por vernos',
  'suscribete',
  'suscribete al canal',
  'no olvides suscribirte',
  'subtitulado por la comunidad de amara org',
  'thanks for watching',
  'thank you for watching',
  'subscribe'
]);

const HALLUCINATION_SUBSTRINGS = ['amara org', 'subtitulos realizados por', 'subtitulado por'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  // Non-speech tags such as [BLANK_AUDIO], (música), [Music]
  if (/^[[(].*[\])]$/.test(trimmed)) return true;
  const n = normalize(trimmed);
  if (n === '') return true;
  if (HALLUCINATION_PHRASES.has(n)) return true;
  return HALLUCINATION_SUBSTRINGS.some((s) => n.includes(s));
}

export function mergeTranscript(tracks: SpeakerTrack[]): MergedTranscript {
  const all: Array<LabelledSegment & { order: number }> = [];
  tracks.forEach((track, order) => {
    for (const s of track.segments) {
      if (isHallucination(s.text)) continue;
      all.push({ ...s, text: s.text.trim(), speaker: track.speaker, order });
    }
  });
  all.sort((a, b) => a.startMs - b.startMs || a.order - b.order);

  const merged: LabelledSegment[] = [];
  for (const s of all) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === s.speaker) {
      last.text = `${last.text} ${s.text}`;
      last.endMs = Math.max(last.endMs, s.endMs);
    } else {
      merged.push({ startMs: s.startMs, endMs: s.endMs, text: s.text, speaker: s.speaker });
    }
  }

  const markdown = merged.map((s) => `[${formatTimestamp(s.startMs)}] **${s.speaker}**: ${s.text}`).join('\n\n');
  return { segments: merged, markdown: markdown === '' ? '' : markdown + '\n' };
}
