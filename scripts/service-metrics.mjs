#!/usr/bin/env node
// Resource sampler for the discord-scribe service.
//   node scripts/service-metrics.mjs sample             appends one row to logs/metrics.csv
//   node scripts/service-metrics.mjs summary [--window 24h|7d|90m]
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CSV_HEADER =
  'timestamp_iso,bot_rss_mb,bot_cpu,whisper_rss_mb,whisper_cpu,claude_rss_mb,claude_cpu,bot_running,mem_pressure_free_pct';

const round1 = (n) => Math.round(n * 10) / 10;

/** Parses `ps -axo pid=,ppid=,rss=,pcpu=,command=` output. */
export function parsePs(text) {
  const procs = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+?)\s*$/.exec(line);
    if (m) procs.push({ pid: +m[1], ppid: +m[2], rssKb: +m[3], cpu: +m[4], command: m[5] });
  }
  return procs;
}

/**
 * Splits processes into the bot (matched by project path), and the whisper-cli and claude
 * processes that descend from it, so unrelated interactive sessions are never counted.
 */
export function classify(procs, projectDir) {
  const bot = procs.filter(
    (p) =>
      p.command.includes(`${projectDir}/node_modules/tsx`) ||
      (p.command.includes('src/main.ts') && p.command.includes(projectDir)),
  );
  const children = new Map();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const botPids = new Set(bot.map((p) => p.pid));
  const seen = new Set(botPids);
  const queue = [...botPids];
  const descendants = [];
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      descendants.push(child);
      queue.push(child.pid);
    }
  }
  const named = (name) => descendants.filter((p) => basename(p.command.split(/\s+/)[0]) === name);
  return { bot, whisper: named('whisper-cli'), claude: named('claude') };
}

/** Extracts the free-memory percentage from `memory_pressure -Q`, or null. */
export function memoryFreePct(text) {
  const m = /free percentage:\s*(\d+)%/i.exec(text);
  return m ? +m[1] : null;
}

const sum = (procs, key) => procs.reduce((acc, p) => acc + p[key], 0);

export function buildRow(groups, now, freePct) {
  return {
    timestamp: now.toISOString(),
    botRssMb: round1(sum(groups.bot, 'rssKb') / 1024),
    botCpu: round1(sum(groups.bot, 'cpu')),
    whisperRssMb: round1(sum(groups.whisper, 'rssKb') / 1024),
    whisperCpu: round1(sum(groups.whisper, 'cpu')),
    claudeRssMb: round1(sum(groups.claude, 'rssKb') / 1024),
    claudeCpu: round1(sum(groups.claude, 'cpu')),
    botRunning: groups.bot.length > 0 ? 1 : 0,
    freePct,
  };
}

export function formatRow(r) {
  return [
    r.timestamp,
    r.botRssMb,
    r.botCpu,
    r.whisperRssMb,
    r.whisperCpu,
    r.claudeRssMb,
    r.claudeCpu,
    r.botRunning,
    r.freePct ?? '',
  ].join(',');
}

/** Parses the CSV, skipping the header and malformed lines. */
export function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split(',');
    if (f.length !== 9) continue;
    const time = Date.parse(f[0]);
    const nums = f.slice(1, 8).map(Number);
    if (Number.isNaN(time) || nums.some(Number.isNaN)) continue;
    rows.push({
      time,
      botRssMb: nums[0],
      botCpu: nums[1],
      whisperRssMb: nums[2],
      whisperCpu: nums[3],
      claudeRssMb: nums[4],
      claudeCpu: nums[5],
      botRunning: nums[6],
      freePct: f[8] === '' ? null : Number(f[8]),
    });
  }
  return rows;
}

export function parseWindow(spec) {
  const m = /^(\d+)([mhd])$/.exec(spec);
  if (!m) throw new Error(`Invalid window "${spec}" (use e.g. 90m, 24h, 7d)`);
  return +m[1] * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

/** Summarizes the samples in (now - windowMs, now]; null when there are none. */
export function summarize(rows, windowMs, now) {
  const inWindow = rows.filter((r) => r.time > now - windowMs && r.time <= now);
  if (inWindow.length === 0) return null;
  const running = inWindow.filter((r) => r.botRunning === 1);
  const peak = (key) => Math.max(...inWindow.map((r) => r[key]));
  return {
    samples: inWindow.length,
    uptimePct: round1((running.length / inWindow.length) * 100),
    botAvgMb: running.length ? round1(sum(running, 'botRssMb') / running.length) : 0,
    botPeakMb: peak('botRssMb'),
    botLatestMb: inWindow[inWindow.length - 1].botRssMb,
    whisperPeakMb: peak('whisperRssMb'),
    whisperActive: inWindow.filter((r) => r.whisperRssMb > 0).length,
    claudePeakMb: peak('claudeRssMb'),
  };
}

export function formatSummary(label, s) {
  if (!s) return `Last ${label}: no samples`;
  return [
    `Last ${label}: ${s.samples} samples, uptime ${s.uptimePct}%`,
    `  bot RSS     avg ${s.botAvgMb} MB, peak ${s.botPeakMb} MB, latest ${s.botLatestMb} MB`,
    `  whisper RSS peak ${s.whisperPeakMb} MB (active in ${s.whisperActive} samples)`,
    `  claude RSS  peak ${s.claudePeakMb} MB`,
  ].join('\n');
}

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = join(projectDir, 'logs', 'metrics.csv');

function sample() {
  const ps = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,command='], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let free = null;
  try {
    free = memoryFreePct(execFileSync('memory_pressure', ['-Q'], { encoding: 'utf8' }));
  } catch {
    // memory_pressure is macOS-only; leave the column empty elsewhere.
  }
  const row = buildRow(classify(parsePs(ps), projectDir), new Date(), free);
  mkdirSync(dirname(csvPath), { recursive: true });
  const needsHeader = !existsSync(csvPath) || statSync(csvPath).size === 0;
  appendFileSync(csvPath, `${needsHeader ? `${CSV_HEADER}\n` : ''}${formatRow(row)}\n`);
}

function summary(args) {
  const i = args.indexOf('--window');
  const windows = i >= 0 ? [args[i + 1] ?? ''] : ['24h', '7d'];
  if (!existsSync(csvPath)) {
    console.log(`No metrics yet (${csvPath} does not exist). Install with --metrics or run "sample".`);
    return;
  }
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  if (rows.length === 0) {
    console.log('No metrics yet: logs/metrics.csv has no samples.');
    return;
  }
  const now = Date.now();
  for (const w of windows) console.log(formatSummary(w, summarize(rows, parseWindow(w), now)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'sample') sample();
    else if (cmd === 'summary') summary(rest);
    else {
      console.error('Usage: service-metrics.mjs sample | summary [--window 24h|7d|90m]');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
