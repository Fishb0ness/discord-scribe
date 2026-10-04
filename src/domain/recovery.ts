import { isOpusSilence } from './rtp.js';

/**
 * Counts DAVE "Invalidating transition" warnings that arrive without any real audio in between.
 * Once `threshold` is reached the recording cannot hear anyone and should be stopped (Craig uses 5).
 */
export class EncryptionRecoveryMonitor {
  private attempts = 0;
  private fired = false;

  constructor(private readonly threshold = 5) {}

  /** Returns true exactly once, when the threshold is crossed. */
  onWarning(message: string): boolean {
    if (this.fired || !message.startsWith('Invalidating transition ')) return false;
    this.attempts++;
    if (this.attempts < this.threshold) return false;
    this.fired = true;
    return true;
  }

  onAudio(payload: Buffer): void {
    if (payload.length > 0 && !isOpusSilence(payload)) this.attempts = 0;
  }
}

export async function retry<T>(attempts: number, fn: (attempt: number) => Promise<T>, wait: () => Promise<void>): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i < attempts) await wait();
    }
  }
  throw last;
}
