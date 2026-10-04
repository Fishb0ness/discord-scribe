import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { processRecording } from './app/process-recording.js';
import { ClaudeCliSummarizer } from './adapters/claude-cli-summarizer.js';
import { DiscordBot } from './adapters/discord/discord-bot.js';
import { DiscordChatNotifier } from './adapters/discord/discord-chat-notifier.js';
import { FilesystemOutputStore } from './adapters/filesystem-output-store.js';
import { shutdownSignals } from './adapters/shutdown-signals.js';
import { WhisperCliTranscriber } from './adapters/whisper-cli-transcriber.js';
import { ConfigError, loadConfig } from './domain/config.js';

function log(message: string, error?: unknown): void {
  const line = `${new Date().toISOString()} ${message}`;
  if (error) console.error(line, error instanceof Error ? error.message : error);
  else console.log(line);
}

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Configuration problems (see .env.example):\n- ${e.problems.join('\n- ')}`);
    process.exit(1);
  }
  throw e;
}

for (const note of config.deprecations) log(note);
const vadModel = resolve(config.whisperVadModel);
if (!existsSync(vadModel)) log(`VAD model not found at ${vadModel}; transcribing without VAD (expect more hallucinations on silence)`);
const recordingsDir = resolve(config.recordingsDir);
mkdirSync(recordingsDir, { recursive: true });

const bot = new DiscordBot({
  token: config.discordToken,
  allowedGuildIds: config.allowedGuildIds,
  recordingsDir,
  log,
  createProcessor: (client) => {
    const deps = {
      transcriber: new WhisperCliTranscriber({
        bin: config.whisperBin,
        model: resolve(config.whisperModel),
        vadModel: existsSync(vadModel) ? vadModel : undefined,
        language: config.whisperLanguage,
        prompt: config.whisperPrompt,
        beamSize: config.whisperBeamSize
      }),
      // Run claude from the recordings dir so it never picks up a project's instructions.
      summarizer: config.summaryEnabled ? new ClaudeCliSummarizer(config.claudeBin, recordingsDir, undefined, config.claudeModel) : undefined,
      output: new FilesystemOutputStore(recordingsDir),
      notifier: new DiscordChatNotifier(client),
      log
    };
    return (input) => processRecording(deps, input);
  }
});

for (const signal of shutdownSignals(process.platform)) {
  process.once(signal, () => {
    log(`${signal} received, shutting down`);
    bot
      .shutdown()
      .catch((e) => log('Shutdown failed', e))
      .finally(() => process.exit(0));
  });
}

await bot.start();
