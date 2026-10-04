import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@projectdysnomia/dysnomia';
import { DiscordBot, clientOptions, type RecordingHandle, type RecordingParams } from '../src/adapters/discord/discord-bot.js';
import type { FinishedTrack } from '../src/app/session-recorder.js';

const GUILD = 'guild-1';

function fakeClient() {
  const channel = { id: 'vc-1', name: 'general', guild: undefined as unknown, voiceMembers: new Map([['user-1', {}]]) };
  const guild = { id: GUILD, name: 'Guild', channels: new Map([[channel.id, channel]]), members: new Map() };
  channel.guild = guild;
  const client = Object.assign(new EventEmitter(), {
    guilds: new Map([[GUILD, guild]]),
    user: { id: 'bot', username: 'scribe' },
    createMessage: vi.fn(async () => ({})),
    disconnect: vi.fn(),
    connect: vi.fn(),
    getRESTGuildMember: vi.fn(async () => ({ nick: null, username: 'someone' })),
    bulkEditGuildCommands: vi.fn(async () => []),
    bulkEditCommands: vi.fn(async () => []),
    leaveGuild: vi.fn(async () => {}),
    editGuildMember: vi.fn(async () => {})
  });
  return { client, channel };
}

function fakeInteraction(opts: { deferRejects?: boolean; guildId?: string | null } = {}) {
  const calls = { createMessage: [] as string[], edit: [] as string[] };
  const i = {
    guild: opts.guildId === null ? undefined : { id: opts.guildId ?? GUILD },
    member: { id: 'user-1' },
    channel: { id: 'text-1' },
    data: { name: 'grabar' },
    acknowledged: false,
    defer: vi.fn(async () => {
      if (opts.deferRejects) throw new Error('interaction expired');
      i.acknowledged = true;
    }),
    createMessage: vi.fn(async (m: { content: string }) => void calls.createMessage.push(m.content)),
    editOriginalMessage: vi.fn(async (m: { content: string }) => void calls.edit.push(m.content))
  };
  return { i, calls };
}

class FakeRecording implements RecordingHandle {
  readonly startedAt = new Date(2026, 9, 4, 10, 0);
  readonly textChannelId: string;
  readonly channel: RecordingParams['channel'];
  readonly workDir: string;
  readonly guildId = GUILD;
  stops = 0;
  constructor(readonly params: RecordingParams, private readonly behaviour: { onStart?: (p: RecordingParams) => void | Promise<void>; stopFails?: boolean } = {}) {
    this.textChannelId = params.textChannelId;
    this.channel = params.channel;
    this.workDir = params.workDir;
  }
  async start() {
    await this.behaviour.onStart?.(this.params);
  }
  async stop(): Promise<FinishedTrack[]> {
    this.stops++;
    if (this.behaviour.stopFails) throw new Error('disk exploded');
    return [];
  }
  checkEmpty() {}
}

function setup(
  behaviour: ConstructorParameters<typeof FakeRecording>[1] = {},
  extra: { process?: () => Promise<unknown>; shutdownTimeoutMs?: number; allowedGuildIds?: string[] } = {}
) {
  const { client, channel } = fakeClient();
  const logs: string[] = [];
  const recordings: FakeRecording[] = [];
  const killChildren = vi.fn(() => 0);
  const processed = vi.fn(extra.process ?? (async () => {}));
  const bot = new DiscordBot({
    token: 'x',
    allowedGuildIds: extra.allowedGuildIds ?? [GUILD],
    recordingsDir: '/tmp/does-not-matter',
    client: client as unknown as Client,
    createRecording: (p) => {
      const r = new FakeRecording(p, behaviour);
      recordings.push(r);
      return r;
    },
    createProcessor: () => processed,
    log: (m, e) => logs.push(`${m} ${e instanceof Error ? e.message : ''}`),
    shutdownTimeoutMs: extra.shutdownTimeoutMs ?? 1000,
    killChildren
  });
  return { bot, client, channel, logs, recordings, killChildren, processed };
}

