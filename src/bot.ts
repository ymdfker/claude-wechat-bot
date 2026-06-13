import { WechatBot, Message } from "wx-clawbot";
import type { WechatBotMessage } from "wx-clawbot";
import { loadConfig, getConfigSummary } from "./config.js";
import { sessionManager } from "./session/manager.js";
import { getContextMessages } from "./session/store.js";
import { parseCommand, isSlashCommand } from "./commands/parser.js";
import { handleCommand } from "./commands/handlers.js";
import { callClaude, streamClaude, assistantMessage } from "./claude/client.js";
import { permissionGuard } from "./permissions/guard.js";
import { CronScheduler, createCronJob, listCronJobs, deleteCronJobSync, formatCronJob, parseNaturalSchedule, type CronJob } from "./cron/scheduler.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

// ---------------------------------------------------------------------------
// Bot class
// ---------------------------------------------------------------------------

export class ClaudeWechatBot {
  private bot: WechatBot;
  private accountId = "";
  private activeStreams = new Map<string, AbortController>();
  private cronScheduler = new CronScheduler();

  constructor() {
    this.bot = new WechatBot();

    // Verify config on startup
    const cfg = loadConfig();
    if (!cfg.authToken) {
      console.error("⚠️  No API auth token configured. Please set ANTHROPIC_AUTH_TOKEN.");
      console.error("   Looking for config in: ~/.claude/settings.json");
    }

    console.log(getConfigSummary());
  }

  // -----------------------------------------------------------------------
  // Start
  // -----------------------------------------------------------------------

