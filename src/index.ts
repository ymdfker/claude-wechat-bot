#!/usr/bin/env node
/**
 * Claude-WeChat Bot
 * Connect Claude (via DeepSeek API) directly to personal WeChat.
 *
 * Usage:
 *   npm run dev          — start in development mode
 *   npm run build && npm start  — build and start
 */

import { ClaudeWechatBot } from "./bot.js";
import { loadConfig, getConfigSummary } from "./config.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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
    bot.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  bot.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
