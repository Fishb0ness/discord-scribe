import type { AnyVoiceChannel, Client, VoiceConnection } from '@projectdysnomia/dysnomia';
import type { Note } from '../../domain/transcript.js';
import { SessionRecorder, type FinishedTrack } from '../../app/session-recorder.js';
import { withRecordingIndicator, withoutRecordingIndicator } from '../../domain/nickname.js';
import { createPacketGuard } from '../../domain/packet-guard.js';
import { EncryptionRecoveryMonitor, retry } from '../../domain/recovery.js';
import { createOpusDecoder } from '../opus-decoder.js';
import { NO_AUDIO_TIMEOUT_MS, type StopReason } from './stop-reason.js';
import { WavFileWriter } from '../wav-file-writer.js';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export interface ActiveRecordingOptions {
  client: Client;
  channel: AnyVoiceChannel;
  textChannelId: string;
  /** Directory where the per-user WAV files are written while recording. */
  workDir: string;
  log: (message: string, error?: unknown) => void;
  /** Called when the recording decides to end by itself (everyone left, encryption failure, ...). */
  onAutoStop: (reason: StopReason) => void;
}

const RECONNECT_ATTEMPTS = 3;
const RECONNECT_WAIT_MS = 500;
const MAX_CONSECUTIVE_PACKET_FAILURES = 25;
const EMPTY_GRACE_MS = 15 * 1000;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One recording in one guild: voice connection, packet intake and the bot's nickname indicator. */
export class ActiveRecording {
  readonly channel: AnyVoiceChannel;
  readonly textChannelId: string;
  readonly startedAt = new Date();
  readonly workDir: string;
  readonly notes: Note[] = [];

  private readonly client: Client;
  private readonly log: ActiveRecordingOptions['log'];
  private readonly onAutoStop: ActiveRecordingOptions['onAutoStop'];
  private readonly recovery = new EncryptionRecoveryMonitor(5);
  private recorder!: SessionRecorder;
  private startNs = 0n;
  private connection: VoiceConnection | null = null;
  private stopped = false;
  private reconnecting = false;
  private originalNick: string | null = null;
  private nickChanged = false;
  private emptyTimer: NodeJS.Timeout | null = null;
  private noAudioTimer: NodeJS.Timeout | null = null;

  constructor(opts: ActiveRecordingOptions) {
    this.client = opts.client;
    this.channel = opts.channel;
    this.textChannelId = opts.textChannelId;
    this.workDir = opts.workDir;
    this.log = opts.log;
    this.onAutoStop = opts.onAutoStop;
  }

  /** Milliseconds since the audio clock started: the same zero as the offsets of the per-speaker WAVs. */
  elapsedMs(): number {
    return Number(process.hrtime.bigint() - this.startNs) / 1e6;
  }

  addNote(author: string, text: string): void {
    this.notes.push({ author, text, atMs: Math.round(this.elapsedMs()) });
  }

  get guildId(): string {
    return this.channel.guild.id;
  }

  async start(): Promise<void> {
    await mkdir(this.workDir, { recursive: true });
    this.startNs = process.hrtime.bigint();
    this.recorder = new SessionRecorder({
      nowNs: () => process.hrtime.bigint(),
      startNs: this.startNs,
      createDecoder: createOpusDecoder,
      createWav: (userId) => new WavFileWriter(join(this.workDir, `${userId}.wav`)),
      onTrackError: (userId, e) => this.log(`Could not finalize the audio of user ${userId}`, e)
    });

    // A stale connection (e.g. left over from a crash) would make join() reuse it.
    if (this.client.voiceConnections.has(this.guildId)) this.client.voiceConnections.leave(this.guildId);

    await this.connect();
    if (this.stopped) return; // stopped while joining: nothing else to set up
    await this.setIndicator().catch((e) => this.log('Could not set the recording nickname', e));
    if (this.stopped) {
      await this.restoreIndicator().catch((e) => this.log('Could not restore the nickname', e));
      return;
    }

    this.noAudioTimer = setTimeout(() => {
      if (this.recorder.packetsAccepted === 0) {
        this.log('No audio received from anyone, stopping');
        this.onAutoStop('no-audio');
      }
    }, NO_AUDIO_TIMEOUT_MS);
    this.checkEmpty();
  }

  /** Stops receiving, leaves the channel, restores the nickname and returns the finished per-user tracks. */
  async stop(): Promise<FinishedTrack[]> {
    if (this.stopped) return [];
    this.stopped = true;
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    if (this.noAudioTimer) clearTimeout(this.noAudioTimer);
    this.detach(this.connection);
    try {
      this.channel.leave();
    } catch (e) {
      this.log('Error leaving the voice channel', e);
    }
    const tracks = this.recorder.finish();
    await this.restoreIndicator().catch((e) => this.log('Could not restore the nickname', e));
    return tracks;
  }

