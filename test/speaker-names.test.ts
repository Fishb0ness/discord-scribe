import { describe, expect, it } from 'vitest';
import { uniqueSpeakerNames } from '../src/domain/speaker-names.js';

describe('uniqueSpeakerNames', () => {
  it('keeps unique names untouched', () => {
    expect(uniqueSpeakerNames([{ userId: '1', name: 'Ana' }, { userId: '2', name: 'Luis' }])).toEqual(new Map([['1', 'Ana'], ['2', 'Luis']]));
  });
  it('disambiguates duplicate display names', () => {
    const m = uniqueSpeakerNames([{ userId: '1', name: 'Ana' }, { userId: '2', name: 'Ana' }, { userId: '3', name: 'ana' }]);
    expect(m.get('1')).toBe('Ana');
    expect(m.get('2')).toBe('Ana (2)');
    expect(m.get('3')).toBe('ana (3)');
  });
  it('falls back for blank names', () => {
    expect(uniqueSpeakerNames([{ userId: '9', name: '  ' }]).get('9')).toBe('Usuario 9');
  });
});
