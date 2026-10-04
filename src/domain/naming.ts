export function slugify(name: string, maxLength = 40): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug === '' ? 'canal' : slug;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:mm` in local time, for document headers. */
export function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `<YYYY-MM-DD_HHmm>-<channel-slug>` in local time. */
export function recordingDirName(startedAt: Date, channelName: string): string {
  const date = `${startedAt.getFullYear()}-${pad2(startedAt.getMonth() + 1)}-${pad2(startedAt.getDate())}`;
  const time = `${pad2(startedAt.getHours())}${pad2(startedAt.getMinutes())}`;
  return `${date}_${time}-${slugify(channelName)}`;
}
