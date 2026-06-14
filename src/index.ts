#!/usr/bin/env node
/**
 * Claude-WeChat Bot
 * Connect Claude (via DeepSeek API) directly to personal WeChat.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeWechatBot } from "./bot.js";
import { loadConfig, getConfigSummary } from "./config.js";

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------

const LOCK_FILE = path.join(os.tmpdir(), "claude-wechat-bot.lock");

function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      const existingPid = parseInt(raw, 10);
      if (!isNaN(existingPid)) {
        try {
          // Signal 0 checks if process exists without killing it
          process.kill(existingPid, 0);
          return false; // Process is still running
        } catch {
          // Process no longer exists — stale lock, remove it
          fs.unlinkSync(LOCK_FILE);
        }
      }
    }
    // Write our PID
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf-8");
    return true;
  } catch {
    return true; // If lock check fails, proceed anyway
  }
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      if (parseInt(raw, 10) === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Check single instance
  if (!acquireLock()) {
    console.error("⚠️  Claude-WeChat Bot is already running.");
    console.error("    Only one instance can run at a time.");
    // Try to show macOS dialog if in .app context
    try {
      const { execSync } = await import("node:child_process");
      execSync(
        `osascript -e 'display dialog "Claude-WeChat Bot is already running.\\n\\nOnly one instance can run at a time." buttons {"OK"} default button "OK" with icon caution with title "Already Running"'`,
        { timeout: 3000 },
      );
    } catch { /* not on macOS or osascript unavailable */ }
    process.exit(0);
  }

  console.log("=".repeat(50));
  console.log("🤖 Claude-WeChat Bot v0.1.0");
  console.log("=".repeat(50));
  console.log();

  // Validate config
  const cfg = loadConfig();
  if (!cfg.authToken) {
    console.error("❌ No API auth token found!");
    console.error();
    console.error("   The bot reads configuration from:");
    console.error("   1. Environment variables (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.)");
    console.error("   2. ~/.claude/settings.json (Claude Code config)");
    console.error("   3. data/config.json (local bot config)");
    console.error();
    console.error("   Since you use Claude Code with DeepSeek, your config should");
    console.error("   already be in ~/.claude/settings.json.");
    console.error();
    console.error("   If the token is there but not being read, check the file path:");
    console.error(`     ${process.env.HOME ?? "~"}/.claude/settings.json`);
    console.error();
    process.exit(1);
  }

  console.log("✅ API config loaded:");
  console.log(`   Base URL: ${cfg.baseUrl}`);
  console.log(`   Model: ${cfg.model}`);
  console.log(`   Fast Model: ${cfg.fastModel}`);
  console.log(`   Work Dir: ${cfg.workDir}`);
  console.log(`   Permission Mode: ${cfg.permissionMode}`);
  console.log();

  // Create and start bot
  const bot = new ClaudeWechatBot();

  // Handle graceful shutdown
  const shutdown = () => {
    console.log("\n👋 Shutting down...");
    releaseLock();
    bot.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", () => releaseLock());

  bot.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
