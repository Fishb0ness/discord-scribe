export interface SpeakerIdentity {
  userId: string;
  name: string;
}

/** Maps userId -> display name, appending " (n)" to later duplicates so transcript labels stay distinct. */
export function uniqueSpeakerNames(speakers: SpeakerIdentity[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const s of speakers) {
    const base = s.name.trim() === '' ? `Usuario ${s.userId}` : s.name.trim();
    const key = base.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(s.userId, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}
