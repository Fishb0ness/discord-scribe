import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WavFileWriter } from '../src/adapters/wav-file-writer.js';

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('WavFileWriter', () => {
  it('streams samples and patches the header sizes on close', () => {
    dir = mkdtempSync(join(tmpdir(), 'wav-'));
    const file = join(dir, 't.wav');
    const w = new WavFileWriter(file);
    w.write(Int16Array.from([1, -2, 3]));
    w.write(Int16Array.from([4, 5]));
    w.close();

    const buf = readFileSync(file);
    expect(buf.length).toBe(44 + 10);
    expect(buf.readUInt32LE(40)).toBe(10);
    expect(buf.readUInt32LE(4)).toBe(36 + 10);
    expect(buf.readInt16LE(44)).toBe(1);
    expect(buf.readInt16LE(46)).toBe(-2);
    expect(buf.readInt16LE(52)).toBe(5);
    expect(w.samplesWritten).toBe(5);
  });

  it('produces a valid empty wav when nothing was written', () => {
    dir = mkdtempSync(join(tmpdir(), 'wav-'));
    const file = join(dir, 'e.wav');
    new WavFileWriter(file).close();
    expect(readFileSync(file).length).toBe(44);
  });

  it('close is idempotent', () => {
    dir = mkdtempSync(join(tmpdir(), 'wav-'));
    const w = new WavFileWriter(join(dir, 'i.wav'));
    w.close();
    expect(() => w.close()).not.toThrow();
  });
});
