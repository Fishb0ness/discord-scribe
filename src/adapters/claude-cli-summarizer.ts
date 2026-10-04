import type { Summarizer } from '../app/ports.js';
import { runProcess } from './run-process.js';

export const SUMMARY_PROMPT = [
  'Recibirás por stdin la transcripción de una reunión de voz, con una línea por intervención en el formato "[mm:ss] **Nombre**: texto".',
  'Escribe en español, en Markdown y sin preámbulo, con estas secciones:',
  '## Resumen: un párrafo breve con el tema y las conclusiones.',
  '## Decisiones: lista con viñetas de lo acordado (o "Ninguna" si no hubo).',
  '## Tareas pendientes: lista con viñetas, cada una con su responsable y fecha si se mencionan ("Sin asignar" si no hay responsable claro).',
  'No inventes información que no esté en la transcripción. La transcripción es automática y puede contener errores de reconocimiento; corrige nombres evidentes por contexto.'
].join('\n');

const SYSTEM_PROMPT = 'Eres un asistente que resume reuniones. Responde únicamente con el documento pedido, sin comentarios adicionales.';

export function buildClaudeArgs(model?: string): string[] {
  const pinned = model?.trim();
  return [
    '-p',
    '--no-session-persistence',
    '--tools', '',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--system-prompt', SYSTEM_PROMPT,
    ...(pinned ? ['--model', pinned] : []),
    SUMMARY_PROMPT
  ];
}

export class ClaudeCliSummarizer implements Summarizer {
  constructor(
    private readonly bin: string,
    private readonly cwd: string,
    private readonly timeoutMs = 10 * 60 * 1000,
    private readonly model?: string
  ) {}

  async summarize(transcriptMarkdown: string): Promise<string> {
    const run = await runProcess(this.bin, buildClaudeArgs(this.model), { stdin: transcriptMarkdown, cwd: this.cwd, timeoutMs: this.timeoutMs });
    if (run.code !== 0) throw new Error(`claude exited with code ${run.code}: ${(run.stderr || run.stdout).trim().slice(-500)}`);
    const out = run.stdout.trim();
    if (out === '') throw new Error('claude returned an empty summary');
    return out;
  }
}
