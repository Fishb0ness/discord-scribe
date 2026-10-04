export interface Config {
  discordToken: string;
  discordAppId: string;
  /** Servers where the bot may operate; it leaves any other server it is added to. */
  allowedGuildIds: string[];
  /** Human-readable notes about deprecated settings that were still honoured. */
  deprecations: string[];
  whisperBin: string;
  whisperModel: string;
  whisperVadModel: string;
  whisperLanguage: string;
  /** Initial prompt that biases Whisper towards Castilian punctuation and vocabulary. Empty disables it. */
  whisperPrompt: string;
  whisperBeamSize: number;
  /** When false, no transcript text is ever sent to Claude/Anthropic and only the transcript is produced. */
  summaryEnabled: boolean;
  claudeBin: string;
  claudeModel?: string | undefined;
  recordingsDir: string;
}

/** Short, well-punctuated peninsular Spanish; also seeds proper nouns Whisper tends to mishear. */
export const DEFAULT_WHISPER_PROMPT =
  'Hola, ¿qué tal, tíos? Vale, vamos a empezar la reunión. ¿Habéis visto lo que ha sacado Anthropic? ' +
  'Claude es una IA muy potente, y Gemini, de Google, también. Os paso el enlace por Discord o por Google Meet, ' +
  'como prefiráis. ¡Genial! Entonces, vosotros me decís cuándo os viene bien, y quedamos.';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Beam size (and best-of) for whisper decoding; higher is slower but more accurate. */
const DEFAULT_WHISPER_BEAM_SIZE = 8;
const SNOWFLAKE = /^\d{15,25}$/;

function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function loadConfig(env: Env): Config {
  const problems: string[] = [];

  const token = read(env, 'DISCORD_TOKEN');
  if (!token) problems.push('DISCORD_TOKEN is required');

  const appId = read(env, 'DISCORD_APP_ID');
  if (!appId) problems.push('DISCORD_APP_ID is required');
  else if (!SNOWFLAKE.test(appId)) problems.push('DISCORD_APP_ID must be a numeric snowflake');

  const deprecations: string[] = [];
  let guildsRaw = read(env, 'ALLOWED_GUILD_IDS');
  if (guildsRaw === undefined) {
    const legacy = read(env, 'DISCORD_GUILD_ID');
    if (legacy) {
      guildsRaw = legacy;
      deprecations.push('DISCORD_GUILD_ID is deprecated: rename it to ALLOWED_GUILD_IDS (comma-separated list of server ids)');
    }
  }
  const allowedGuildIds = [...new Set((guildsRaw ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
  if (guildsRaw === undefined) problems.push('ALLOWED_GUILD_IDS is required (comma-separated server ids)');
  else if (allowedGuildIds.length === 0 || !allowedGuildIds.every((id) => SNOWFLAKE.test(id))) {
    problems.push('ALLOWED_GUILD_IDS must contain only numeric snowflakes');
  }

  const beamRaw = read(env, 'WHISPER_BEAM_SIZE');
  const beamSize = beamRaw === undefined ? DEFAULT_WHISPER_BEAM_SIZE : Number(beamRaw);
  if (!Number.isInteger(beamSize) || beamSize < 1) problems.push('WHISPER_BEAM_SIZE must be a positive integer');

  const summaryRaw = read(env, 'SUMMARY_ENABLED')?.toLowerCase();
  let summaryEnabled = true;
  if (summaryRaw !== undefined) {
    if (['true', '1', 'yes', 'on'].includes(summaryRaw)) summaryEnabled = true;
    else if (['false', '0', 'no', 'off'].includes(summaryRaw)) summaryEnabled = false;
    else problems.push('SUMMARY_ENABLED must be true or false');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    discordToken: token!,
    discordAppId: appId!,
    allowedGuildIds,
    deprecations,
    whisperBin: read(env, 'WHISPER_BIN') ?? 'whisper-cli',
    whisperModel: read(env, 'WHISPER_MODEL') ?? 'models/ggml-large-v3.bin',
    whisperVadModel: read(env, 'WHISPER_VAD_MODEL') ?? 'models/ggml-silero-v5.1.2.bin',
    whisperLanguage: read(env, 'WHISPER_LANGUAGE') ?? 'es',
    // An explicitly empty WHISPER_PROMPT disables the prompt; unset keeps the default.
    whisperPrompt: env.WHISPER_PROMPT === undefined ? DEFAULT_WHISPER_PROMPT : env.WHISPER_PROMPT.trim(),
    whisperBeamSize: beamSize,
    summaryEnabled,
    claudeBin: read(env, 'CLAUDE_BIN') ?? 'claude',
    claudeModel: read(env, 'CLAUDE_MODEL'),
    recordingsDir: read(env, 'RECORDINGS_DIR') ?? 'recordings'
  };
}
