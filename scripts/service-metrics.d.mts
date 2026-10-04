export interface Proc {
  pid: number;
  ppid: number;
  rssKb: number;
  cpu: number;
  command: string;
}
export interface Groups {
  bot: Proc[];
  whisper: Proc[];
  claude: Proc[];
}
export interface Row {
  timestamp: string;
  botRssMb: number;
  botCpu: number;
  whisperRssMb: number;
  whisperCpu: number;
  claudeRssMb: number;
  claudeCpu: number;
  botRunning: number;
  freePct: number | null;
}
export interface Sample extends Omit<Row, 'timestamp'> {
  time: number;
}
export interface Summary {
  samples: number;
  uptimePct: number;
  botAvgMb: number;
  botPeakMb: number;
  botLatestMb: number;
  whisperPeakMb: number;
  whisperActive: number;
  claudePeakMb: number;
}
export const CSV_HEADER: string;
export function parsePs(text: string): Proc[];
export function classify(procs: Proc[], projectDir: string): Groups;
export function memoryFreePct(text: string): number | null;
export function buildRow(groups: Groups, now: Date, freePct: number | null): Row;
export function formatRow(row: Row): string;
export function parseCsv(text: string): Sample[];
export function parseWindow(spec: string): number;
export function summarize(rows: Sample[], windowMs: number, now: number): Summary | null;
export function formatSummary(label: string, s: Summary | null): string;
