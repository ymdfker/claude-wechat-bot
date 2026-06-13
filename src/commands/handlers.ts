import fs from "node:fs";
import path from "node:path";
import { loadConfig, updateConfig, saveConfig, getConfigSummary } from "../config.js";
import { sessionManager } from "../session/manager.js";
import { permissionGuard } from "../permissions/guard.js";
import { getCommandHelp, type ParsedCommand } from "./parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandResult {
  reply: string;
  /** If true, the message was fully handled and should not go to Claude */
  handled: boolean;
}

export interface CommandContext {
  wechatUserId: string;
  accountId: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleCommand(
  cmd: ParsedCommand,
  ctx: CommandContext,
): Promise<CommandResult> {
  switch (cmd.command) {
    case "help":
      return helpCommand();
    case "new":
      return newCommand(cmd.args, ctx);
    case "list":
      return listCommand(ctx);
    case "switch":
      return switchCommand(cmd.args, ctx);
    case "current":
      return currentCommand(ctx);
    case "clear":
      return clearCommand(ctx);
    case "delete":
      return deleteCommand(cmd.args, ctx);
    case "mode":
      return modeCommand(cmd.args);
    case "allow":
      return allowCommand(cmd.args);
    case "dir":
      return dirCommand(cmd.args);
    case "stop":
      return { reply: "⏹ No active operation to stop.", handled: true };
    case "status":
      return statusCommand(ctx);
    case "model":
      return modelCommand(cmd.args);
    case "usage":
      return usageCommand();
    case "memory":
      return memoryCommand(cmd.args);
    case "cron":
      // Handled by bot.ts directly, but fallback here
      return { reply: "⏰ Cron scheduler available. Use /cron <schedule> | <prompt> to create a job.", handled: true };
    default:
      return { reply: `Unknown command: /${cmd.command}. Type /help for available commands.`, handled: true };
  }
}

// ---------------------------------------------------------------------------

function helpCommand(): CommandResult {
  return { reply: getCommandHelp(), handled: true };
}

function newCommand(name: string, ctx: CommandContext): CommandResult {
  const session = sessionManager.newSession(
    ctx.wechatUserId,
    ctx.accountId,
    name || undefined,
  );
  return {
    reply: `🆕 New session created: "${session.sessionName}" (${session.sessionId.slice(0, 8)}...)`,
    handled: true,
  };
}

function listCommand(ctx: CommandContext): CommandResult {
  const sessions = sessionManager.list(ctx.wechatUserId, ctx.accountId);
  if (sessions.length === 0) {
    return { reply: "No sessions found.", handled: true };
  }
  const lines = sessions.map((s, i) => {
    const marker = s.isActive ? "👉" : "  ";
    const date = new Date(s.updatedAt).toLocaleString("zh-CN");
    return `${marker} [${i}] ${s.name} — ${s.messageCount} msgs — ${date}`;
  });
  return { reply: `📋 Sessions:\n\n${lines.join("\n")}\n\nUse /switch <number> or /switch <id>`, handled: true };
}

function switchCommand(arg: string, ctx: CommandContext): CommandResult {
  const sessions = sessionManager.list(ctx.wechatUserId, ctx.accountId);
  let targetId: string;

  // Support index-based switching: /switch 0
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && sessions[idx]) {
    targetId = sessions[idx]!.id;
  } else {
    targetId = arg;
  }

  const result = sessionManager.switchTo(targetId, ctx.wechatUserId, ctx.accountId);
  if (!result) {
    return { reply: `Session not found: ${targetId}. Use /list to see available sessions.`, handled: true };
  }
  return { reply: `✅ Switched to: "${result.sessionName}" (${result.sessionId.slice(0, 8)}...)`, handled: true };
}

function currentCommand(ctx: CommandContext): CommandResult {
  const stats = sessionManager.getStats(ctx.wechatUserId, ctx.accountId);
  return { reply: `📊 Current Status:\n${stats}`, handled: true };
}

function clearCommand(ctx: CommandContext): CommandResult {
  sessionManager.clearContext(ctx.wechatUserId, ctx.accountId);
  return { reply: "🧹 Context cleared. Starting fresh.", handled: true };
}

