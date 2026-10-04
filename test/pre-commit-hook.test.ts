import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const hook = resolve('.githooks/pre-commit');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

// The hook is POSIX sh; on Windows it runs under Git Bash, which this test does not exercise.
describe.skipIf(process.platform === 'win32')('pre-commit hook', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'hook-'));
    git(repo, 'init', '-q');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  // PATH without gitleaks so only the .env guard is exercised, deterministically.
  const run = () => spawnSync('sh', [hook], { cwd: repo, encoding: 'utf8', env: { ...process.env, SCRIBE_SKIP_GITLEAKS: '1' } });
  const stage = (name: string) => {
    mkdirSync(join(repo, name, '..'), { recursive: true });
    writeFileSync(join(repo, name), 'X=1\n');
    git(repo, 'add', '-f', name);
  };

  it.each(['.env', '.env.local', '.env.test-leak', 'sub/.env', 'sub/.env.production'])('refuses a staged %s', (name) => {
    stage(name);
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/\.env/);
  });

  it('allows .env.example and ordinary files', () => {
    stage('.env.example');
    stage('src/app.ts');
    stage('environment.md');
    expect(run().status).toBe(0);
  });
});
