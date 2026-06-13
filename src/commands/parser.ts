// ---------------------------------------------------------------------------
// Slash command parser
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  command: string;
  args: string;
  raw: string;
}

const COMMAND_RE = /^\/([a-zA-Z_]+)\s*(.*)$/s;

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  const match = trimmed.match(COMMAND_RE);
  if (!match) return null;

  return {
    command: match[1]!.toLowerCase(),
    args: match[2]?.trim() ?? "",
    raw: trimmed,
  };
}

export function isSlashCommand(text: string): boolean {
  return /^\//.test(text.trim());
}

export function getCommandHelp(): string {
  return [
    "📋 Available Commands:",
    "",
    "/help             — Show this help",
    "/new [name]       — Start a new conversation session",
    "/list             — List all sessions",
    "/switch <id>      — Switch to a different session",
    "/current          — Show current session status",
    "/clear            — Clear current conversation context",
    "/delete <id>      — Delete a session",
    "/mode [mode]      — View or set permission mode (default|accept_edits|yolo)",
    "/allow <tool>     — Pre-approve a specific tool",
    "/dir [path]       — Show or change working directory",
    "/stop             — Stop current operation",
    "/status           — Show bot status",
    "/model [name]     — View or change AI model",
    "/usage            — Show configuration summary",
    "/memory [text]    — Read or update bot instructions",
    "/cron [schedule]  — Create a scheduled task",
  ].join("\n");
}
