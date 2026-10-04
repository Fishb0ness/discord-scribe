import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { statSync } from 'node:fs';
import { buildSpawnPlan } from './spawn-plan.js';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const running = new Set<ChildProcess>();

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export interface KillPlan {
  command: string;
  args: string[];
}

/**
 * On Windows a .cmd shim runs under cmd.exe, so killing the child leaves its grandchildren alive:
 * taskkill /T /F ends the whole tree. Elsewhere a plain kill is enough (undefined).
 */
export function buildKillPlan(pid: number, platform: NodeJS.Platform): KillPlan | undefined {
  if (platform !== 'win32') return undefined;
  return { command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
}

interface TaskkillProcess {
  on(event: 'error', cb: () => void): unknown;
  on(event: 'exit', cb: (code: number | null) => void): unknown;
}

type TaskkillSpawner = (command: string, args: string[], options: SpawnOptions) => TaskkillProcess;

/**
 * Kills a child and, on Windows, its whole process tree (taskkill spawned without a shell).
 * If taskkill cannot start or exits non-zero (access denied, pid race), the child is killed directly, once.
 */
export function killProcessTree(
  child: { pid?: number; kill(signal?: NodeJS.Signals): unknown },
  platform: NodeJS.Platform = process.platform,
  spawner: TaskkillSpawner = spawn as TaskkillSpawner
): void {
  const plan = child.pid === undefined ? undefined : buildKillPlan(child.pid, platform);
  if (!plan) {
    child.kill('SIGKILL');
    return;
  }
  let fellBack = false;
  const fallback = (): void => {
    if (fellBack) return;
    fellBack = true;
    child.kill('SIGKILL');
  };
  const taskkill = spawner(plan.command, plan.args, { stdio: 'ignore', windowsHide: true });
  taskkill.on('error', fallback);
  taskkill.on('exit', (code) => {
    if (code !== 0) fallback();
  });
}

/** Kills every child started through runProcess (used when shutting down). Returns how many were killed. */
export function killRunningProcesses(): number {
  const children = [...running];
  for (const child of children) killProcessTree(child);
  return children.length;
}

/** Spawns a process, optionally feeding stdin, and collects output. Rejects only if it cannot start or times out. */
export function runProcess(
  bin: string,
  args: string[],
  opts: { stdin?: string; cwd?: string; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const plan = buildSpawnPlan(bin, args, { platform: process.platform, env: process.env, isFile });
    const child = spawn(plan.command, plan.args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
      windowsHide: true
    });
    running.add(child);
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        killProcessTree(child);
        reject(new Error(`${bin} timed out after ${Math.round(opts.timeoutMs! / 1000)}s`));
      }, opts.timeoutMs);
    }
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (e) => {
      running.delete(child);
      clearTimeout(timer);
      reject(new Error(`Could not start ${bin}: ${e.message}`));
    });
    child.on('close', (code) => {
      running.delete(child);
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(opts.stdin ?? '');
  });
}
