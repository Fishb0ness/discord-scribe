import { describe, expect, it } from 'vitest';
import { formatTimestamp, isHallucination, mergeTranscript, parseWhisperJson } from '../src/domain/transcript.js';

const seg = (startMs: number, endMs: number, text: string) => ({ startMs, endMs, text });

describe('parseWhisperJson', () => {
  it('reads offsets and text from whisper-cli JSON output', () => {
    const json = JSON.stringify({
      transcription: [
        { timestamps: { from: '00:00:01,000', to: '00:00:03,500' }, offsets: { from: 1000, to: 3500 }, text: ' Hola a todos.' },
        { timestamps: { from: '00:00:04,000', to: '00:00:05,000' }, offsets: { from: 4000, to: 5000 }, text: ' Empezamos.' }
      ]
    });
    expect(parseWhisperJson(json)).toEqual([seg(1000, 3500, 'Hola a todos.'), seg(4000, 5000, 'Empezamos.')]);
  });

  it('returns an empty list when there is no transcription', () => {
    expect(parseWhisperJson('{}')).toEqual([]);
  });

  it('throws a clear error on invalid JSON', () => {
    expect(() => parseWhisperJson('not json')).toThrow(/whisper/i);
  });
});

describe('formatTimestamp', () => {
  it('formats mm:ss under one hour', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_400)).toBe('01:05');
    expect(formatTimestamp(3_599_000)).toBe('59:59');
  });
  it('switches to h:mm:ss from one hour', () => {
    expect(formatTimestamp(3_600_000)).toBe('1:00:00');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
  });
});

describe('isHallucination', () => {
  it.each([
    'Subtítulos realizados por la comunidad de Amara.org',
    'Gracias por ver el video',
    'Gracias por ver el vídeo.',
    '¡Suscríbete!',
    '[BLANK_AUDIO]',
    '(música)',
    '[Música]',
    '...',
    '   ',
    ''
  ])('flags %j', (t) => expect(isHallucination(t)).toBe(true));

  it.each(['Gracias, Marta, por la explicación', 'Vamos a suscribir el contrato mañana', 'Hola'])('keeps %j', (t) =>
    expect(isHallucination(t)).toBe(false)
  );
});

describe('mergeTranscript', () => {
  it('orders segments from all speakers by start time and labels them', () => {
    const { markdown } = mergeTranscript([
      { speaker: 'Ana', segments: [seg(0, 2000, 'Hola'), seg(10_000, 12_000, 'Adiós')] },
      { speaker: 'Luis', segments: [seg(3000, 5000, 'Buenas')] }
    ]);
    expect(markdown).toBe('[00:00] **Ana**: Hola\n\n[00:03] **Luis**: Buenas\n\n[00:10] **Ana**: Adiós\n');
  });

  it('merges consecutive segments of the same speaker', () => {
    const { markdown, segments } = mergeTranscript([
      { speaker: 'Ana', segments: [seg(0, 1000, 'Primera frase.'), seg(1200, 2000, 'Segunda frase.')] },
      { speaker: 'Luis', segments: [seg(5000, 6000, 'Vale')] }
    ]);
    expect(segments).toHaveLength(2);
    expect(markdown).toContain('[00:00] **Ana**: Primera frase. Segunda frase.');
  });

  it('does not merge same-speaker segments separated by another speaker', () => {
    const { segments } = mergeTranscript([
      { speaker: 'Ana', segments: [seg(0, 1000, 'a'), seg(4000, 5000, 'c')] },
      { speaker: 'Luis', segments: [seg(2000, 3000, 'b')] }
    ]);
    expect(segments.map((s) => s.speaker)).toEqual(['Ana', 'Luis', 'Ana']);
  });

  it('drops empty and hallucinated segments before merging', () => {
    const { markdown } = mergeTranscript([
      {
        speaker: 'Ana',
        segments: [
          seg(0, 1000, 'Hola'),
          seg(1000, 2000, 'Subtítulos realizados por la comunidad de Amara.org'),
          seg(2000, 3000, '  '),
          seg(3000, 4000, 'qué tal')
        ]
      }
    ]);
    expect(markdown).toBe('[00:00] **Ana**: Hola qué tal\n');
  });

  it('breaks ties on identical start times deterministically by speaker order', () => {
    const { segments } = mergeTranscript([
      { speaker: 'Ana', segments: [seg(1000, 2000, 'x')] },
      { speaker: 'Luis', segments: [seg(1000, 2000, 'y')] }
    ]);
    expect(segments.map((s) => s.speaker)).toEqual(['Ana', 'Luis']);
  });

  it('returns an empty transcript when there is no speech', () => {
    const r = mergeTranscript([{ speaker: 'Ana', segments: [seg(0, 1, '[BLANK_AUDIO]')] }]);
    expect(r.segments).toEqual([]);
    expect(r.markdown).toBe('');
  });
});
