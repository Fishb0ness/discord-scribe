import { win32 } from 'node:path';

export interface SpawnPlan {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

export interface SpawnContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  isFile: (path: string) => boolean;
}

// cmd.exe metacharacters (same set cross-spawn escapes).
const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Escapes one argument for a command line that cmd.exe will parse and then hand to a program using the
 * Microsoft CRT rules (algorithm from https://qntm.org/cmd). Line breaks become spaces because cmd.exe cannot
 * carry them; a NUL byte is refused. `doubleEscape` is for `.cmd`/`.bat` targets, which pass through cmd twice.
 */
export function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
  if (arg.includes('\0')) throw new Error('A NUL byte cannot be passed on a command line');
  let out = arg.replace(/\r\n|\r|\n/g, ' ');
  out = out.replace(/(\\*)"/g, '$1$1\\"'); // backslashes before a quote are doubled, the quote is escaped
  out = out.replace(/(\\*)$/, '$1$1'); // trailing backslashes would otherwise escape the closing quote
  out = `"${out}"`.replace(META_CHARS, '^$1');
  return doubleEscape ? out.replace(META_CHARS, '^$1') : out;
}

function resolveOnPath(bin: string, ctx: SpawnContext): string | undefined {
  if (/[\\/:]/.test(bin)) return undefined; // already a path: use as given
  const exts = (ctx.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasKnownExt = exts.some((e) => bin.toUpperCase().endsWith(e.toUpperCase()));
  const names = hasKnownExt ? [bin] : exts.map((e) => bin + e);
  for (const dir of (ctx.env.PATH ?? ctx.env.Path ?? '').split(';').filter(Boolean)) {
    for (const name of names) {
      const candidate = win32.join(dir, name);
      if (ctx.isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Works out how to start `bin` without a shell where possible. On Windows, CLIs installed through npm are
 * `.cmd` shims, which Node refuses to spawn directly (CVE-2024-27980); those go through cmd.exe with every
 * argument escaped. Real executables are spawned directly with an args array.
 */
export function buildSpawnPlan(bin: string, args: string[], ctx: SpawnContext): SpawnPlan {
  const direct: SpawnPlan = { command: bin, args, windowsVerbatimArguments: false };
  if (ctx.platform !== 'win32') return direct;

  const resolved = resolveOnPath(bin, ctx) ?? bin;
  if (!/\.(cmd|bat)$/i.test(resolved)) return { ...direct, command: resolved };

  // Every .cmd/.bat target is parsed by cmd.exe twice (the shim re-invokes its program), so always double escape.
  const doubleEscape = true;
  const command = win32.normalize(resolved).replace(META_CHARS, '^$1');
  const line = [command, ...args.map((a) => escapeCmdArgument(a, doubleEscape))].join(' ');
  return {
    command: ctx.env.ComSpec ?? ctx.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true
  };
}
