export const RECORDING_PREFIX = '[GRABANDO]';
const MAX_NICK = 32;

/** Nickname shown while recording, e.g. "[GRABANDO] Scribe", trimmed to Discord's 32 character limit. */
export function withRecordingIndicator(base: string): string {
  const clean = withoutRecordingIndicator(base) ?? '';
  return `${RECORDING_PREFIX} ${clean}`.trimEnd().slice(0, MAX_NICK).trimEnd();
}

/** Returns the nickname without the indicator, or null when nothing else is left (use the default name). */
export function withoutRecordingIndicator(nick: string | null | undefined): string | null {
  if (nick == null) return null;
  if (!nick.startsWith(RECORDING_PREFIX)) return nick;
  const rest = nick.slice(RECORDING_PREFIX.length).trim();
  return rest === '' ? null : rest;
}

/** What to do about a nickname left over from a crashed recording: undefined = leave it, otherwise the nick to set. */
export function staleIndicatorFix(nick: string | null | undefined): { nick: string | null } | undefined {
  if (!nick?.startsWith(RECORDING_PREFIX)) return undefined;
  return { nick: withoutRecordingIndicator(nick) };
}
