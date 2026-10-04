export interface Expected {
  size: number;
  sha256: string;
}
export function verifyFile(path: string, expected: Expected): Promise<{ ok: boolean; reason?: string }>;
