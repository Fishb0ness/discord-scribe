import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Client } from '@projectdysnomia/dysnomia';
import type { ChatNotifier, ProcessResult } from '../../app/ports.js';
import { splitMessage } from '../../domain/discord-text.js';

const LIMIT = 2000;

export class DiscordChatNotifier implements ChatNotifier {
  constructor(private readonly client: Client) {}

  async postResult(textChannelId: string, result: ProcessResult): Promise<void> {
    const parts: string[] = [];
    parts.push(`**${result.summarySkipped ? 'Grabación' : 'Resumen de la grabación'} en #${result.channelName}**`);
    if (result.summary) parts.push(result.summary);
    if (result.summarySkipped) parts.push('El resumen está desactivado: se adjunta solo la transcripción.');
    for (const w of result.warnings) parts.push(`⚠️ ${w}`);
    if (!result.summary && !result.summarySkipped && result.warnings.length === 0) parts.push('No hay resumen disponible.');

    const chunks = splitMessage(parts.join('\n\n'), LIMIT);
    const noMentions = { everyone: false, roles: false, users: false } as const;

    // Attach the transcript to the last message so it arrives together with the end of the summary.
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const attachments =
        isLast && result.transcriptPath
          ? [{ filename: basename(result.transcriptPath), file: await readFile(result.transcriptPath) }]
          : undefined;
      await this.client.createMessage(textChannelId, { content: chunks[i]!, allowedMentions: noMentions, attachments });
    }
  }
}
