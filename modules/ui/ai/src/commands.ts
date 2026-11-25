export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
}

/** ACP slash commands are ordinary prompt text. The composer offers only a complete leading
 * command token; once arguments start, the provider receives the text unchanged. */
export function slashCommandQuery(draft: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(draft || "");
  return match ? match[1].toLowerCase() : null;
}

export function matchingCommands(commands: unknown, draft: string, limit = 8): AvailableCommand[] {
  const query = slashCommandQuery(draft);
  if (query === null || !Array.isArray(commands)) return [];
  return commands.slice(0, 500).filter((command): command is AvailableCommand => !!command && typeof command === "object"
    && typeof command.name === "string" && /^[^\s/]+$/.test(command.name) && command.name.toLowerCase().startsWith(query))
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

export function applySlashCommand(draft: string, command: AvailableCommand): string {
  const query = slashCommandQuery(draft);
  if (query === null || !/^[^\s/]+$/.test(command.name)) return draft;
  return `/${command.name} `;
}
