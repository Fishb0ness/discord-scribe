import { rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  Client,
  CommandInteraction,
  type AnyVoiceChannel,
  type Guild,
  type Member
} from '@projectdysnomia/dysnomia';
import type { ProcessRecordingInput } from '../../app/process-recording.js';
import { guildsToLeave, isGuildAllowed } from '../../domain/access.js';
import { staleIndicatorFix } from '../../domain/nickname.js';
import { uniqueSpeakerNames } from '../../domain/speaker-names.js';
import type { FinishedTrack } from '../../app/session-recorder.js';
import { killRunningProcesses } from '../run-process.js';
import { ActiveRecording, type ActiveRecordingOptions } from './active-recording.js';
import { stopMessage, type StopReason } from './stop-reason.js';
import { COMMANDS, RECORD_COMMAND, STOP_COMMAND } from './commands.js';

/** Discord message flag EPHEMERAL (1 << 6): only the invoking user sees the reply. */
const EPHEMERAL_FLAG = 64;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 150 * 1000; // must stay below launchd's ExitTimeOut

/** What the bot needs from one recording; ActiveRecording is the production implementation. */
export interface RecordingHandle {
  readonly channel: ActiveRecordingOptions['channel'];
  readonly textChannelId: string;
  readonly startedAt: Date;
  readonly workDir: string;
  readonly guildId: string;
  start(): Promise<void>;
  stop(): Promise<FinishedTrack[]>;
  checkEmpty(): void;
}

export type RecordingParams = ActiveRecordingOptions;

export interface DiscordBotOptions {
  token: string;
  /** The only servers the bot serves; it leaves any other and never registers global commands. */
  allowedGuildIds: string[];
  recordingsDir: string;
  /** Builds the "process a finished recording" function once the client exists (the notifier needs it). */
  createProcessor: (client: Client) => (input: ProcessRecordingInput) => Promise<unknown>;
  log: (message: string, error?: unknown) => void;
  /** Test seams: an already-built client, a recording factory, the shutdown bound and the child killer. */
  client?: Client;
  createRecording?: (params: RecordingParams) => RecordingHandle;
  shutdownTimeoutMs?: number;
  killChildren?: () => number;
}

/**
 * Client options. `restMode` is required by every `getREST*` call (Dysnomia rejects them with
 * "REST mode is not enabled" otherwise): the nickname check/restore and name resolution use them.
 */
export function clientOptions(): ConstructorParameters<typeof Client>[1] {
  return {
    // Only the non-privileged `guilds` and `guildVoiceStates` intents are needed.
    gateway: { intents: ['guilds', 'guildVoiceStates'] },
    allowedMentions: { everyone: false, roles: false, users: false },
    messageLimit: 0,
    restMode: true
  };
}

function displayName(member: Member): string {
  return member.nick ?? member.globalName ?? member.username;
}

