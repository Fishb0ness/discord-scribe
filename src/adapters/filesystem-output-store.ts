import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { OutputStore } from '../app/ports.js';
import { recordingDirName } from '../domain/naming.js';

export class FilesystemOutputStore implements OutputStore {
  constructor(private readonly root: string) {}

  async createRecordingDir(startedAt: Date, channelName: string): Promise<string> {
    const base = resolve(this.root, recordingDirName(startedAt, channelName));
    await mkdir(this.root, { recursive: true });
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      try {
        await mkdir(candidate); // fails with EEXIST instead of silently reusing another recording
        return candidate;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }

  async writeFile(dir: string, name: string, content: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, content, 'utf8');
    return path;
  }

  async discardAudio(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => rm(p, { force: true })));
  }
}
