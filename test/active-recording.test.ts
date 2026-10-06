import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyVoiceChannel, Client } from '@projectdysnomia/dysnomia';
import { ActiveRecording } from '../src/adapters/discord/active-recording.js';

function fakeConnection() {
  const receiver = new EventEmitter();
  return Object.assign(new EventEmitter(), { channelID: 'vc-1', receive: vi.fn(() => receiver), receiver });
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const workDir = await mkdtemp(join(tmpdir(), 'scribe-active-'));
  tempDirs.push(workDir);
  let resolveJoin!: (c: ReturnType<typeof fakeConnection>) => void;
  const channel = {
    id: 'vc-1',
    guild: { id: 'g', members: new Map([['bot', { nick: null }]]) },
    voiceMembers: { filter: () => [1] },
    join: vi.fn(() => new Promise((r) => (resolveJoin = r as typeof resolveJoin))),
    leave: vi.fn()
  };
  const client = {
    user: { id: 'bot', username: 'scribe' },
    voiceConnections: { has: () => false, leave: vi.fn() },
    editGuildMember: vi.fn(async () => {})
  };
  const rec = new ActiveRecording({
    client: client as unknown as Client,
    channel: channel as unknown as AnyVoiceChannel,
    textChannelId: 't',
    workDir,
    log: () => {},
    onAutoStop: () => {}
  });
  return { rec, channel, client, join: (c: ReturnType<typeof fakeConnection>) => resolveJoin(c) };
}

describe('ActiveRecording', () => {
  it('leaves again and does not wire up or touch the nickname when stopped while joining', async () => {
    const s = await setup();
    const started = s.rec.start();
    await vi.waitFor(() => expect(s.channel.join).toHaveBeenCalled());
    await s.rec.stop();
    const connection = fakeConnection();
    s.join(connection);
    await started;
    expect(s.channel.leave).toHaveBeenCalledTimes(2);
    expect(connection.receive).not.toHaveBeenCalled();
    expect(s.client.editGuildMember).not.toHaveBeenCalled();
  });

  describe('notes', () => {
    // Controllable monotonic clock: ActiveRecording and the SessionRecorder both read process.hrtime.bigint.
    let nowNs = 0n;
    const mockClock = () => vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => nowNs);
    afterEach(() => vi.restoreAllMocks());

    it('stamps notes relative to the same start stamp the recorder uses for WAV offsets', async () => {
      mockClock();
      nowNs = 9_000_000_000_000n; // arbitrary process uptime at start
      const s = await setup();
      const started = s.rec.start();
      await vi.waitFor(() => expect(s.channel.join).toHaveBeenCalled());
      s.join(fakeConnection());
      await started;

      nowNs += 12_345_000_000n;
      s.rec.addNote('Ana', 'https://x.dev');
      expect(s.rec.elapsedMs()).toBe(12_345);
      expect(s.rec.notes).toEqual([{ author: 'Ana', text: 'https://x.dev', atMs: 12_345 }]);
      await s.rec.stop();
    });

    it('stamps a note added before start() at 0 instead of the process uptime', async () => {
      mockClock();
      nowNs = 9_000_000_000_000n;
      const s = await setup();
      expect(s.rec.elapsedMs()).toBe(0);
      s.rec.addNote('Ana', 'early');
      expect(s.rec.notes[0]!.atMs).toBe(0);
    });
  });
});