export class DiscordBot {
  readonly client: Client;
  private readonly recordings = new Map<string, RecordingHandle>();
  private readonly starting = new Set<string>();
  /** Auto-stop reasons that fired while the recording was still starting (not yet registered). */
  private readonly pendingStops = new Map<string, StopReason>();
  private abandoned = false;
  private shuttingDown = false;
  private readonly process: (input: ProcessRecordingInput) => Promise<unknown>;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: DiscordBotOptions) {
    this.client = opts.client ?? new Client(`Bot ${opts.token}`, clientOptions());
    this.process = opts.createProcessor(this.client);
    this.wire();
  }

  async start(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Graceful shutdown: finalizes active recordings, gives the processing queue a bounded time to
   * finish, then kills any whisper/claude child still running. Whatever is left stays in
   * `<recordings>/.work/` so it can be transcribed by hand.
   */
  async shutdown(): Promise<void> {
    const { log } = this.opts;
    this.shuttingDown = true; // from now on /grabar is refused: nobody would stop that recording
    await Promise.all([...this.recordings.keys()].map((guildId) => this.finishSafely(guildId, 'shutdown')));

    const timeoutMs = this.opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.queue.then(() => false),
      new Promise<boolean>((r) => (timer = setTimeout(() => r(true), timeoutMs)))
    ]);
    clearTimeout(timer);
    if (timedOut) {
      this.abandoned = true;
      const killed = (this.opts.killChildren ?? killRunningProcesses)();
      log(`Shutdown: processing did not finish in ${Math.round(timeoutMs / 1000)}s, killed ${killed} child process(es). Unprocessed audio stays in ${join(this.opts.recordingsDir, '.work')}`);
    }
    this.client.disconnect({ reconnect: false });
  }

  private wire(): void {
    const { log } = this.opts;
    this.client.on('ready', () => void this.onReady());
    this.client.on('error', (err) => log('Discord client error', err));
    this.client.on('interactionCreate', (interaction) => {
      if (interaction instanceof CommandInteraction) void this.handleCommand(interaction);
    });
    this.client.on('guildCreate', (guild) => void this.leaveIfNotAllowed(guild.id));
    const voiceChanged = (_member: Member, channel: AnyVoiceChannel, old?: AnyVoiceChannel) => {
      for (const c of [channel, old]) if (c) this.recordings.get(c.guild.id)?.checkEmpty();
    };
    this.client.on('voiceChannelJoin', (m, c) => voiceChanged(m, c));
    this.client.on('voiceChannelLeave', (m, c) => voiceChanged(m, c));
    this.client.on('voiceChannelSwitch', (m, n, o) => voiceChanged(m, n, o));
  }

  private async onReady(): Promise<void> {
    const { log, allowedGuildIds } = this.opts;
    log(`Logged in as ${this.client.user.username}`);
    for (const id of guildsToLeave(allowedGuildIds, [...this.client.guilds.values()].map((g) => g.id))) await this.leaveIfNotAllowed(id);
    try {
      // Commands are registered per allowed guild only; clear any global ones left by an older run.
      await this.client.bulkEditCommands([]);
      for (const guildId of allowedGuildIds) await this.client.bulkEditGuildCommands(guildId, COMMANDS);
      log(`Registered slash commands in ${allowedGuildIds.length} guild(s)`);
    } catch (e) {
      log('Failed to register slash commands', e);
    }
    await this.clearStaleIndicators();
  }

  private async leaveIfNotAllowed(guildId: string): Promise<void> {
    if (isGuildAllowed(this.opts.allowedGuildIds, guildId)) return;
    this.opts.log(`Leaving guild ${guildId}: it is not in ALLOWED_GUILD_IDS`);
    try {
      await this.client.leaveGuild(guildId);
    } catch (e) {
      this.opts.log(`Could not leave guild ${guildId}`, e);
    }
  }

  /** If the bot crashed mid-recording its nickname may still carry the indicator. */
  private async clearStaleIndicators(): Promise<void> {
    for (const guild of this.client.guilds.values()) {
      if (!isGuildAllowed(this.opts.allowedGuildIds, guild.id)) continue;
      try {
        const me = await this.client.getRESTGuildMember(guild.id, this.client.user.id);
        const fix = staleIndicatorFix(me.nick);
        if (fix) await this.client.editGuildMember(guild.id, '@me', { nick: fix.nick }, 'Clearing stale recording indicator');
      } catch (e) {
        this.opts.log(`Could not check the nickname in guild ${guild.id}`, e);
      }
    }
  }

  /** Entry point for slash commands. Public so tests can drive it with fakes. */
  async handleCommand(interaction: CommandInteraction): Promise<void> {
    if (!isGuildAllowed(this.opts.allowedGuildIds, interaction.guild?.id)) {
      const where = interaction.guild ? `guild ${interaction.guild.id}` : 'a direct message';
      this.opts.log(`Ignored /${interaction.data.name} from ${where}`);
      await this.reply(interaction, 'Este bot no está autorizado en este servidor.', true).catch(() => {});
      return;
    }
    try {
      if (interaction.data.name === RECORD_COMMAND) await this.handleRecord(interaction);
      else if (interaction.data.name === STOP_COMMAND) await this.handleStop(interaction);
    } catch (e) {
      this.opts.log(`Command ${interaction.data.name} failed`, e);
      await this.reply(interaction, 'Algo ha fallado. Inténtalo de nuevo en un momento.').catch(() => {});
    }
  }

  private async reply(interaction: CommandInteraction, content: string, ephemeral = false): Promise<void> {
    if (interaction.acknowledged) await interaction.editOriginalMessage({ content });
    else await interaction.createMessage({ content, flags: ephemeral ? EPHEMERAL_FLAG : 0 });
  }

  private voiceChannelOf(guild: Guild, userId: string): AnyVoiceChannel | undefined {
    for (const channel of guild.channels.values()) {
      if ('voiceMembers' in channel && channel.voiceMembers.has(userId)) return channel as AnyVoiceChannel;
    }
    return undefined;
  }

  /** Handles `/grabar`. Public so tests can drive it with fakes. */
  async handleRecord(interaction: CommandInteraction): Promise<void> {
    const guildId = interaction.guild?.id;
    const guild = guildId ? this.client.guilds.get(guildId) : undefined;
    const userId = interaction.member?.id;
    if (!guild || !userId) return this.reply(interaction, 'Este comando solo funciona en un servidor.', true);
    if (this.shuttingDown) return this.reply(interaction, 'El bot se está apagando y no puede empezar grabaciones nuevas. Inténtalo en unos minutos.', true);

    if (this.recordings.has(guild.id) || this.starting.has(guild.id)) {
      return this.reply(interaction, 'Ya hay una grabación en curso en este servidor. Usa `/parar` para terminarla.', true);
    }
    const channel = this.voiceChannelOf(guild, userId);
    if (!channel) return this.reply(interaction, 'Primero entra en un canal de voz y luego usa `/grabar`.', true);

    this.starting.add(guild.id);
    let rec: RecordingHandle;
    try {
      await interaction.defer();
      const params: RecordingParams = {
        client: this.client,
        channel,
        textChannelId: interaction.channel?.id ?? channel.id,
        workDir: resolve(this.opts.recordingsDir, '.work', `${guild.id}-${Date.now()}`),
        log: (m, e) => this.opts.log(`[${guild.name}] ${m}`, e),
        onAutoStop: (reason) => this.autoStop(guild.id, reason)
      };
      rec = this.opts.createRecording ? this.opts.createRecording(params) : new ActiveRecording(params);
      try {
        await rec.start();
      } catch (e) {
        this.opts.log('Could not start the recording', e);
        await rec.stop().catch(() => {});
        return this.reply(interaction, 'No he podido unirme al canal de voz. Comprueba que tengo permiso para conectarme e inténtalo de nuevo.');
      }
      if (this.shuttingDown) {
        // Shutdown began while this recording was still starting: nobody would stop it, so cancel it now.
        await rec.stop().catch((e) => this.opts.log('Stopping a recording that started during shutdown failed', e));
        return this.reply(interaction, 'El bot se está apagando, así que la grabación se ha cancelado. Inténtalo en unos minutos.');
      }
      this.recordings.set(guild.id, rec);
    } finally {
      // Always release the guard and drop any stop reason that belonged to this attempt.
      this.starting.delete(guild.id);
      if (!this.recordings.has(guild.id)) this.pendingStops.delete(guild.id);
    }

    try {
      await interaction.editOriginalMessage({
        content:
          `🔴 **Grabando** ${channel.mention}.\n` +
          'Todo lo que se diga en este canal se está grabando para transcribirlo y resumirlo. ' +
          'El audio se procesa en un servidor propio. Si no quieres que se grabe tu voz, sal del canal.\n' +
          'Cuando terminéis, usa `/parar`.'
      });
    } catch (e) {
      this.opts.log('Could not announce the recording', e);
    } finally {
      // An auto-stop (e.g. moved, disconnected) may have fired while the recording was still starting.
      // Always consume it, even if the announcement failed, so it is neither lost nor applied to a later recording.
      const pending = this.pendingStops.get(guild.id);
      this.pendingStops.delete(guild.id);
      if (pending) await this.finishSafely(guild.id, pending);
    }
  }

  /** Handles `/parar`. */
  async handleStop(interaction: CommandInteraction): Promise<void> {
    const guildId = interaction.guild?.id;
    const rec = guildId ? this.recordings.get(guildId) : undefined;
    if (!rec) return this.reply(interaction, 'No hay ninguna grabación en curso.', true);
    if (!rec.channel.voiceMembers.has(interaction.member?.id ?? '')) {
      return this.reply(interaction, 'Solo quien esté en el canal de voz que se está grabando puede detener la grabación.', true);
    }
    await interaction.defer();
    await this.finish(rec.guildId, 'user', interaction);
  }

  /** Auto-stop entry point: applies the stop now, or remembers it if the recording is still starting. */
  private autoStop(guildId: string, reason: StopReason): void {
    if (this.recordings.has(guildId)) void this.finishSafely(guildId, reason);
    else if (this.starting.has(guildId) && !this.pendingStops.has(guildId)) this.pendingStops.set(guildId, reason);
  }

  /** Like finish(), but never rejects: used where nobody awaits the result (auto-stops, shutdown). */
  private async finishSafely(guildId: string, reason: StopReason): Promise<void> {
    const textChannelId = this.recordings.get(guildId)?.textChannelId;
    try {
      await this.finish(guildId, reason);
    } catch (e) {
      this.opts.log(`Stopping the recording (${reason}) failed`, e);
      if (textChannelId) {
        await this.client
          .createMessage(textChannelId, '⚠️ Ha fallado al detener la grabación. Si hay audio, queda guardado en disco.')
          .catch(() => {});
      }
    }
  }

  /** Stops a recording and queues its transcription + summary. */
  private async finish(guildId: string, reason: StopReason, interaction?: CommandInteraction): Promise<void> {
    const rec = this.recordings.get(guildId);
    if (!rec) return;
    this.recordings.delete(guildId); // also makes a second trigger (e.g. auto-stop racing /parar) a no-op
    const guild = rec.channel.guild;
    const tracks = await rec.stop();

    const text = `⏹️ ${stopMessage(reason)} Procesando la transcripción, puede tardar unos minutos.`;
    if (interaction) await interaction.editOriginalMessage({ content: text }).catch((e) => this.opts.log('Could not edit reply', e));
    else await this.client.createMessage(rec.textChannelId, text).catch((e) => this.opts.log('Could not announce stop', e));

    const names = uniqueSpeakerNames(await Promise.all(tracks.map(async (t) => ({ userId: t.userId, name: await this.resolveName(guild, t.userId) }))));
    const input: ProcessRecordingInput = {
      channelName: rec.channel.name,
      textChannelId: rec.textChannelId,
      startedAt: rec.startedAt,
      tracks: tracks.map((t) => ({ speaker: names.get(t.userId) ?? `Usuario ${t.userId}`, wavPath: t.wavPath }))
    };

    // One transcription at a time: whisper-large saturates the GPU.
    this.queue = this.queue.then(async () => {
      if (this.abandoned) {
        this.opts.log(`Skipping processing of ${rec.workDir}: shutting down. Audio kept there.`);
        return;
      }
      try {
        await this.process(input);
      } catch (e) {
        this.opts.log('Processing failed', e);
        await this.client
          .createMessage(rec.textChannelId, '⚠️ Ha fallado el procesado de la grabación. El audio sigue en disco.')
          .catch(() => {});
      } finally {
        // Only succeeds when every track was transcribed and discarded; otherwise say where the audio is.
        await rmdir(rec.workDir).catch(() => this.opts.log(`Unprocessed audio kept in ${rec.workDir}`));
      }
    });
  }

  private async resolveName(guild: Guild, userId: string): Promise<string> {
    const cached = guild.members.get(userId);
    if (cached) return displayName(cached);
    try {
      return displayName(await this.client.getRESTGuildMember(guild.id, userId));
    } catch {
      return `Usuario ${userId}`;
    }
  }
}

