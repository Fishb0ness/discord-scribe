import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';

/**
 * Checks a file against its expected size and SHA256 (cheap size check first).
 * @param {string} path
 * @param {{ size: number, sha256: string }} expected
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifyFile(path, expected) {
  let size;
  try {
    size = statSync(path).size;
  } catch (e) {
    return { ok: false, reason: `cannot read file (${e instanceof Error ? e.message : e})` };
  }
  if (size !== expected.size) return { ok: false, reason: `size mismatch (${size} bytes, expected ${expected.size})` };
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const actual = hash.digest('hex');
  if (actual !== expected.sha256) return { ok: false, reason: `SHA256 mismatch (${actual}, expected ${expected.sha256})` };
  return { ok: true };
}
