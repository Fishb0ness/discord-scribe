import { closeSync, openSync, writeSync } from 'node:fs';
import { wavHeader } from '../domain/wav.js';

/** Appends 16 kHz mono PCM to a WAV file and patches the header sizes on close. */
export class WavFileWriter {
  private fd: number | null;
  private bytes = 0;

  constructor(readonly path: string) {
    this.fd = openSync(path, 'w');
    writeSync(this.fd, wavHeader(0));
  }

  get samplesWritten(): number {
    return this.bytes / 2;
  }

  write(pcm: Int16Array): void {
    if (this.fd === null || pcm.length === 0) return;
    const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    writeSync(this.fd, buf);
    this.bytes += buf.length;
  }

  close(): void {
    if (this.fd === null) return;
    writeSync(this.fd, wavHeader(this.bytes), 0, 44, 0);
    closeSync(this.fd);
    this.fd = null;
  }
}
