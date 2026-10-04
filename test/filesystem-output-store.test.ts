import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesystemOutputStore } from '../src/adapters/filesystem-output-store.js';

let root: string;
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

describe('FilesystemOutputStore', () => {
  it('creates a timestamped directory, never reusing an existing one', async () => {
    root = mkdtempSync(join(tmpdir(), 'out-'));
    const store = new FilesystemOutputStore(root);
    const d = new Date(2026, 9, 4, 9, 30);
    const a = await store.createRecordingDir(d, 'General');
    const b = await store.createRecordingDir(d, 'General');
    expect(basename(a)).toBe('2026-10-04_0930-general');
    expect(basename(b)).toBe('2026-10-04_0930-general-2');
  });

  it('writes files and discards audio', async () => {
    root = mkdtempSync(join(tmpdir(), 'out-'));
    const store = new FilesystemOutputStore(root);
    const dir = await store.createRecordingDir(new Date(), 'x');
    const p = await store.writeFile(dir, 'transcript.md', 'hola');
    expect(readFileSync(p, 'utf8')).toBe('hola');
    const wav = join(root, 'a.wav');
    writeFileSync(wav, 'x');
    await store.discardAudio([wav, join(root, 'missing.wav')]);
    expect(existsSync(wav)).toBe(false);
  });
});
