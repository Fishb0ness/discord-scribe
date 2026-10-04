import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/install-service-macos.sh');
const tmp = mkdtempSync(join(tmpdir(), 'install-service-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function dryRun(args: string[], env: Record<string, string | undefined> = {}): string {
  const full = { ...process.env, ...env };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  return execFileSync('bash', [script, '--dry-run', ...args], {
    env: full as NodeJS.ProcessEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const hasPlutil = spawnSync('plutil', ['-help']).error === undefined;
const lint = (xml: string) => {
  const file = join(tmp, `x-${Math.random().toString(36).slice(2)}.plist`);
  writeFileSync(file, xml);
  return spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
};

describe('install-service-macos.sh --dry-run', () => {
  it('keeps the default LaunchAgent unchanged', () => {
    const out = dryRun([]);
    expect(out).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(out).not.toContain('UserName');
    expect(out).not.toContain('PathState');
    expect(out).not.toContain('CLAUDE_CONFIG_DIR');
  });

  it('keeps LaunchAgent logs in the project', () => {
    const out = dryRun(['--metrics'], { HOME: '/Users/example-user' });
    expect(out).toContain('/logs/discord-scribe.log</string>');
    expect(out).toContain('/logs/metrics.err.log</string>');
    expect(out).not.toContain('/Library/Logs/');
  });

  // launchd opens the log files before exec, and the sandbox denies that on external volumes; a daemon logs to the boot disk.
  it('writes LaunchDaemon logs under ~/Library/Logs with --system', () => {
    const out = dryRun(['--system', '--metrics'], { HOME: '/Users/example-user' });
    expect(out).toContain('<string>/Users/example-user/Library/Logs/discord-scribe/discord-scribe.log</string>');
    expect(out).toContain('<string>/Users/example-user/Library/Logs/discord-scribe/discord-scribe.err.log</string>');
    expect(out).toContain('<string>/Users/example-user/Library/Logs/discord-scribe/metrics.err.log</string>');
    expect(out).not.toMatch(/\/logs\/(discord-scribe|metrics)[.\w]*\.log<\/string>/);
  });

  it('renders a LaunchDaemon with --system', () => {
    const out = dryRun(['--system'], { CLAUDE_CONFIG_DIR: '/Users/example-user/.config/claude-alt' });
    expect(out).toContain('<key>UserName</key>');
    expect(out).toContain('<key>PathState</key>');
    expect(out).toMatch(/PathState<\/key>\s*<dict>\s*<key>[^<]*\/package\.json<\/key>\s*<true\/>/);
    expect(out).not.toContain('<key>KeepAlive</key>\n  <true/>');
    expect(out).toContain('<key>HOME</key>');
    expect(out).toContain('<key>USER</key>');
    expect(out).toContain('<key>CLAUDE_CONFIG_DIR</key>');
    expect(out).toContain('/Users/example-user/.config/claude-alt');
  });

  it('omits CLAUDE_CONFIG_DIR when it is not set', () => {
    const out = dryRun(['--system'], { CLAUDE_CONFIG_DIR: undefined });
    expect(out).not.toContain('CLAUDE_CONFIG_DIR');
  });

  it('adds a metrics job with --metrics', () => {
    const out = dryRun(['--metrics']);
    expect(out.match(/<\?xml/g)).toHaveLength(2);
    expect(out).toContain('.discord-scribe.metrics</string>');
    expect(out).toContain('service-metrics.mjs');
    expect(out).toContain('<key>StartInterval</key>\n  <integer>300</integer>');
    expect(out).toContain('metrics.err.log');
  });

  it('runs the system metrics job as the user', () => {
    const out = dryRun(['--system', '--metrics']);
    const metrics = out.split('<?xml').pop()!;
    expect(metrics).toContain('<key>UserName</key>');
    expect(metrics).not.toContain('KeepAlive');
  });

  it.skipIf(!hasPlutil)('renders valid plists in every mode', () => {
    for (const args of [[], ['--system'], ['--metrics'], ['--system', '--metrics']]) {
      const docs = dryRun(args, { CLAUDE_CONFIG_DIR: '/Users/example-user/.claude' })
        .split('<?xml')
        .filter(Boolean)
        .map((d) => `<?xml${d}`);
      for (const doc of docs) {
        const r = lint(doc);
        expect(r.status, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
      }
    }
  });
});