function deleteCommand(arg: string, ctx: CommandContext): CommandResult {
  const sessions = sessionManager.list(ctx.wechatUserId, ctx.accountId);
  let targetId: string;
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && sessions[idx]) {
    targetId = sessions[idx]!.id;
  } else {
    targetId = arg;
  }

  const removed = sessionManager.remove(targetId, ctx.wechatUserId);
  if (!removed) {
    return { reply: `Session not found: ${targetId}`, handled: true };
  }
  return { reply: `🗑 Session deleted.`, handled: true };
}

function modeCommand(arg: string): CommandResult {
  if (!arg) {
    const cfg = loadConfig();
    return { reply: `Current permission mode: ${cfg.permissionMode}\n\nAvailable: default | accept_edits | yolo\nUsage: /mode <mode>`, handled: true };
  }

  const mode = arg.toLowerCase();
  if (!["default", "accept_edits", "yolo"].includes(mode)) {
    return { reply: `Invalid mode: ${mode}. Use: default | accept_edits | yolo`, handled: true };
  }

  updateConfig({ permissionMode: mode as any });
  saveConfig({ permissionMode: mode as any });
  permissionGuard.setMode(mode as any);

  const descriptions: Record<string, string> = {
    default: "Every tool call requires your approval",
    accept_edits: "File edits auto-approved, others require approval",
    yolo: "All tool calls auto-approved (fully autonomous)",
  };
  return { reply: `🔐 Mode set to "${mode}": ${descriptions[mode] ?? ""}`, handled: true };
}

function allowCommand(arg: string): CommandResult {
  if (!arg) {
    const allowed = permissionGuard.listAllowed();
    if (allowed.length === 0) {
      return { reply: "No pre-approved tools. Usage: /allow <tool_name>", handled: true };
    }
    return { reply: `Pre-approved tools: ${allowed.join(", ")}`, handled: true };
  }
  permissionGuard.allowTool(arg);
  return { reply: `✅ Tool "${arg}" pre-approved.`, handled: true };
}

function dirCommand(arg: string): CommandResult {
  if (!arg) {
    const cfg = loadConfig();
    try {
      const files = fs.readdirSync(cfg.workDir).slice(0, 20);
      return {
        reply: `📁 Work dir: ${cfg.workDir}\n\nContents:\n${files.map((f) => `  - ${f}`).join("\n")}${files.length >= 20 ? "\n  ..." : ""}`,
        handled: true,
      };
    } catch {
      return { reply: `📁 Work dir: ${cfg.workDir}\n(unable to list contents)`, handled: true };
    }
  }

  const resolved = arg.startsWith("/") ? arg : path.resolve(loadConfig().workDir, arg);
  if (!fs.existsSync(resolved)) {
    return { reply: `Directory not found: ${resolved}`, handled: true };
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return { reply: `Not a directory: ${resolved}`, handled: true };
  }

  updateConfig({ workDir: resolved });
  saveConfig({ workDir: resolved });
  return { reply: `📁 Work dir changed to: ${resolved}`, handled: true };
}

function statusCommand(ctx: CommandContext): CommandResult {
  const cfg = loadConfig();
  const stats = sessionManager.getStats(ctx.wechatUserId, ctx.accountId);
  return {
    reply: [
      "🤖 Bot Status",
      `API: ${cfg.baseUrl}`,
      `Model: ${cfg.model}`,
      `Mode: ${cfg.permissionMode}`,
      `Work Dir: ${cfg.workDir}`,
      "",
      stats,
    ].join("\n"),
    handled: true,
  };
}

function modelCommand(arg: string): CommandResult {
  const cfg = loadConfig();
  if (!arg) {
    return {
      reply: `Current model: ${cfg.model}\nFast model: ${cfg.fastModel}\n\nUsage: /model <model_id> to switch`,
      handled: true,
    };
  }

  updateConfig({ model: arg });
  saveConfig({ model: arg });
  return { reply: `🧠 Model changed to: ${arg}`, handled: true };
}

function usageCommand(): CommandResult {
  return { reply: getConfigSummary(), handled: true };
}

function memoryCommand(arg: string): CommandResult {
  const cfg = loadConfig();
  if (!arg) {
    return {
      reply: `Current system prompt:\n---\n${cfg.systemPrompt.slice(0, 500)}${cfg.systemPrompt.length > 500 ? "..." : ""}`,
      handled: true,
    };
  }
  updateConfig({ systemPrompt: arg });
  saveConfig({ systemPrompt: arg });
  return { reply: "🧠 System prompt updated.", handled: true };
}
