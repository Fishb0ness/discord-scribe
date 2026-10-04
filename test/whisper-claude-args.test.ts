import { describe, expect, it } from 'vitest';
import { buildWhisperArgs } from '../src/adapters/whisper-cli-transcriber.js';
import { buildClaudeArgs, SUMMARY_PROMPT } from '../src/adapters/claude-cli-summarizer.js';

describe('buildWhisperArgs', () => {
  it('builds a JSON-output invocation with VAD', () => {
    const args = buildWhisperArgs({ model: 'm.bin', vadModel: 'v.bin', language: 'es', prompt: '', beamSize: 5 }, '/w/ana.wav', '/w/ana');
    expect(args).toEqual(expect.arrayContaining(['-m', 'm.bin', '-f', '/w/ana.wav', '-l', 'es', '-oj', '-of', '/w/ana', '--vad', '-vm', 'v.bin']));
  });
  it('omits VAD flags when no VAD model is configured', () => {
    const args = buildWhisperArgs({ model: 'm.bin', vadModel: undefined, language: 'es', prompt: '', beamSize: 5 }, 'a.wav', 'a');
    expect(args).not.toContain('--vad');
    expect(args).not.toContain('-vm');
  });
});

describe('buildWhisperArgs quality settings', () => {
  const opts = { model: 'm.bin', vadModel: 'v.bin', language: 'es', prompt: 'Hola, vosotros.', beamSize: 8 };
  const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it('uses the configured beam size for both beam search and best-of', () => {
    const args = buildWhisperArgs(opts, 'a.wav', 'a');
    expect(value(args, '-bs')).toBe('8');
    expect(value(args, '-bo')).toBe('8');
  });
  it('passes the prompt and carries it across windows', () => {
    const args = buildWhisperArgs(opts, 'a.wav', 'a');
    expect(value(args, '--prompt')).toBe('Hola, vosotros.');
    expect(args).toContain('--carry-initial-prompt');
  });
  it('omits prompt flags when the prompt is empty', () => {
    const args = buildWhisperArgs({ ...opts, prompt: '' }, 'a.wav', 'a');
    expect(args).not.toContain('--prompt');
    expect(args).not.toContain('--carry-initial-prompt');
  });
  it('keeps max context at 0 against repetition loops', () => {
    expect(value(buildWhisperArgs(opts, 'a.wav', 'a'), '-mc')).toBe('0');
  });
  it('lengthens VAD segments with 500 ms silence and 200 ms padding', () => {
    const args = buildWhisperArgs(opts, 'a.wav', 'a');
    expect(value(args, '-vsd')).toBe('500');
    expect(value(args, '-vp')).toBe('200');
  });
});

describe('buildClaudeArgs', () => {
  it('runs non-interactively without tools, sessions or user settings', () => {
    const args = buildClaudeArgs();
    expect(args[0]).toBe('-p');
    expect(args).toEqual(expect.arrayContaining(['--no-session-persistence', '--disable-slash-commands']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
  });
  it('pins the model before the prompt when one is given', () => {
    const args = buildClaudeArgs('sonnet');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args.indexOf('--model')).toBeLessThan(args.length - 1);
    expect(args[args.length - 1]).toBe(SUMMARY_PROMPT);
  });
  it('omits --model when undefined or blank', () => {
    expect(buildClaudeArgs()).not.toContain('--model');
    expect(buildClaudeArgs('  ')).not.toContain('--model');
  });
  it('asks for a Spanish summary with decisions and action items', () => {
    expect(SUMMARY_PROMPT).toMatch(/español/i);
    expect(SUMMARY_PROMPT).toMatch(/decisiones/i);
    expect(SUMMARY_PROMPT).toMatch(/responsable/i);
  });
});
