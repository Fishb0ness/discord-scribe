// Downloads the Whisper large-v3 model and the Silero VAD model into models/ (cross-platform, no dependencies).
// Usage: npm run download-models [-- --turbo] [-- --force]
//   --turbo  also fetch the faster, less accurate large-v3-turbo
//   --force  redownload files even if they are already present and valid
// Every file is pinned to a Hugging Face commit and verified against its expected size and SHA256.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { verifyFile } from './model-verify.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = join(root, 'models');

// Hugging Face commits (revision/main at 2026-10-04); sizes and SHA256 are the LFS values reported by the HF API.
const WHISPER_COMMIT = '5359861c739e955e79d9a303bcbc70fb988958b1';
const VAD_COMMIT = '9ffd54a1e1ee413ddf265af9913beaf518d1639b';

const models = [
  {
    file: 'ggml-large-v3.bin',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_COMMIT}/ggml-large-v3.bin`,
    size: 3095033483,
    sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
  },
  {
    file: 'ggml-silero-v5.1.2.bin',
    url: `https://huggingface.co/ggml-org/whisper-vad/resolve/${VAD_COMMIT}/ggml-silero-v5.1.2.bin`,
    size: 885098,
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf'
  }
];
if (process.argv.includes('--turbo')) {
  models.push({
    file: 'ggml-large-v3-turbo.bin',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_COMMIT}/ggml-large-v3-turbo.bin`,
    size: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'
  });
}
const force = process.argv.includes('--force');

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);

async function download(model) {
  const { file, url, size } = model;
  const target = join(dir, file);
  if (existsSync(target) && !force) {
    const check = await verifyFile(target, model);
    if (check.ok) {
      console.log(`${file}: already present and verified, skipping`);
      return;
    }
    throw new Error(`${file}: existing file is invalid: ${check.reason}. Delete it or rerun with --force to download it again.`);
  }
  const part = `${target}.part`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${file}: HTTP ${res.status} from ${url}`);
    let received = 0;
    let lastPrint = 0;
    const source = Readable.fromWeb(res.body);
    source.on('data', (chunk) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastPrint > 500) {
        lastPrint = now;
        process.stdout.write(`\r${file}: ${mb(received)} / ${mb(size)} MB (${Math.floor((received / size) * 100)}%)   `);
      }
    });
    await pipeline(source, createWriteStream(part));
    if (received !== size) throw new Error(`${file}: incomplete or oversized download (${received} of ${size} bytes)`);
    const check = await verifyFile(part, model);
    if (!check.ok) throw new Error(`${file}: integrity check failed: ${check.reason}. The download was discarded.`);
    renameSync(part, target); // only a complete, verified file ever gets the final name
    process.stdout.write(`\r${file}: done and verified (${mb(received)} MB)                    \n`);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
}

mkdirSync(dir, { recursive: true });
try {
  for (const model of models) await download(model);
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