  /** Call on voice join/leave/switch events so the recording can end when the channel empties. */
  checkEmpty(): void {
    if (this.stopped) return;
    const humans = this.channel.voiceMembers.filter((m) => !m.bot).length;
    if (humans > 0) {
      if (this.emptyTimer) clearTimeout(this.emptyTimer);
      this.emptyTimer = null;
    } else if (!this.emptyTimer) {
      this.emptyTimer = setTimeout(() => {
        this.emptyTimer = null;
        if (this.channel.voiceMembers.filter((m) => !m.bot).length === 0) this.onAutoStop('empty');
      }, EMPTY_GRACE_MS);
    }
  }

  private async connect(): Promise<void> {
    const connection = await this.channel.join({ opusOnly: true, selfDeaf: false });
    if (this.stopped) {
      // stop() ran while the join was pending: do not keep (or re-wire) a connection nobody owns.
      try {
        this.channel.leave();
      } catch (e) {
        this.log('Error leaving the voice channel', e);
      }
      return;
    }
    this.connection = connection;

    // A throwing handler (e.g. disk full) must never escape into the voice emitter.
    const onPacket = createPacketGuard(
      (data: Buffer, userId: string, timestamp: number) => {
        this.recovery.onAudio(data);
        this.recorder.handlePacket(data, userId, timestamp);
      },
      {
        maxConsecutiveFailures: MAX_CONSECUTIVE_PACKET_FAILURES,
        onError: (e) => this.log('Failed to record a voice packet', e),
        onGiveUp: () => {
          this.log('Too many consecutive packet failures, stopping the recording');
          this.onAutoStop('storage');
        }
      }
    );
    const receiver = connection.receive('opus');
    receiver.on('data', (data, userId, timestamp) => {
      if (!this.stopped) onPacket(data, userId, timestamp);
    });

    connection.on('warn', (message) => {
      this.log(`voice warning: ${message}`);
      if (this.recovery.onWarning(message)) {
        this.log('Too many DAVE transition failures, stopping the recording');
        this.onAutoStop('encryption');
      }
    });
    connection.on('error', (err) => this.log('voice error', err));
    connection.on('connect', () => {
      if (!this.stopped && connection.channelID && connection.channelID !== this.channel.id) this.onAutoStop('moved');
    });
    connection.on('disconnect', (err) => void this.onDisconnect(err));
  }

  private async onDisconnect(err?: Error): Promise<void> {
    if (this.stopped || this.reconnecting) return;
    this.log('Voice connection disconnected', err);
    if (!err) {
      // Closed on purpose (kicked from the channel, channel deleted, ...).
      this.onAutoStop('disconnected');
      return;
    }
    this.reconnecting = true;
    this.detach(this.connection);
    try {
      this.channel.leave();
      await retry(
        RECONNECT_ATTEMPTS,
        async (attempt) => {
          if (this.stopped) return; // never rejoin after stop()
          this.log(`Reconnecting to voice (attempt ${attempt})`);
          await this.connect(); // leaves again by itself if stop() ran while joining
        },
        () => wait(RECONNECT_WAIT_MS)
      );
      if (!this.stopped) this.log('Voice reconnected');
    } catch (e) {
      if (this.stopped) return;
      this.log(`Could not reconnect after ${RECONNECT_ATTEMPTS} attempts`, e);
      this.onAutoStop('error');
    } finally {
      this.reconnecting = false;
    }
  }

  private detach(connection: VoiceConnection | null): void {
    if (!connection) return;
    for (const event of ['warn', 'error', 'connect', 'disconnect']) connection.removeAllListeners(event);
    connection.receiveStreamOpus?.removeAllListeners('data');
  }

  private async selfMember() {
    const id = this.client.user.id;
    return this.channel.guild.members.get(id) ?? (await this.client.getRESTGuildMember(this.guildId, id));
  }

  private async setIndicator(): Promise<void> {
    const me = await this.selfMember();
    this.originalNick = withoutRecordingIndicator(me.nick);
    await this.client.editGuildMember(
      this.guildId,
      '@me',
      { nick: withRecordingIndicator(this.originalNick ?? this.client.user.username) },
      'Recording started'
    );
    this.nickChanged = true;
  }

  private async restoreIndicator(): Promise<void> {
    if (!this.nickChanged) return;
    await this.client.editGuildMember(this.guildId, '@me', { nick: this.originalNick }, 'Recording ended');
    this.nickChanged = false;
  }
}
