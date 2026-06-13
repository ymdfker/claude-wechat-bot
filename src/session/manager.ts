import { loadConfig } from "../config.js";
import {
  getOrCreateSession,
  getActiveSession,
  getContextMessages,
  addMessage,
  addAssistantWithThinking,
  addToolResult,
  clearMessages,
  listSessions,
  switchSession,
  createSession,
  deleteSessionSync,
  getMessageCount,
  type ToolUseData,
} from "./store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionContext {
  sessionId: string;
  sessionName: string;
  wechatUserId: string;
  accountId: string;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SessionManager {
  private cache = new Map<string, SessionContext>();

  async resolve(wechatUserId: string, accountId: string): Promise<SessionContext> {
    const key = `${accountId}:${wechatUserId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const session = await getOrCreateSession({ wechatUserId, accountId });
    const ctx: SessionContext = {
      sessionId: session.id,
      sessionName: session.name,
      wechatUserId,
      accountId,
      messageCount: session.messageCount,
    };
    this.cache.set(key, ctx);
    return ctx;
  }

  async getActive(wechatUserId: string, accountId: string): Promise<SessionContext | null> {
    const session = await getActiveSession(wechatUserId, accountId);
    if (!session) return null;
    return {
      sessionId: session.id,
      sessionName: session.name,
      wechatUserId,
      accountId,
      messageCount: session.messageCount,
    };
  }

  async buildMessages(wechatUserId: string, accountId: string, userText: string) {
    const cfg = loadConfig();
    const ctx = await this.resolve(wechatUserId, accountId);
    const history = getContextMessages(ctx.sessionId, cfg.maxContextTurns);
    if (userText) {
      history.push({ role: "user", content: userText });
    }
    return { messages: history, sessionId: ctx.sessionId };
  }

  saveUserMessage(sessionId: string, text: string): void {
    addMessage({ sessionId, role: "user", content: text });
    this.invalidateCache(sessionId);
  }

  saveAssistantMessage(sessionId: string, text: string): void {
    addMessage({ sessionId, role: "assistant", content: text });
    this.invalidateCache(sessionId);
  }

  saveAssistantWithThinking(
    sessionId: string, text: string,
    thinking: { thinking: string; signature: string } | null,
    toolUse?: ToolUseData,
  ): void {
    addAssistantWithThinking({ sessionId, text, thinking, toolUse });
    this.invalidateCache(sessionId);
  }

  saveToolResult(sessionId: string, toolUseId: string, toolName: string, result: string): void {
    addToolResult({ sessionId, toolUseId, toolName, result });
    this.invalidateCache(sessionId);
  }

  async newSession(wechatUserId: string, accountId: string, name?: string): Promise<SessionContext> {
    const session = await createSession({ name, wechatUserId, accountId });
    const key = `${accountId}:${wechatUserId}`;
    const ctx: SessionContext = {
      sessionId: session.id, sessionName: session.name,
      wechatUserId, accountId, messageCount: 0,
    };
    this.cache.set(key, ctx);
    return ctx;
  }

  clearContext(wechatUserId: string, accountId: string): void {
    const key = `${accountId}:${wechatUserId}`;
    const ctx = this.cache.get(key);
    if (!ctx) return;
    clearMessages(ctx.sessionId);
    this.invalidateCache(ctx.sessionId);
  }

  async list(wechatUserId: string, accountId: string) {
    return listSessions(wechatUserId, accountId);
  }

  async switchTo(sessionId: string, wechatUserId: string, accountId: string): Promise<SessionContext | null> {
    const session = await switchSession(sessionId, wechatUserId, accountId);
    if (!session) return null;
    const key = `${accountId}:${wechatUserId}`;
    const ctx: SessionContext = {
      sessionId: session.id, sessionName: session.name,
      wechatUserId, accountId, messageCount: session.messageCount,
    };
    this.cache.set(key, ctx);
    return ctx;
  }

  remove(sessionId: string, _wechatUserId: string): boolean {
    const result = deleteSessionSync(sessionId);
    if (result) this.invalidateCache(sessionId);
    return result;
  }

  getStats(wechatUserId: string, accountId: string): string {
    const key = `${accountId}:${wechatUserId}`;
    const ctx = this.cache.get(key);
    if (!ctx) return "No active session.";
    const count = getMessageCount(ctx.sessionId);
    const cfg = loadConfig();
    return [
      `Session: ${ctx.sessionName} (${ctx.sessionId.slice(0, 8)}...)`,
      `Messages: ${count} / ${cfg.maxContextTurns * 2} max`,
      `Mode: ${cfg.permissionMode}`,
    ].join("\n");
  }

  private invalidateCache(sessionId: string): void {
    for (const [key, ctx] of this.cache) {
      if (ctx.sessionId === sessionId) { this.cache.delete(key); return; }
    }
  }
}

export const sessionManager = new SessionManager();
