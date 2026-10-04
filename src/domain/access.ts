/** Whether an interaction coming from `guildId` (undefined for DMs) may use the bot. */
export function isGuildAllowed(allowed: readonly string[], guildId: string | undefined): boolean {
  return guildId !== undefined && allowed.includes(guildId);
}

/** Guilds the bot is a member of that are not on the allow list. */
export function guildsToLeave(allowed: readonly string[], memberOf: Iterable<string>): string[] {
  return [...memberOf].filter((id) => !allowed.includes(id));
}
