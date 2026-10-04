import { mkdtemp, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/adapters/run-process.js', () => ({ runProcess: vi.fn() }));
import { runProcess } from '../src/adapters/run-process.js';
import { WhisperCliTranscriber, whisperTimeoutMs } from '../src/adapters/whisper-cli-transcriber.js';

const options = { bin: 'whisper-cli', model: 'm', vadModel: undefined, language: 'es', prompt: '', beamSize: 5 };

describe('WhisperCliTranscriber.transcribe', () => {
  let dir: string;
  let wav: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scribe-whisper-'));
    wav = join(dir, 'a.wav');
    // The timeout is derived from the file size: extend a file to the size of 300 s of 16 kHz mono 16-bit audio
    // without writing real samples. 3 x 300 s = 15 min, which tells max(10 min, 3x) apart from a 10 min constant.
    await writeFile(wav, '');
    await truncate(wav, 44 + 32000 * 300);
    vi.mocked(runProcess).mockReset();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('derives timeoutMs from the WAV size and passes it to runProcess', async () => {
    vi.mocked(runProcess).mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    await writeFile(join(dir, 'a.json'), JSON.stringify({ transcription: [] }));
    await new WhisperCliTranscriber(options).transcribe(wav);
    const passed = vi.mocked(runProcess).mock.calls[0]![2];
    expect(passed?.timeoutMs).toBe(whisperTimeoutMs(300));
    expect(passed?.timeoutMs).toBe(15 * 60 * 1000);
  });

  it('keeps the WAV when whisper times out', async () => {
    vi.mocked(runProcess).mockRejectedValue(new Error('timed out'));
    await expect(new WhisperCliTranscriber(options).transcribe(wav)).rejects.toThrow(/timed out/);
    await expect(stat(wav)).resolves.toBeDefined();
  });
});
