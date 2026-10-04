export interface PacketGuardOptions {
  /** Consecutive failures after which the guard gives up (and stops calling the handler). */
  maxConsecutiveFailures: number;
  onError: (error: unknown) => void;
  onGiveUp: () => void;
}

/**
 * Wraps a packet handler so a throwing handler (e.g. a filesystem error) never escapes into the
 * voice event emitter. A success resets the failure count; persistent failure gives up exactly once.
 */
export function createPacketGuard<A extends unknown[]>(handler: (...args: A) => void, opts: PacketGuardOptions): (...args: A) => void {
  let failures = 0;
  let gaveUp = false;
  return (...args) => {
    if (gaveUp) return;
    try {
      handler(...args);
      failures = 0;
    } catch (e) {
      failures++;
      opts.onError(e);
      if (failures >= opts.maxConsecutiveFailures) {
        gaveUp = true;
        opts.onGiveUp();
      }
    }
  };
}