  start(): void {
    // Handle login events
    this.bot.on("login", (result: any) => {
      if (result.status === "success") {
        this.accountId = result.accountId ?? "";
        console.log(`✅ Logged in: accountId=${this.accountId}`);
      } else {
        console.error("❌ Login failed:", result);
      }
    });

    // Handle scan events
    this.bot.on("scan", (result: any) => {
      console.log("\n📱 Scan the QR code with WeChat to login:\n");
      console.log(`   QR URL: ${result.url}`);
    });

    // Handle scanned event
    this.bot.on("scaned", () => {
      console.log("✓ QR code scanned, waiting for confirmation...");
    });

    // Handle connected event
    this.bot.on("connected", () => {
      console.log("🔌 Connected to WeChat. Waiting for messages...");
    });

    // Handle errors
    this.bot.on("error", (err: Error) => {
      console.error("❌ Bot error:", err.message);
    });

    // Handle logout
    this.bot.on("logout", () => {
      console.log("👋 Logged out");
    });

    // --- Message handler: the core bridge ---
    this.bot.on("message", async (msg: Message) => {
      await this.handleMessage(msg);
    });

    // Start cron scheduler
    this.cronScheduler.start(async (job: CronJob) => {
      await this.handleCronJob(job);
    });

    // Start the bot
    console.log("🚀 Starting Claude-WeChat Bot...");
    this.bot.ensureLogin().runServer();
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private async handleMessage(msg: Message): Promise<void> {
    const text = msg.text;
    // Use from_user_id (the WeChat user's persistent ID, like "xxx@im.wechat"),
    // NOT msg.id (which is the per-message message_id that changes every time).
    const msgJson = msg.toJSON();
    const wechatUserId = msgJson.from_user_id ?? "unknown";
    const accountId = this.accountId;

    if (!text) {
      // Media-only message — try to download and describe it
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            await this.handleMediaMessage(msg, wechatUserId, accountId, media);
            return;
          }
        } catch (err) {
          console.error("Media download failed:", err);
        }
      }
      // Voice message with transcription
      if (msg.voiceText) {
        await this.handleTextMessage(msg, wechatUserId, accountId, msg.voiceText);
        return;
      }
      return;
    }

    // --- Check for pending permission approval FIRST ---
    // User may reply "allow", "yes", "同意", "允许", "reject", "no", "拒绝"
    const pendingApprovals = permissionGuard.getPendingApprovals();
    if (pendingApprovals.length > 0) {
      const lower = text.toLowerCase().trim();
      const approved = ["allow", "yes", "同意", "允许", "ok", "y", "批准", "通过"].some(
        (kw) => lower === kw || lower.startsWith(kw),
      );
      const rejected = ["reject", "no", "拒绝", "n", "deny", "驳回"].some(
        (kw) => lower === kw || lower.startsWith(kw),
      );

      if (approved) {
        permissionGuard.resolveApproval(pendingApprovals[0]!, true);
        await msg.sendText("✅ 已批准，继续执行...");
        return;
      }
      if (rejected) {
        permissionGuard.resolveApproval(pendingApprovals[0]!, false);
        await msg.sendText("❌ 已拒绝。");
        return;
      }

      // User said something else — reject the pending approval so Claude
      // isn't stuck waiting, and tell the user to try again.
      permissionGuard.resolveApproval(pendingApprovals[0]!, false);
      await msg.sendText(
        "⚠️ 上一个工具调用已取消。请重新发送你的请求。\n\n💡 提示：回复 **allow** 批准，**reject** 拒绝。",
      );
      return;
    }

    // Check for slash commands
    if (isSlashCommand(text)) {
      const cmd = parseCommand(text);
      if (cmd) {
        // Handle /stop specially — abort any active stream
        // Handle /cron — needs bot methods
        if (cmd.command === "cron") {
          const reply = await this.handleCronCommand(cmd.args, wechatUserId, accountId);
          await msg.sendText(reply);
          return;
        }

        // Handle /stop specially — abort any active stream
        if (cmd.command === "stop") {
          const controller = this.activeStreams.get(wechatUserId);
          if (controller) {
            controller.abort();
            this.activeStreams.delete(wechatUserId);
            await msg.sendText("⏹ Stopped.");
          } else {
            await msg.sendText("⏹ No active operation to stop.");
          }
          return;
        }

        const result = await handleCommand(cmd, { wechatUserId, accountId });
        if (result.handled) {
          await msg.sendText(result.reply);
          return;
        }
      }
    }

    // Route to Claude
    await this.handleTextMessage(msg, wechatUserId, accountId, text);
  }

  // -----------------------------------------------------------------------
  // Text message → Claude
  // -----------------------------------------------------------------------

  private async handleTextMessage(
    msg: Message,
    wechatUserId: string,
    accountId: string,
    text: string,
  ): Promise<void> {
    await msg.sendTyping();

    // Build conversation context
    const { messages, sessionId } = await sessionManager.buildMessages(
      wechatUserId,
      accountId,
      text,
    );
    sessionManager.saveUserMessage(sessionId, text);

    // Create abort controller for /stop
    const abortController = new AbortController();
    this.activeStreams.set(wechatUserId, abortController);

    try {
      const cfg = loadConfig();

      // Use streaming for better UX
      let fullText = "";
      let thinking: { thinking: string; signature: string } | null = null;
      let lastSendTime = Date.now();
      const MIN_SEND_INTERVAL = 1500;

      const tools = this.buildToolDefinitions();

      for await (const chunk of streamClaude({
        messages,
        tools,
        signal: abortController.signal,
      })) {
        if (abortController.signal.aborted) break;

        if (chunk.type === "text_delta" && chunk.text) {
          fullText += chunk.text;
        } else if (chunk.type === "thinking") {
          thinking = chunk.thinking;
        } else if (chunk.type === "tool_use" && chunk.toolCall) {
          // Save assistant message WITH thinking before executing tool
          sessionManager.saveAssistantWithThinking(
            sessionId,
            fullText,
            thinking,
            { id: chunk.toolCall.id, name: chunk.toolCall.name, input: chunk.toolCall.input },
          );

          // Execute tool — ALWAYS save a tool_result so the API sees a
          // matching pair, even if execution fails.
          let toolResult: string;
          try {
            toolResult = (await this.handleToolCall(
              chunk.toolCall, wechatUserId, sessionId, msg,
            )) ?? `Tool "${chunk.toolCall.name}" returned no result.`;
          } catch (err: any) {
            toolResult = `Tool execution error: ${err.message}`;
          }

          sessionManager.saveToolResult(
            sessionId, chunk.toolCall.id, chunk.toolCall.name, toolResult,
          );
          await msg.stopTyping();
          await this.continueWithToolResult(
            msg, wechatUserId, accountId, sessionId,
            chunk.toolCall.id, toolResult,
          );
          return;
        }
      }

      // Send final response
      if (fullText.trim()) {
        await msg.stopTyping();
        await msg.sendText(fullText.trim());
        // Save with thinking if present
        sessionManager.saveAssistantWithThinking(sessionId, fullText.trim(), thinking);
      } else {
        await msg.stopTyping();
        await msg.sendText("(no response)");
      }
    } catch (err: any) {
      await msg.stopTyping();
      if (err.name === "AbortError" || abortController.signal.aborted) {
        await msg.sendText("⏹ Stopped.");
      } else {
        console.error("Claude API error:", err);
        await msg.sendText(`❌ Error: ${err.message ?? String(err)}`);
      }
    } finally {
      this.activeStreams.delete(wechatUserId);
    }
  }

  // -----------------------------------------------------------------------
  // Media message handling
  // -----------------------------------------------------------------------

  private async handleMediaMessage(
    msg: Message,
    wechatUserId: string,
    accountId: string,
    media: { buffer: Buffer; type: string; contentType?: string; filename?: string },
  ): Promise<void> {
    const mediaType = media.type; // "image" | "voice" | "file" | "video"
    const filename = media.filename ?? "unknown";
    const sizeBytes = media.buffer.length;

    // Detect real MIME type from magic bytes (wx-clawbot decrypts the buffer
    // but doesn't set contentType, so we can't trust media.contentType).
    const detectedMime = detectImageMime(media.buffer) ?? "application/octet-stream";
    const isImage = detectedMime.startsWith("image/");
    const displayType = mediaType === "image" || isImage ? "图片" : mediaType === "video" ? "视频" : mediaType === "voice" ? "语音" : "文件";

    await msg.sendText(`📎 收到${displayType} (${(sizeBytes / 1024).toFixed(1)}KB${isImage ? `, ${detectedMime}` : ""})，正在分析...`);

    // Save image to temp file
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmpDir = path.join(os.tmpdir(), "claude-wechat-bot", "media");
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = mimeToExt(detectedMime);
    const tmpPath = path.join(tmpDir, `${Date.now()}_${path.basename(filename, path.extname(filename))}${ext}`);
    fs.writeFileSync(tmpPath, media.buffer);

    // Save user message placeholder for session context
    const { sessionId } = await sessionManager.buildMessages(wechatUserId, accountId, "");
    sessionManager.saveUserMessage(sessionId,
      `[用户发送了${displayType}: ${filename}, ${(sizeBytes / 1024).toFixed(1)}KB, 已保存到 ${tmpPath}]`);

    if (isImage) {
      // DeepSeek API (Anthropic-compatible endpoint) doesn't support image input.
      // Save the image to disk and tell Claude the path so it can reference it.
      // Future: add OCR or a vision-capable model for actual image analysis.
      await msg.stopTyping();
      await msg.sendText(
        `📸 图片已保存: \`${tmpPath}\`\n\n` +
        `⚠️ 当前使用的 DeepSeek API 不支持图片识别。你可以让 bot 通过以下方式处理：\n` +
        `  • 读取文件路径确认图片已保存\n` +
        `  • 执行 shell 命令用其他工具分析\n` +
        `  • 后续可接入 OCR/视觉模型实现图片理解`
      );
    } else {
      // Other media: describe and offer download
      await msg.stopTyping();
      await msg.sendText(
        `📎 收到${displayType}: ${filename}\n` +
        `大小: ${(sizeBytes / 1024).toFixed(1)}KB\n` +
        `保存路径: \`${tmpPath}\`\n` +
        `格式: ${detectedMime}`
      );
    }
  }

  // -----------------------------------------------------------------------
  // Tool call handling
  // -----------------------------------------------------------------------

  private buildToolDefinitions(): Tool[] {
    return [
      {
        name: "read_file",
        description: "Read the contents of a file. Use this to examine files on the local filesystem.",
        input_schema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the file to read",
            },
            offset: {
              type: "number",
              description: "Line number to start reading from (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum number of lines to read (optional)",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
        input_schema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the file to write",
            },
            content: {
              type: "string",
              description: "Content to write to the file",
            },
          },
          required: ["file_path", "content"],
        },
      },
      {
        name: "execute_command",
        description: "Execute a shell command and return its output. Use for running scripts, checking system info, etc.",
        input_schema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "web_search",
        description: "Search the web for information and return results.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  private async handleToolCall(
    toolCall: { id: string; name: string; input: Record<string, unknown> },
    wechatUserId: string,
    _sessionId: string,
    msg: Message,
  ): Promise<string> {
    const decision = permissionGuard.needsApproval(toolCall);

    if (!decision.approved) {
      // Need user approval
      const approvalMsg = permissionGuard.formatToolCallForApproval(toolCall);
      await msg.stopTyping();
      await msg.sendText(approvalMsg);

      const approved = await permissionGuard.waitForApproval(toolCall);
      if (!approved) {
        return `Tool call "${toolCall.name}" was rejected by the user. Do not retry this tool. Explain to the user why you needed it and ask if they want to proceed differently.`;
      }
    }

    // Execute the tool (let caller handle exceptions)
    console.log(`🔧 Executing tool: ${toolCall.name}`, JSON.stringify(toolCall.input).slice(0, 200));
    const result = await this.executeTool(toolCall.name, toolCall.input);
    console.log(`✅ Tool ${toolCall.name} completed`);
    return result;
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case "read_file":
        return this.toolReadFile(input);
      case "write_file":
        return this.toolWriteFile(input);
      case "execute_command":
        return this.toolExecuteCommand(input);
      case "web_search":
        return this.toolWebSearch(input);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private async toolReadFile(input: Record<string, unknown>): Promise<string> {
    const fs = await import("node:fs");
    const filePath = input.file_path as string;
    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const offset = (input.offset as number) ?? 0;
    const limit = (input.limit as number) ?? lines.length;
    const sliced = lines.slice(offset, offset + limit);
    return sliced
      .map((line, i) => `${String(offset + i + 1).padStart(4, " ")}| ${line}`)
      .join("\n");
  }

  private async toolWriteFile(input: Record<string, unknown>): Promise<string> {
    const fs = await import("node:fs");
    const pathLib = await import("node:path");
    const filePath = input.file_path as string;
    const content = input.content as string;

    // Ensure parent directory exists
    const dir = pathLib.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    return `File written: ${filePath} (${content.length} bytes)`;
  }

  private async toolExecuteCommand(
    input: Record<string, unknown>,
  ): Promise<string> {
    const { execSync } = await import("node:child_process");
    const command = input.command as string;
    const cfg = loadConfig();

    try {
      const output = execSync(command, {
        cwd: cfg.workDir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024, // 1MB
        encoding: "utf-8",
      });
      return output || "(command completed with no output)";
    } catch (err: any) {
      return `Command failed (exit ${err.status ?? "?"}): ${err.stderr ?? err.message}`;
    }
  }

  private async toolWebSearch(
    input: Record<string, unknown>,
  ): Promise<string> {
    const query = input.query as string;
    const encoded = encodeURIComponent(query);
    const errors: string[] = [];

    // Strategy 1: DuckDuckGo Lite HTML (most CDN-friendly)
    try {
      const resp = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const results = this.parseDdgLite(html);
        if (results.length > 0) {
          return `🌐 Search: "${query}"\n\n${results.join("\n")}`;
        }
      }
    } catch (e: any) {
      errors.push(`DDG Lite: ${e.message}`);
    }

    // Strategy 2: DuckDuckGo Instant Answer API
    try {
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const results: string[] = [];
        if (data.AbstractText) {
          results.push(`📌 ${data.AbstractText}`);
          if (data.AbstractURL) results.push(`   ${data.AbstractURL}`);
        }
        if (data.RelatedTopics?.length) {
          results.push("");
          for (const t of data.RelatedTopics.slice(0, 5)) {
            if (t.Text) results.push(`  • ${t.Text.slice(0, 200)}`);
          }
        }
        if (results.length > 0) {
          return `🌐 Search: "${query}"\n\n${results.join("\n")}`;
        }
      }
    } catch (e: any) {
      errors.push(`DDG API: ${e.message}`);
    }

    // Strategy 3: SearXNG public instance
    try {
      const resp = await fetch(
        `https://search.sapti.me/search?q=${encoded}&format=json&language=en`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const results: string[] = [];
        const items = data.results?.slice(0, 8) ?? [];
        for (const r of items) {
          if (r.title && r.content) {
            results.push(`📌 ${r.title}\n   ${r.content.slice(0, 200)}\n   ${r.url ?? ""}`);
          }
        }
        if (results.length > 0) {
          return `🌐 Search: "${query}"\n\n${results.join("\n\n")}`;
        }
      }
    } catch (e: any) {
      errors.push(`SearXNG: ${e.message}`);
    }

    // All failed
    return [
      `⚠️ Web search failed for: "${query}"`,
      `All 3 backends returned errors:`,
      ...errors.map((e) => `  - ${e}`),
      ``,
      `You can try:`,
      `  1. Ask me to search again with a refined query`,
      `  2. Use "execute_command" to run: curl "https://lite.duckduckgo.com/lite/?q=${encoded}"`,
    ].join("\n");
  }

  /** Parse DuckDuckGo Lite HTML results into text lines. */
  private parseDdgLite(html: string): string[] {
    const results: string[] = [];
    // DDG Lite uses <a> links with class="result-link" and <span class="result-snippet">
    const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRe = /<span[^>]*class="result-snippet"[^>]*>([^<]*)<\/span>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const url = m[1] ?? "";
      const title = (m[2] ?? "").replace(/<[^>]*>/g, "").trim();
      if (url && title) links.push({ url, title });
    }

    const snippets: string[] = [];
    while ((m = snippetRe.exec(html)) !== null) {
      const s = (m[1] ?? "").replace(/<[^>]*>/g, "").trim();
      if (s) snippets.push(s);
    }

    for (let i = 0; i < Math.min(links.length, snippets.length, 6); i++) {
      results.push(`📌 ${links[i]!.title}\n   ${snippets[i]!}\n   ${links[i]!.url}`);
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Continue conversation after tool use
  // -----------------------------------------------------------------------

  private async continueWithToolResult(
    msg: Message,
    wechatUserId: string,
    accountId: string,
    sessionId: string,
    toolUseId: string,
    toolResult: string,
  ): Promise<void> {
    await msg.sendTyping();

    // Get context directly — do NOT append an empty user message.
    // The last message is already the tool_result, so Claude can continue.
    const cfg = loadConfig();
    const messages = getContextMessages(sessionId, cfg.maxContextTurns);
    const abortController = new AbortController();
    this.activeStreams.set(wechatUserId, abortController);

    try {
      const tools = this.buildToolDefinitions();
      let fullText = "";
      let thinking: { thinking: string; signature: string } | null = null;

      for await (const chunk of streamClaude({
        messages,
        tools,
        signal: abortController.signal,
      })) {
        if (abortController.signal.aborted) break;

        if (chunk.type === "text_delta" && chunk.text) {
          fullText += chunk.text;
        } else if (chunk.type === "thinking") {
          thinking = chunk.thinking;
        } else if (chunk.type === "tool_use" && chunk.toolCall) {
          // Save assistant message WITH thinking before executing nested tool
          sessionManager.saveAssistantWithThinking(
            sessionId,
            fullText,
            thinking,
            { id: chunk.toolCall.id, name: chunk.toolCall.name, input: chunk.toolCall.input },
          );

          // Execute — ALWAYS save tool_result to keep API pairing happy
          let toolResult: string;
          try {
            toolResult = (await this.handleToolCall(
              chunk.toolCall, wechatUserId, sessionId, msg,
            )) ?? `Tool "${chunk.toolCall.name}" returned no result.`;
          } catch (err: any) {
            toolResult = `Tool execution error: ${err.message}`;
          }

          sessionManager.saveToolResult(
            sessionId, chunk.toolCall.id, chunk.toolCall.name, toolResult,
          );
          await msg.stopTyping();
          await this.continueWithToolResult(
            msg, wechatUserId, accountId, sessionId,
            chunk.toolCall.id, toolResult,
          );
          return;
        }
      }

      await msg.stopTyping();
      if (fullText.trim()) {
        await msg.sendText(fullText.trim());
        sessionManager.saveAssistantWithThinking(sessionId, fullText.trim(), thinking);
      }
    } catch (err: any) {
      await msg.stopTyping();
      if (err.name !== "AbortError") {
        await msg.sendText(`❌ Error: ${err.message ?? String(err)}`);
      }
    } finally {
      this.activeStreams.delete(wechatUserId);
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Cron job handler
  // -----------------------------------------------------------------------

  private async handleCronJob(job: CronJob): Promise<void> {
    if (!this.bot) return;

    try {
      // Build messages for the cron prompt
      const { messages } = await sessionManager.buildMessages(
        job.wechatUserId,
        job.accountId,
        job.prompt,
      );
      const ctx = await sessionManager.resolve(job.wechatUserId, job.accountId);
      sessionManager.saveUserMessage(ctx.sessionId, job.prompt);

      const response = await callClaude({ messages, maxTokens: 2048 });
      const reply = response.text.trim();

      if (reply) {
        // Use wx-clawbot's sendText to deliver to the WeChat user
        await this.bot.sendText(reply);
        const ctx2 = await sessionManager.resolve(job.wechatUserId, job.accountId);
        sessionManager.saveAssistantMessage(ctx2.sessionId, reply);
      }
    } catch (err: any) {
      console.error(`Cron job ${job.name} failed:`, err);
      // Try to notify user
      try {
        await this.bot.sendText(
          `⚠️ Cron job "${job.name}" failed: ${err.message}`,
        );
      } catch {
        // ignore notification failure
      }
    }
  }

  /** Handle /cron commands from user messages */
  async handleCronCommand(
    args: string,
    wechatUserId: string,
    accountId: string,
  ): Promise<string> {
    if (!args) {
      const jobs = await listCronJobs(wechatUserId);
      if (jobs.length === 0) {
        return [
          "⏰ No cron jobs configured.",
          "",
          "Create one with: /cron <schedule> | <prompt>",
          "Examples:",
          '  /cron "0 9 * * *" | Summarize GitHub trending today',
          "  /cron every day at 9am | Send me a morning briefing",
          "  /cron every 30 min | Check the weather",
        ].join("\n");
      }
      return [
        "⏰ Scheduled Jobs:",
        ...jobs.map((j, i) => formatCronJob(j, i)),
        "",
        "Manage: /cron delete <number> | /cron toggle <number>",
      ].join("\n");
    }

    // Delete command
    if (args.startsWith("delete ")) {
      const idx = parseInt(args.replace("delete ", "").trim(), 10);
      const jobs = await listCronJobs(wechatUserId);
      if (isNaN(idx) || !jobs[idx]) {
        return "Invalid job index. Use /cron to see the list.";
      }
      deleteCronJobSync(jobs[idx]!.id);
      return `🗑 Deleted cron job: ${jobs[idx]!.name}`;
    }

    // Parse: <schedule> | <prompt>
    const pipeIdx = args.indexOf("|");
    if (pipeIdx === -1) {
      return "Usage: /cron <schedule> | <prompt>\nExample: /cron every day at 9am | Morning briefing";
    }

    const scheduleRaw = args.slice(0, pipeIdx).trim();
    const prompt = args.slice(pipeIdx + 1).trim();

    if (!prompt) {
      return "Please provide a prompt after the | separator.";
    }

    // Try natural language parsing first
    let cronExpression: string;
    let description: string;

    const natural = parseNaturalSchedule(scheduleRaw);
    if (natural) {
      cronExpression = natural.cronExpression;
      description = natural.description;
    } else {
      // Assume it's already a cron expression (5 fields)
      const fields = scheduleRaw.split(/\s+/);
      if (fields.length !== 5) {
        return `Invalid schedule: "${scheduleRaw}". Use either:\n- Natural language: "every day at 9am"\n- Cron expression: "0 9 * * *"`;
      }
      cronExpression = scheduleRaw;
      description = scheduleRaw;
    }

    const job = await createCronJob({
      name: prompt.slice(0, 50),
      cronExpression,
      prompt,
      wechatUserId,
      accountId,
    });

    return [
      `⏰ Cron job created!`,
      `Schedule: ${description} (\`${cronExpression}\`)`,
      `Prompt: ${prompt}`,
      `Next run: ${new Date(job.nextRunAt!).toLocaleString("zh-CN")}`,
    ].join("\n");
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    this.cronScheduler.stop();
    this.bot.close();
    const store = await import("./session/store.js");
    store.closeStore();
  }
}

// ---------------------------------------------------------------------------
// Image format detection by magic bytes
// ---------------------------------------------------------------------------

const MAGIC_BYTES: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp" }, // RIFF....WEBP
  { bytes: [0x42, 0x4d], mime: "image/bmp" },
];

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  for (const entry of MAGIC_BYTES) {
    if (entry.bytes.every((b, i) => buffer[i] === b)) {
      // WebP needs extra check: bytes 8-11 must be "WEBP"
      if (entry.mime === "image/webp") {
        if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
          return entry.mime;
        }
        continue;
      }
      return entry.mime;
    }
  }
  return null;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
  };
  return map[mime] ?? ".bin";
}
