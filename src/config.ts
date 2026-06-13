import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotConfig {
  /** Anthropic-compatible API base URL */
  baseUrl: string;
  /** API auth token */
  authToken: string;
  /** Primary model for heavy reasoning and tool use */
  model: string;
  /** Fast model for lightweight tasks */
  fastModel: string;
  /** Bot working directory (defaults to os.homedir()) */
  workDir: string;
  /** Permission mode: "default" | "accept_edits" | "yolo" */
  permissionMode: "default" | "accept_edits" | "yolo";
  /** Max conversation turns to keep in context */
  maxContextTurns: number;
  /** System prompt for Claude */
  systemPrompt: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Partial<BotConfig> = {
  baseUrl: "https://api.anthropic.com",
  model: "claude-sonnet-4-6",
  fastModel: "claude-haiku-4-5",
  workDir: os.homedir(),
  permissionMode: "default",
  maxContextTurns: 20,
  systemPrompt: `You are a helpful AI assistant connected via WeChat. You can:
- Answer questions and have conversations
- Read and write files (when the user asks)
- Execute shell commands (when the user asks)
- Search the web for information

Be concise but thorough. When you need to use tools, explain what you're doing.
Respond in the same language the user uses (Chinese or English).`,
};

// ---------------------------------------------------------------------------
// Config resolution (priority: env > settings.json > defaults)
// ---------------------------------------------------------------------------

function resolveClaudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function loadClaudeSettings(): Record<string, unknown> | null {
  try {
    const settingsPath = resolveClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveBotConfigPath(): string {
  const envPath = process.env.BOT_CONFIG_PATH?.trim();
  if (envPath) return envPath;
  return path.join(os.homedir(), "Documents", "projects", "claude-wechat-bot", "data", "config.json");
}

function loadBotConfigFile(): Record<string, unknown> | null {
  try {
    const configPath = resolveBotConfigPath();
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _cachedConfig: BotConfig | null = null;

export function loadConfig(): BotConfig {
  if (_cachedConfig) return _cachedConfig;

  // 1. Load Claude Code settings for API credentials
  const claudeSettings = loadClaudeSettings();
  const claudeEnv = (claudeSettings?.env ?? {}) as Record<string, string>;

  // 2. Load local bot config overrides
  const botConfigFile = loadBotConfigFile();

  // 3. Resolve with priority: env var > local config > claude settings > defaults
  const baseUrl =
    process.env.ANTHROPIC_BASE_URL ??
    (botConfigFile?.baseUrl as string) ??
    claudeEnv.ANTHROPIC_BASE_URL ??
    DEFAULT_CONFIG.baseUrl!;

  const authToken =
    process.env.ANTHROPIC_AUTH_TOKEN ??
    (botConfigFile?.authToken as string) ??
    claudeEnv.ANTHROPIC_AUTH_TOKEN ??
    "";

  const model =
    process.env.ANTHROPIC_MODEL ??
    (botConfigFile?.model as string) ??
    claudeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ??
    claudeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ??
    DEFAULT_CONFIG.model!;

  const fastModel =
    process.env.ANTHROPIC_FAST_MODEL ??
    (botConfigFile?.fastModel as string) ??
    claudeEnv.ANTHROPIC_SMALL_FAST_MODEL ??
    DEFAULT_CONFIG.fastModel!;

  const workDir =
    process.env.BOT_WORK_DIR ??
    (botConfigFile?.workDir as string) ??
    DEFAULT_CONFIG.workDir!;

  const permissionMode =
    (process.env.BOT_PERMISSION_MODE as BotConfig["permissionMode"]) ??
    (botConfigFile?.permissionMode as BotConfig["permissionMode"]) ??
    DEFAULT_CONFIG.permissionMode!;

  const maxContextTurns =
    Number(process.env.BOT_MAX_CONTEXT_TURNS) ||
    (botConfigFile?.maxContextTurns as number) ||
    DEFAULT_CONFIG.maxContextTurns!;

  const systemPrompt =
    process.env.BOT_SYSTEM_PROMPT ??
    (botConfigFile?.systemPrompt as string) ??
    DEFAULT_CONFIG.systemPrompt!;

  _cachedConfig = {
    baseUrl,
    authToken,
    model,
    fastModel,
    workDir,
    permissionMode,
    maxContextTurns,
    systemPrompt,
  };

  return _cachedConfig;
}

/** Override cached config at runtime (e.g. for /mode commands). Call with null to clear cache. */
export function updateConfig(partial: Partial<BotConfig> | null): BotConfig {
  if (partial === null) {
    _cachedConfig = null;
    return loadConfig();
  }
  _cachedConfig = { ...loadConfig(), ...partial };
  return _cachedConfig;
}

/** Persist runtime config changes to local config file. */
export function saveConfig(partial: Partial<BotConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...partial };
  const configPath = resolveBotConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
  _cachedConfig = merged;
}

export function getConfigSummary(): string {
  const cfg = loadConfig();
  return [
    `API Base: ${cfg.baseUrl}`,
    `Model: ${cfg.model}`,
    `Fast Model: ${cfg.fastModel}`,
    `Auth: ${cfg.authToken ? "✓ configured" : "✗ missing"}`,
    `Work Dir: ${cfg.workDir}`,
    `Permission Mode: ${cfg.permissionMode}`,
    `Max Context Turns: ${cfg.maxContextTurns}`,
  ].join("\n");
}
