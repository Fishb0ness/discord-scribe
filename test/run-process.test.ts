import { describe, expect, it } from 'vitest';
import { buildKillPlan, killProcessTree, killRunningProcesses, runningProcessCount, runProcess } from '../src/adapters/run-process.js';

describe('runProcess', () => {
  it('collects output and exit code', async () => {
    const r = await runProcess('node', ['-e', 'process.stdout.write("hi")']);
    expect(r).toMatchObject({ stdout: 'hi', code: 0 });
  });

  it('kills the child and rejects when the timeout elapses', async () => {
    const started = Date.now();
    await expect(runProcess('node', ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 100 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('kills every running child on demand', async () => {
    // On Windows the previous test's tree kill (taskkill) is asynchronous: wait until its child has closed.
    const deadline = Date.now() + 5000;
    while (runningProcessCount() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(runningProcessCount()).toBe(0);
    const running = runProcess('node', ['-e', 'setTimeout(() => {}, 30000)']);
    await new Promise((r) => setTimeout(r, 100));
    expect(killRunningProcesses()).toBe(1);
    const r = await running;
    expect(r.code).not.toBe(0);
    expect(killRunningProcesses()).toBe(0);
  });
});

describe('process tree kill', () => {
  it('uses taskkill /T /F without a shell on win32', () => {
    expect(buildKillPlan(1234, 'win32')).toEqual({ command: 'taskkill', args: ['/pid', '1234', '/T', '/F'] });
  });

  it('falls back to a plain kill elsewhere', () => {
    expect(buildKillPlan(1234, 'darwin')).toBeUndefined();
    expect(buildKillPlan(1234, 'linux')).toBeUndefined();
  });

  it('spawns taskkill on win32 with the fake spawner and does not kill directly', () => {
    const calls: unknown[][] = [];
    const killed: string[] = [];
    const spawner = (...a: unknown[]) => {
      calls.push(a);
      return { on: () => undefined };
    };
    killProcessTree({ pid: 42, kill: (s?: string) => killed.push(String(s)) }, 'win32', spawner as never);
    expect(calls[0]!.slice(0, 2)).toEqual(['taskkill', ['/pid', '42', '/T', '/F']]);
    expect(calls[0]![2]).toMatchObject({ stdio: 'ignore', windowsHide: true });
    expect(calls[0]![2]).not.toHaveProperty('shell');
    expect(killed).toEqual([]);
  });

  function fakeTaskkill() {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const proc = {
      on(event: string, cb: (arg?: unknown) => void) {
        handlers[event] = cb;
        return proc;
      }
    };
    return { spawner: () => proc, emit: (event: string, arg?: unknown) => handlers[event]?.(arg) };
  }

  it('kills the child directly when taskkill cannot start', () => {
    const killed: string[] = [];
    const taskkill = fakeTaskkill();
    killProcessTree({ pid: 42, kill: (s?: string) => killed.push(String(s)) }, 'win32', taskkill.spawner as never);
    taskkill.emit('error', new Error('ENOENT'));
    expect(killed).toEqual(['SIGKILL']);
  });

  it('kills the child directly when taskkill exits with a non-zero code', () => {
    const killed: string[] = [];
    const taskkill = fakeTaskkill();
    killProcessTree({ pid: 42, kill: (s?: string) => killed.push(String(s)) }, 'win32', taskkill.spawner as never);
    taskkill.emit('exit', 1);
    expect(killed).toEqual(['SIGKILL']);
  });

  it('does not kill again when taskkill succeeds', () => {
    const killed: string[] = [];
    const taskkill = fakeTaskkill();
    killProcessTree({ pid: 42, kill: (s?: string) => killed.push(String(s)) }, 'win32', taskkill.spawner as never);
    taskkill.emit('exit', 0);
    expect(killed).toEqual([]);
  });

  it('kills the child only once when taskkill both errors and exits', () => {
    const killed: string[] = [];
    const taskkill = fakeTaskkill();
    killProcessTree({ pid: 42, kill: (s?: string) => killed.push(String(s)) }, 'win32', taskkill.spawner as never);
    taskkill.emit('error', new Error('ENOENT'));
    taskkill.emit('exit', 1);
    expect(killed).toEqual(['SIGKILL']);
  });

  it('uses child.kill on non-Windows platforms', () => {
    const killed: string[] = [];
    const spawner = () => {
      throw new Error('must not spawn');
    };
    killProcessTree({ pid: 42, kill: (s?: string) => killed.push(String(s)) }, 'linux', spawner as never);
    expect(killed).toEqual(['SIGKILL']);
  });
});
