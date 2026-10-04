import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_WHISPER_PROMPT, loadConfig } from '../src/domain/config.js';

const base = { DISCORD_TOKEN: 'tok', DISCORD_APP_ID: '123456789012345678', ALLOWED_GUILD_IDS: '111111111111111111' };

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const c = loadConfig(base);
    expect(c).toEqual({
      discordToken: 'tok',
      discordAppId: '123456789012345678',
      allowedGuildIds: ['111111111111111111'],
      deprecations: [],
      whisperBin: 'whisper-cli',
      whisperModel: 'models/ggml-large-v3.bin',
      whisperVadModel: 'models/ggml-silero-v5.1.2.bin',
      whisperLanguage: 'es',
      whisperPrompt: DEFAULT_WHISPER_PROMPT,
      whisperBeamSize: 8,
      summaryEnabled: true,
      claudeBin: 'claude',
      claudeModel: undefined,
      recordingsDir: 'recordings'
    });
  });

  it('reads overrides and trims whitespace', () => {
    const c = loadConfig({ ...base, ALLOWED_GUILD_IDS: ' 999999999999999999 , 888888888888888888 ', WHISPER_LANGUAGE: 'en', RECORDINGS_DIR: '/data/rec' });
    expect(c.allowedGuildIds).toEqual(['999999999999999999', '888888888888888888']);
    expect(c.whisperLanguage).toBe('en');
    expect(c.recordingsDir).toBe('/data/rec');
  });

  it('treats empty strings as unset', () => {
    const c = loadConfig({ ...base, DISCORD_GUILD_ID: '', WHISPER_BIN: '' });
    expect(c.allowedGuildIds).toEqual(['111111111111111111']);
    expect(c.whisperBin).toBe('whisper-cli');
  });

  it('reads CLAUDE_MODEL trimmed and treats empty as unset', () => {
    expect(loadConfig({ ...base, CLAUDE_MODEL: ' sonnet ' }).claudeModel).toBe('sonnet');
    expect(loadConfig({ ...base, CLAUDE_MODEL: '' }).claudeModel).toBeUndefined();
  });

  it('reports every missing required variable at once', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (e) {
      expect((e as ConfigError).problems).toEqual(['DISCORD_TOKEN is required', 'DISCORD_APP_ID is required', 'ALLOWED_GUILD_IDS is required (comma-separated server ids)']);
    }
  });

  it('rejects a non-numeric application id', () => {
    expect(() => loadConfig({ ...base, DISCORD_APP_ID: 'abc' })).toThrow(/DISCORD_APP_ID must be a numeric snowflake/);
  });

  it('rejects a non-numeric allowed guild id', () => {
    expect(() => loadConfig({ ...base, ALLOWED_GUILD_IDS: '111111111111111111,x' })).toThrow(/ALLOWED_GUILD_IDS must contain only numeric snowflakes/);
  });

  it('deduplicates allowed guild ids and ignores empty entries', () => {
    const c = loadConfig({ ...base, ALLOWED_GUILD_IDS: '111111111111111111,,111111111111111111,' });
    expect(c.allowedGuildIds).toEqual(['111111111111111111']);
  });

  it('accepts the legacy DISCORD_GUILD_ID as an alias and reports the deprecation', () => {
    const { ALLOWED_GUILD_IDS: _omit, ...rest } = base;
    const c = loadConfig({ ...rest, DISCORD_GUILD_ID: '999999999999999999' });
    expect(c.allowedGuildIds).toEqual(['999999999999999999']);
    expect(c.deprecations.join(' ')).toMatch(/DISCORD_GUILD_ID is deprecated.*ALLOWED_GUILD_IDS/);
  });

  it('prefers ALLOWED_GUILD_IDS over the legacy alias', () => {
    const c = loadConfig({ ...base, DISCORD_GUILD_ID: '999999999999999999' });
    expect(c.allowedGuildIds).toEqual(['111111111111111111']);
    expect(c.deprecations).toEqual([]);
  });

  it('rejects an invalid legacy guild id', () => {
    const { ALLOWED_GUILD_IDS: _omit, ...rest } = base;
    expect(() => loadConfig({ ...rest, DISCORD_GUILD_ID: 'x' })).toThrow(/ALLOWED_GUILD_IDS must contain only numeric snowflakes/);
  });

  it('ships a Castilian default prompt seeded with domain vocabulary', () => {
    for (const word of ['Claude', 'IA', 'Discord', 'Anthropic', 'Gemini', 'Google Meet', 'vosotros', 'Vale', 'tío', '¿', '¡']) {
      expect(DEFAULT_WHISPER_PROMPT).toContain(word);
    }
    expect(DEFAULT_WHISPER_PROMPT.length).toBeLessThan(700);
  });

  it('lets WHISPER_PROMPT override the prompt or disable it with an empty value', () => {
    expect(loadConfig({ ...base, WHISPER_PROMPT: ' Hola, qué tal. ' }).whisperPrompt).toBe('Hola, qué tal.');
    expect(loadConfig({ ...base, WHISPER_PROMPT: '' }).whisperPrompt).toBe('');
  });

  it('reads WHISPER_BEAM_SIZE and rejects invalid values', () => {
    expect(loadConfig({ ...base, WHISPER_BEAM_SIZE: '12' }).whisperBeamSize).toBe(12);
    expect(() => loadConfig({ ...base, WHISPER_BEAM_SIZE: '0' })).toThrow(/WHISPER_BEAM_SIZE/);
    expect(() => loadConfig({ ...base, WHISPER_BEAM_SIZE: 'abc' })).toThrow(/WHISPER_BEAM_SIZE/);
  });

  it('enables the summary by default and lets SUMMARY_ENABLED turn it off', () => {
    expect(loadConfig(base).summaryEnabled).toBe(true);
    for (const v of ['false', 'FALSE', '0', 'no', 'off']) expect(loadConfig({ ...base, SUMMARY_ENABLED: v }).summaryEnabled).toBe(false);
    for (const v of ['true', 'TRUE', '1', 'yes', 'on']) expect(loadConfig({ ...base, SUMMARY_ENABLED: v }).summaryEnabled).toBe(true);
  });

  it('rejects an unrecognised SUMMARY_ENABLED value instead of silently sending text to Anthropic', () => {
    expect(() => loadConfig({ ...base, SUMMARY_ENABLED: 'maybe' })).toThrow(/SUMMARY_ENABLED must be true or false/);
  });
});
