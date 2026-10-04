import { describe, expect, it } from 'vitest';
import { processRecording, type ProcessRecordingInput } from '../src/app/process-recording.js';
import type { ChatNotifier, OutputStore, ProcessResult, Summarizer, Transcriber } from '../src/app/ports.js';
import type { Segment } from '../src/domain/transcript.js';

class FakeStore implements OutputStore {
  files = new Map<string, string>();
  discarded: string[] = [];
  async createRecordingDir(startedAt: Date, channelName: string) {
    return `/out/${channelName}`;
  }
  async writeFile(dir: string, name: string, content: string) {
    const p = `${dir}/${name}`;
    this.files.set(p, content);
    return p;
  }
  async discardAudio(paths: string[]) {
    this.discarded.push(...paths);
  }
}

class FakeNotifier implements ChatNotifier {
  posted: Array<{ channelId: string; result: ProcessResult }> = [];
  fail = false;
  async postResult(channelId: string, result: ProcessResult) {
    if (this.fail) throw new Error('discord down');
    this.posted.push({ channelId, result });
  }
}

const input: ProcessRecordingInput = {
  channelName: 'general',
  textChannelId: 'text-1',
  startedAt: new Date(2026, 9, 4, 10, 0, 0),
  tracks: [
    { speaker: 'Ana', wavPath: '/w/ana.wav' },
    { speaker: 'Luis', wavPath: '/w/luis.wav' }
  ]
};

const seg = (startMs: number, text: string): Segment => ({ startMs, endMs: startMs + 1000, text });

function transcriber(map: Record<string, Segment[] | Error>): Transcriber {
  return {
    async transcribe(wavPath) {
      const v = map[wavPath];
      if (v instanceof Error) throw v;
      return v ?? [];
    }
  };
}

const okSummarizer = (calls: string[] = []): Summarizer => ({
  async summarize(transcript) {
    calls.push(transcript);
    return '## Resumen\nTodo bien.';
  }
});

describe('processRecording', () => {
  it('transcribes, merges, summarizes, stores, notifies and discards audio', async () => {
    const store = new FakeStore();
    const notifier = new FakeNotifier();
    const calls: string[] = [];
    const r = await processRecording(
      { transcriber: transcriber({ '/w/ana.wav': [seg(0, 'Hola')], '/w/luis.wav': [seg(2000, 'Buenas')] }), summarizer: okSummarizer(calls), output: store, notifier },
      input
    );

    expect(r.warnings).toEqual([]);
    expect(r.transcriptPath).toBe('/out/general/transcript.md');
    expect(r.summaryPath).toBe('/out/general/summary.md');
    const transcript = store.files.get('/out/general/transcript.md')!;
    expect(transcript).toContain('[00:00] **Ana**: Hola');
    expect(transcript).toContain('[00:02] **Luis**: Buenas');
    expect(calls[0]).toContain('**Ana**: Hola');
    expect(store.files.get('/out/general/summary.md')).toContain('Todo bien.');
    expect(store.discarded.sort()).toEqual(['/w/ana.wav', '/w/luis.wav']);
    expect(notifier.posted).toHaveLength(1);
    expect(notifier.posted[0]!.channelId).toBe('text-1');
    expect(notifier.posted[0]!.result.summary).toContain('Todo bien.');
  });

  it('still saves the transcript and reports when summarization fails', async () => {
    const store = new FakeStore();
    const notifier = new FakeNotifier();
    const r = await processRecording(
      {
        transcriber: transcriber({ '/w/ana.wav': [seg(0, 'Hola')] }),
        summarizer: {
          async summarize() {
            throw new Error('claude exited 1');
          }
        },
        output: store,
        notifier
      },
      input
    );
    expect(store.files.has('/out/general/transcript.md')).toBe(true);
    expect(store.files.has('/out/general/summary.md')).toBe(false);
    expect(r.summary).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/resumen/i);
    expect(r.warnings.join(' ')).not.toContain('claude exited 1');
    expect(notifier.posted[0]!.result.transcriptPath).toBe('/out/general/transcript.md');
  });

  it('keeps raw error details out of chat warnings and sends them to the log', async () => {
    const logged: string[] = [];
    const r = await processRecording(
      {
        transcriber: transcriber({ '/w/ana.wav': new Error('whisper-cli exited with code 1: /Users/secret/path'), '/w/luis.wav': [seg(0, 'Buenas')] }),
        summarizer: okSummarizer(),
        output: new FakeStore(),
        notifier: new FakeNotifier(),
        log: (m, e) => logged.push(`${m} ${e instanceof Error ? e.message : ''}`)
      },
      input
    );
    expect(r.warnings.join(' ')).not.toContain('/Users/secret');
    expect(r.warnings.join(' ')).toContain('Ana');
    expect(logged.join('\n')).toContain('/Users/secret/path');
  });

  it('continues when one speaker fails and keeps that speaker audio', async () => {
    const store = new FakeStore();
    const r = await processRecording(
      { transcriber: transcriber({ '/w/ana.wav': new Error('whisper crashed'), '/w/luis.wav': [seg(0, 'Buenas')] }), summarizer: okSummarizer(), output: store, notifier: new FakeNotifier() },
      input
    );
    expect(store.files.get('/out/general/transcript.md')).toContain('**Luis**: Buenas');
    expect(r.warnings.join(' ')).toContain('Ana');
    expect(store.discarded).toEqual(['/w/luis.wav']);
  });

  it('skips the summary when nobody said anything', async () => {
    const calls: string[] = [];
    const notifier = new FakeNotifier();
    const r = await processRecording(
      { transcriber: transcriber({}), summarizer: okSummarizer(calls), output: new FakeStore(), notifier },
      input
    );
    expect(calls).toHaveLength(0);
    expect(r.summary).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/voz|audio|nada/i);
    expect(notifier.posted).toHaveLength(1);
  });

  it('handles a recording with no tracks at all', async () => {
    const r = await processRecording(
      { transcriber: transcriber({}), summarizer: okSummarizer(), output: new FakeStore(), notifier: new FakeNotifier() },
      { ...input, tracks: [] }
    );
    expect(r.transcriptPath).toBeDefined();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('does not throw when the chat notification fails', async () => {
    const notifier = new FakeNotifier();
    notifier.fail = true;
    const r = await processRecording(
      { transcriber: transcriber({ '/w/ana.wav': [seg(0, 'Hola')] }), summarizer: okSummarizer(), output: new FakeStore(), notifier },
      input
    );
    expect(r.transcriptPath).toBeDefined();
    expect(r.warnings.join(' ')).toMatch(/discord/i);
  });

  it('skips the summary entirely when no summarizer is configured (nothing leaves the machine)', async () => {
    const store = new FakeStore();
    const notifier = new FakeNotifier();
    const r = await processRecording(
      { transcriber: transcriber({ '/w/ana.wav': [seg(0, 'Hola')] }), summarizer: undefined, output: store, notifier },
      input
    );
    expect(r.transcriptPath).toBe('/out/general/transcript.md');
    expect(r.summaryPath).toBeUndefined();
    expect(r.summarySkipped).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(store.files.has('/out/general/summary.md')).toBe(false);
    expect(notifier.posted).toHaveLength(1);
  });
});