const record = (bot: DiscordBot, i: ReturnType<typeof fakeInteraction>['i']) => bot.handleRecord(i as never);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('DiscordBot lifecycle guards', () => {
  it('releases the starting guard when the interaction cannot be deferred', async () => {
    const s = setup();
    await record(s.bot, fakeInteraction({ deferRejects: true }).i).catch(() => {});
    const second = fakeInteraction();
    await record(s.bot, second.i);
    expect(second.calls.createMessage.join(' ')).not.toMatch(/Ya hay una grabación/);
    expect(s.recordings).toHaveLength(1);
  });

  it('applies an auto-stop that fires before the recording is registered', async () => {
    const s = setup({ onStart: (p) => p.onAutoStop('moved') });
    await record(s.bot, fakeInteraction().i);
    await tick();
    expect(s.recordings[0]!.stops).toBe(1);
    expect(s.client.createMessage.mock.calls.map((c) => String((c as unknown[])[1])).join(' ')).toMatch(/movido/);
    // The guild is free again.
    const again = fakeInteraction();
    await record(s.bot, again.i);
    expect(s.recordings).toHaveLength(2);
  });

  it('survives a failing auto-stop and logs it', async () => {
    const s = setup({ stopFails: true });
    await record(s.bot, fakeInteraction().i);
    s.recordings[0]!.params.onAutoStop('empty');
    await tick();
    expect(s.logs.join('\n')).toMatch(/disk exploded/);
  });

  it('finalizes active recordings and waits for processing on shutdown', async () => {
    let done = false;
    const s = setup({}, {
      process: async () => {
        await tick(50);
        done = true;
      }
    });
    // A recording with one track so processing is queued.
    await record(s.bot, fakeInteraction().i);
    const rec = s.recordings[0]!;
    rec.stop = async () => [{ userId: 'user-1', wavPath: '/w/a.wav', samples: 1 }];
    await s.bot.shutdown();
    expect(done).toBe(true);
    expect(s.killChildren).not.toHaveBeenCalled();
    expect(s.client.disconnect).toHaveBeenCalled();
  });

  it('kills children and still disconnects when processing outlasts the shutdown timeout', async () => {
    const s = setup({}, { process: () => new Promise(() => {}), shutdownTimeoutMs: 50 });
    await record(s.bot, fakeInteraction().i);
    s.recordings[0]!.stop = async () => [{ userId: 'user-1', wavPath: '/w/a.wav', samples: 1 }];
    await s.bot.shutdown();
    expect(s.killChildren).toHaveBeenCalled();
    expect(s.client.disconnect).toHaveBeenCalled();
    expect(s.logs.join('\n')).toMatch(/\.work/);
  });

  it('rejects /grabar once shutdown has started', async () => {
    const s = setup({}, { process: async () => tick(50) });
    await record(s.bot, fakeInteraction().i);
    s.recordings[0]!.stop = async () => [{ userId: 'user-1', wavPath: '/w/a.wav', samples: 1 }];
    const down = s.bot.shutdown();
    const late = fakeInteraction();
    await record(s.bot, late.i);
    await down;
    expect(s.recordings).toHaveLength(1);
    expect(late.calls.createMessage.join(' ')).toMatch(/apag/);
  });

  it('stops a recording that finished starting after shutdown began instead of registering it', async () => {
    let release!: () => void;
    const s = setup({ onStart: () => new Promise<void>((r) => (release = r)) });
    const x = fakeInteraction();
    const starting = record(s.bot, x.i);
    await tick();
    const down = s.bot.shutdown(); // /grabar is still in `starting`: nothing registered yet
    await down;
    release();
    await starting;
    expect(s.recordings[0]!.stops).toBe(1);
    expect(x.calls.edit.join(' ')).toMatch(/apag/);
    expect(x.calls.edit.join(' ')).not.toMatch(/Grabando/);
    // Nothing is left registered: a second shutdown has nothing to finalize.
    await s.bot.shutdown();
    expect(s.recordings[0]!.stops).toBe(1);
  });

  it('does not leak a pending stop when the recording fails to start', async () => {
    let first = true;
    const s = setup({
      onStart: (p) => {
        if (!first) return;
        first = false;
        p.onAutoStop('moved');
        throw new Error('join failed');
      }
    });
    await record(s.bot, fakeInteraction().i);
    await record(s.bot, fakeInteraction().i);
    await tick();
    expect(s.recordings).toHaveLength(2);
    expect(s.recordings[1]!.stops).toBe(0);
  });

  it('still applies a pending stop when editing the reply fails', async () => {
    let first = true;
    const s = setup({
      onStart: (p) => {
        if (first) p.onAutoStop('moved');
        first = false;
      }
    });
    const it1 = fakeInteraction();
    it1.i.editOriginalMessage.mockRejectedValue(new Error('edit failed'));
    await record(s.bot, it1.i).catch(() => {});
    await tick();
    expect(s.recordings[0]!.stops).toBe(1);
    const again = fakeInteraction();
    await record(s.bot, again.i);
    expect(s.recordings).toHaveLength(2);
    expect(s.recordings[1]!.stops).toBe(0);
  });

  it('labels a failed shutdown stop as such', async () => {
    const s = setup({ stopFails: true });
    await record(s.bot, fakeInteraction().i);
    await s.bot.shutdown();
    expect(s.logs.join('\n')).toMatch(/Stopping the recording \(shutdown\) failed/);
  });
});

