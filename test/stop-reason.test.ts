import { describe, expect, it } from 'vitest';
import { NO_AUDIO_TIMEOUT_MS, stopMessage } from '../src/adapters/discord/stop-reason.js';

describe('stopMessage', () => {
  it('derives the no-audio minutes from the timeout constant', () => {
    expect(stopMessage('no-audio')).toContain(`${NO_AUDIO_TIMEOUT_MS / 60000} minutos`);
  });
  it('has a Spanish message for every reason', () => {
    for (const r of ['user', 'empty', 'disconnected', 'moved', 'encryption', 'no-audio', 'error', 'storage', 'shutdown'] as const) {
      expect(stopMessage(r).length).toBeGreaterThan(10);
    }
  });
});
