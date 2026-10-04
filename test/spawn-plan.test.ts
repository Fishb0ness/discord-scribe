import { describe, expect, it } from 'vitest';
import { buildSpawnPlan, escapeCmdArgument } from '../src/adapters/spawn-plan.js';
import { shutdownSignals } from '../src/adapters/shutdown-signals.js';

const win = (files: string[], env: Record<string, string> = {}) => ({
  platform: 'win32' as const,
  env: { PATH: 'C:\\Tools;C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe', ...env },
  isFile: (p: string) => files.includes(p)
});

describe('buildSpawnPlan', () => {
  it('passes the command and args through untouched outside Windows', () => {
    const plan = buildSpawnPlan('claude', ['-p', 'hola mundo'], { platform: 'linux', env: {}, isFile: () => false });
    expect(plan).toEqual({ command: 'claude', args: ['-p', 'hola mundo'], windowsVerbatimArguments: false });
  });

  it('spawns a resolved .exe directly with the args array (no shell)', () => {
    const plan = buildSpawnPlan('claude', ['-p', 'qué tal'], win(['C:\\Tools\\claude.EXE']));
    expect(plan).toEqual({ command: 'C:\\Tools\\claude.EXE', args: ['-p', 'qué tal'], windowsVerbatimArguments: false });
  });

  it('leaves an unresolvable command alone so spawn reports ENOENT', () => {
    expect(buildSpawnPlan('claude', ['x'], win([])).command).toBe('claude');
  });

  it('does not resolve a command that already has a path', () => {
    const plan = buildSpawnPlan('D:\\bin\\whisper-cli.exe', ['a'], win([]));
    expect(plan.command).toBe('D:\\bin\\whisper-cli.exe');
  });

  it('runs a .cmd shim through cmd.exe with every argument escaped', () => {
    const plan = buildSpawnPlan(
      'claude',
      ['-p', 'Resumen: línea uno\nlínea "dos" & calc'],
      win(['C:\\Users\\u\\AppData\\Roaming\\npm\\claude.CMD'])
    );
    expect(plan.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const line = plan.args[3]!;
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain('línea');
    expect(line).toContain('^&'); // the ampersand cannot start a second command
    expect(line).not.toMatch(/(?<!\^)&/);
    expect(line).toContain('claude.CMD');
  });
});

describe('buildSpawnPlan double escaping', () => {
  it('double-escapes arguments for a global npm shim outside node_modules', () => {
    const shim = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';
    const plan = buildSpawnPlan(shim, ['"&calc&"'], win([shim]));
    const line = plan.args[3]!;
    expect(line).toContain('^^^&calc^^^&');
    expect(line).not.toMatch(/(?<!\^\^\^)&/); // every ampersand carries three carets
  });

  it('double-escapes any .bat target too', () => {
    const plan = buildSpawnPlan('D:\\tools\\run.bat', ['a&b'], win([]));
    expect(plan.args[3]).toContain('^^^&');
  });
});

describe('escapeCmdArgument', () => {
  it('wraps in quotes and caret-escapes cmd metacharacters', () => {
    expect(escapeCmdArgument('a b', false)).toBe('^"a^ b^"');
    expect(escapeCmdArgument('x|y', false)).toBe('^"x^|y^"');
  });

  it('escapes embedded quotes and trailing backslashes for the CRT parser', () => {
    expect(escapeCmdArgument('say "hi"', false)).toBe('^"say^ \\^"hi\\^"^"');
    expect(escapeCmdArgument('C:\\dir\\', false)).toBe('^"C:\\dir\\\\^"');
  });

  it('refuses a NUL byte and flattens line breaks', () => {
    expect(() => escapeCmdArgument('a\0b', false)).toThrow(/NUL/);
    expect(escapeCmdArgument('a\r\nb', false)).toBe('^"a^ b^"');
  });
});

describe('shutdownSignals', () => {
  it('handles SIGINT and SIGTERM everywhere and SIGBREAK on Windows', () => {
    expect(shutdownSignals('linux')).toEqual(['SIGINT', 'SIGTERM']);
    expect(shutdownSignals('darwin')).toEqual(['SIGINT', 'SIGTERM']);
    expect(shutdownSignals('win32')).toEqual(['SIGINT', 'SIGTERM', 'SIGBREAK']);
  });
});
