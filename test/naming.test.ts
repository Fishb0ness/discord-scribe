import { describe, expect, it } from 'vitest';
import { formatDateTime, recordingDirName, slugify } from '../src/domain/naming.js';
import { splitMessage } from '../src/domain/discord-text.js';

describe('slugify', () => {
  it('lowercases, strips accents and collapses separators', () => {
    expect(slugify('Reunión de Equipo #1')).toBe('reunion-de-equipo-1');
  });
  it('falls back for names with no usable characters', () => {
    expect(slugify('🔊🔊')).toBe('canal');
  });
  it('limits the length', () => {
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe('recordingDirName', () => {
  it('uses local date and time plus the channel slug', () => {
    const d = new Date(2026, 9, 4, 17, 5, 0); // local time
    expect(recordingDirName(d, 'General Voz')).toBe('2026-10-04_1705-general-voz');
  });
});

describe('splitMessage', () => {
  it('returns a single chunk when under the limit', () => {
    expect(splitMessage('hola', 2000)).toEqual(['hola']);
  });
  it('splits on paragraph boundaries and never exceeds the limit', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Párrafo ${i} ` + 'x'.repeat(100)).join('\n\n');
    const parts = splitMessage(text, 500);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(500);
    expect(parts.join('\n\n').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
  it('hard-splits a single overlong line', () => {
    const parts = splitMessage('y'.repeat(1250), 500);
    expect(parts.map((p) => p.length)).toEqual([500, 500, 250]);
  });
});

describe('formatDateTime', () => {
  it('formats local date and time for document headers', () => {
    expect(formatDateTime(new Date(2026, 9, 4, 7, 5, 0))).toBe('2026-10-04 07:05');
  });
});
