import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  buildRow,
  classify,
  formatRow,
  memoryFreePct,
  parseCsv,
  parsePs,
  parseWindow,
  summarize,
} from '../scripts/service-metrics.mjs';

const PROJECT = '/Users/example-user/projects/discord-scribe';
const PS = `
  100     1  51200   1.5 /usr/local/bin/node ${PROJECT}/node_modules/tsx/dist/cli.mjs src/main.ts
  101   100 204800   3.0 /usr/local/bin/node --require ${PROJECT}/node_modules/tsx/dist/preflight.cjs src/main.ts
  102   101  10240   0.5 /usr/bin/caffeinate -i
  103   101 409600  80.0 /opt/homebrew/bin/whisper-cli -m model.bin -f a.wav
  104   101 102400   4.0 /Users/example-user/.local/bin/claude -p summarize
  200     1 999999   9.0 /Users/example-user/.local/bin/claude
  201     1  30000   2.0 /opt/homebrew/bin/whisper-cli -m other.bin
  300     1   1000   0.0 vim ${PROJECT}/README.md
`;

describe('parsePs', () => {
  it('parses pid, ppid, rss, cpu and the full command', () => {
    const procs = parsePs(PS);
    expect(procs).toHaveLength(8);
    expect(procs[0]).toEqual({
      pid: 100,
      ppid: 1,
      rssKb: 51200,
      cpu: 1.5,
      command: `/usr/local/bin/node ${PROJECT}/node_modules/tsx/dist/cli.mjs src/main.ts`,
    });
  });

  it('ignores blank and malformed lines', () => {
    expect(parsePs('\nnot a row\n  5 1 10 0.0 x\n')).toHaveLength(1);
  });
});

describe('classify', () => {
  const groups = classify(parsePs(PS), PROJECT);
  it('finds the bot processes by project path', () => {
    expect(groups.bot.map((p) => p.pid)).toEqual([100, 101]);
  });
  it('counts whisper-cli only under the bot', () => {
    expect(groups.whisper.map((p) => p.pid)).toEqual([103]);
  });
  it('excludes claude sessions that are not descendants of the bot', () => {
    expect(groups.claude.map((p) => p.pid)).toEqual([104]);
  });
  it('reports nothing when the bot is not running', () => {
    const g = classify(parsePs('200 1 100 1.0 /x/claude\n201 1 100 1.0 /x/whisper-cli'), PROJECT);
    expect(g).toEqual({ bot: [], whisper: [], claude: [] });
  });
});

describe('memoryFreePct', () => {
  it('parses memory_pressure -Q output', () => {
    expect(memoryFreePct('System-wide memory free percentage: 41%\n')).toBe(41);
  });
  it('returns null when unparseable', () => {
    expect(memoryFreePct('garbage')).toBeNull();
    expect(memoryFreePct('')).toBeNull();
  });
});

describe('buildRow / formatRow', () => {
  const now = new Date('2026-10-04T12:00:00.000Z');
  it('sums RSS (KB to MB) and CPU per group', () => {
    const row = buildRow(classify(parsePs(PS), PROJECT), now, 41);
    expect(row).toEqual({
      timestamp: '2026-10-04T12:00:00.000Z',
      botRssMb: 250,
      botCpu: 3.0 + 1.5,
      whisperRssMb: 400,
      whisperCpu: 80,
      claudeRssMb: 100,
      claudeCpu: 4,
      botRunning: 1,
      freePct: 41,
    });
    expect(formatRow(row)).toBe('2026-10-04T12:00:00.000Z,250,4.5,400,80,100,4,1,41');
  });
  it('leaves free memory empty when unknown and flags a stopped bot', () => {
    const row = buildRow({ bot: [], whisper: [], claude: [] }, now, null);
    expect(formatRow(row)).toBe('2026-10-04T12:00:00.000Z,0,0,0,0,0,0,0,');
  });
  it('has a fixed header', () => {
    expect(CSV_HEADER).toBe(
      'timestamp_iso,bot_rss_mb,bot_cpu,whisper_rss_mb,whisper_cpu,claude_rss_mb,claude_cpu,bot_running,mem_pressure_free_pct',
    );
  });
});

describe('parseCsv', () => {
  it('round-trips rows and skips the header and bad lines', () => {
    const text = `${CSV_HEADER}\n2026-10-04T12:00:00.000Z,250,4.5,400,80,100,4,1,41\nbroken\n2026-10-04T12:05:00.000Z,0,0,0,0,0,0,0,\n`;
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ botRssMb: 250, whisperRssMb: 400, botRunning: 1, freePct: 41 });
    expect(rows[1]).toMatchObject({ botRunning: 0, freePct: null });
    expect(rows[0]!.time).toBe(Date.parse('2026-10-04T12:00:00.000Z'));
  });
  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseWindow', () => {
  it('understands m, h and d', () => {
    expect(parseWindow('90m')).toBe(90 * 60_000);
    expect(parseWindow('24h')).toBe(24 * 3_600_000);
    expect(parseWindow('7d')).toBe(7 * 86_400_000);
  });
  it('rejects anything else', () => {
    expect(() => parseWindow('soon')).toThrow(/window/i);
  });
});

describe('summarize', () => {
  const now = Date.parse('2026-10-04T12:00:00.000Z');
  const mk = (minsAgo: number, bot: number, whisper: number, claude: number, running = 1) =>
    ({
      time: now - minsAgo * 60_000,
      botRssMb: bot,
      botCpu: 0,
      whisperRssMb: whisper,
      whisperCpu: 0,
      claudeRssMb: claude,
      claudeCpu: 0,
      botRunning: running,
      freePct: null,
    }) as const;
  const rows = [mk(2 * 24 * 60, 900, 0, 0), mk(60, 200, 0, 0), mk(30, 300, 500, 150), mk(5, 100, 0, 0, 0), mk(1, 400, 0, 0)];

  it('only counts samples inside the window', () => {
    expect(summarize(rows, 24 * 3_600_000, now)!.samples).toBe(4);
    expect(summarize(rows, 7 * 86_400_000, now)!.samples).toBe(5);
  });
  it('computes uptime, bot rss average over running samples, peaks and latest', () => {
    const s = summarize(rows, 24 * 3_600_000, now)!;
    expect(s.uptimePct).toBe(75);
    expect(s.botAvgMb).toBe(300);
    expect(s.botPeakMb).toBe(400);
    expect(s.botLatestMb).toBe(400);
    expect(s.whisperPeakMb).toBe(500);
    expect(s.whisperActive).toBe(1);
    expect(s.claudePeakMb).toBe(150);
  });
  it('returns null when the window has no samples', () => {
    expect(summarize([], 3_600_000, now)).toBeNull();
  });
});