describe('clientOptions', () => {
  it('enables REST mode so getRESTGuildMember works', () => {
    expect(clientOptions()?.restMode).toBe(true);
  });
});

describe('access control', () => {
  it('registers commands only in each allowed guild and clears global ones', async () => {
    const s = setup({}, { allowedGuildIds: [GUILD, 'guild-2'] });
    s.client.emit('ready');
    await tick();
    expect(s.client.bulkEditGuildCommands.mock.calls.map((c) => (c as unknown[])[0])).toEqual([GUILD, 'guild-2']);
    expect(s.client.bulkEditCommands).toHaveBeenCalledWith([]);
  });

  it('leaves cached guilds that are not allowed on startup', async () => {
    const s = setup();
    s.client.guilds.set('intruder', { id: 'intruder', name: 'Other', channels: new Map(), members: new Map() });
    s.client.emit('ready');
    await tick();
    expect(s.client.leaveGuild).toHaveBeenCalledTimes(1);
    expect(s.client.leaveGuild).toHaveBeenCalledWith('intruder');
    expect(s.logs.join('\n')).toMatch(/Leaving guild intruder/);
    // Nickname cleanup only touches allowed guilds.
    expect(s.client.getRESTGuildMember.mock.calls.map((c) => (c as unknown[])[0])).toEqual([GUILD]);
  });

  it('leaves a non-allowed guild when it is joined and keeps an allowed one', async () => {
    const s = setup();
    s.client.emit('guildCreate', { id: 'intruder', name: 'Other' });
    s.client.emit('guildCreate', { id: GUILD, name: 'Guild' });
    await tick();
    expect(s.client.leaveGuild.mock.calls).toEqual([['intruder']]);
  });

  it('answers with an ephemeral message and does nothing for a non-allowed guild', async () => {
    const s = setup();
    const x = fakeInteraction({ guildId: 'intruder' });
    await s.bot.handleCommand(x.i as never);
    expect(s.recordings).toHaveLength(0);
    expect(x.i.createMessage).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
    expect(x.calls.createMessage.join(' ')).toMatch(/no está autorizado/);
  });

  it('ignores direct messages', async () => {
    const s = setup();
    const x = fakeInteraction({ guildId: null });
    await s.bot.handleCommand(x.i as never);
    expect(s.recordings).toHaveLength(0);
    expect(x.i.createMessage).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
  });

  it('still handles commands from an allowed guild', async () => {
    const s = setup();
    await s.bot.handleCommand(fakeInteraction().i as never);
    expect(s.recordings).toHaveLength(1);
  });
});
