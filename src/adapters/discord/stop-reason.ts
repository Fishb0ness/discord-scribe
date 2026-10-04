export type StopReason = 'user' | 'empty' | 'disconnected' | 'moved' | 'encryption' | 'no-audio' | 'error' | 'storage' | 'shutdown';

/** How long the recording may go without a single accepted audio packet before it stops itself. */
export const NO_AUDIO_TIMEOUT_MS = 5 * 60 * 1000;

const MESSAGES: Record<Exclude<StopReason, 'no-audio'>, string> = {
  user: 'Grabación detenida.',
  empty: 'El canal se quedó vacío, así que he detenido la grabación.',
  disconnected: 'Me han desconectado del canal de voz, así que he detenido la grabación con lo que tenía.',
  moved: 'Me han movido a otro canal, así que he detenido la grabación.',
  encryption:
    'Por problemas con el cifrado de voz no he podido oír a nadie. Cambia la región del canal de voz e inténtalo de nuevo. Detengo la grabación.',
  error: 'Perdí la conexión de voz y no pude recuperarla, así que he detenido la grabación con lo que tenía.',
  storage: 'No he podido escribir el audio en disco, así que he detenido la grabación con lo que tenía.',
  shutdown: 'El bot se está apagando, así que he detenido la grabación. Intentaré procesarla antes de cerrar.'
};

/** User-facing (Spanish) explanation of why a recording ended. */
export function stopMessage(reason: StopReason): string {
  if (reason === 'no-audio') {
    return `No he recibido audio de nadie en ${Math.round(NO_AUDIO_TIMEOUT_MS / 60000)} minutos, así que he detenido la grabación.`;
  }
  return MESSAGES[reason];
}
