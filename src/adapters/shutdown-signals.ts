/** Signals that trigger a graceful shutdown. SIGBREAK is what Windows sends on Ctrl+Break / console close. */
export function shutdownSignals(platform: NodeJS.Platform): NodeJS.Signals[] {
  return platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
}
