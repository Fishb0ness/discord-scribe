import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyFile } from '../scripts/model-verify.mjs';

const dir = mkdtempSync(join(tmpdir(), 'model-verify-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const content = 'small fake model';
const sha256 = createHash('sha256').update(content).digest('hex');
const file = join(dir, 'a.bin');
writeFileSync(file, content);

describe('verifyFile', () => {
  it('accepts a file with the expected size and hash', async () => {
    expect(await verifyFile(file, { size: content.length, sha256 })).toEqual({ ok: true });
  });

  it('rejects a wrong size without needing the hash', async () => {
    const r = await verifyFile(file, { size: content.length + 1, sha256 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/size/);
  });

  it('rejects a wrong hash', async () => {
    const r = await verifyFile(file, { size: content.length, sha256: 'a'.repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/SHA256/);
  });

  it('reports a missing file', async () => {
    const r = await verifyFile(join(dir, 'nope.bin'), { size: 1, sha256 });
    expect(r.ok).toBe(false);
  });
});
