import { describe, expect, it } from 'vitest';
import { formatNotesSection, formatTimestamp, isHallucination, mergeTranscript, parseWhisperJson } from '../src/domain/transcript.js';

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

describe('mergeTranscript with notes', () => {
  const ana = { speaker: 'Ana', segments: [seg(0, 1000, 'Hola'), seg(20_000, 21_000, 'Seguimos')] };
  const luis = { speaker: 'Luis', segments: [seg(5000, 6000, 'Vale')] };

  it('interleaves notes at their timestamp without splitting or merging speech', () => {
    const { markdown, segments } = mergeTranscript([ana, luis], [{ author: 'Luis', text: 'https://x.dev/doc', atMs: 10_000 }]);
    expect(markdown).toBe(
      '[00:00] **Ana**: Hola\n\n[00:05] **Luis**: Vale\n\n[00:10] 📎 **Nota de Luis**: https://x.dev/doc\n\n[00:20] **Ana**: Seguimos\n'
    );
    // Notes are not speech.
    expect(segments.map((s) => s.text)).toEqual(['Hola', 'Vale', 'Seguimos']);
  });

  it('does not put a note inside a speaker block that spans its time', () => {
    const long = { speaker: 'Ana', segments: [seg(0, 5000, 'Uno'), seg(6000, 9000, 'Dos')] };
    const { markdown } = mergeTranscript([long], [{ author: 'Luis', text: 'n', atMs: 5500 }]);
    expect(markdown).toBe('[00:00] **Ana**: Uno Dos\n\n[00:05] 📎 **Nota de Luis**: n\n');
  });

  it('sorts notes by time and collapses newlines into one line', () => {
    const { markdown } = mergeTranscript([], [
      { author: 'B', text: 'dos', atMs: 9000 },
      { author: 'A', text: 'uno\nlinea', atMs: 1000 }
    ]);
    expect(markdown).toBe('[00:01] 📎 **Nota de A**: uno linea\n\n[00:09] 📎 **Nota de B**: dos\n');
  });

  it('is unchanged when there are no notes', () => {
    expect(mergeTranscript([ana]).markdown).toBe(mergeTranscript([ana], []).markdown);
    expect(mergeTranscript([], []).markdown).toBe('');
  });
});

describe('formatNotesSection', () => {
  it('lists every note with time, author and text', () => {
    expect(formatNotesSection([{ author: 'Ana', text: 'https://x.dev', atMs: 65_000 }])).toBe(
      '## Notas\n\n- [01:05] **Ana**: https://x.dev\n'
    );
  });

  it('is empty without notes', () => {
    expect(formatNotesSection([])).toBe('');
  });
});

describe('note ordering and markdown escaping', () => {
  it('places a note after a speech block that starts at the same instant', () => {
    const { markdown } = mergeTranscript([{ speaker: 'Ana', segments: [seg(10_000, 11_000, 'Hola')] }], [{ author: 'Luis', text: 'n', atMs: 10_000 }]);
    expect(markdown).toBe('[00:10] **Ana**: Hola\n\n[00:10] 📎 **Nota de Luis**: n\n');
  });

  it('escapes markdown metacharacters in author and text but keeps URLs intact', () => {
    const note = { author: 'a*b_c', text: 'ver **esto** _ya_ `x` [a](b) https://example.com/a_b?x=1&y=2 fin', atMs: 0 };
    const expected = 'ver \\*\\*esto\\*\\* \\_ya\\_ \\`x\\` \\[a\\](b) https://example.com/a_b?x=1&y=2 fin';
    expect(mergeTranscript([], [note]).markdown).toBe(`[00:00] 📎 **Nota de a\\*b\\_c**: ${expected}\n`);
    expect(formatNotesSection([note])).toBe(`## Notas\n\n- [00:00] **a\\*b\\_c**: ${expected}\n`);
  });

  it('leaves speaker rendering unchanged', () => {
    const { markdown } = mergeTranscript([{ speaker: 'A_b*', segments: [seg(0, 1000, 'x_y')] }]);
    expect(markdown).toBe('[00:00] **A_b*** : x_y\n'.replace('*** :', '***:'));
  });
});
