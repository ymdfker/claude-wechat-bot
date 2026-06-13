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
  deleteSession,
  createSession,
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

  resolve(wechatUserId: string, accountId: string): SessionContext {
    const key = `${accountId}:${wechatUserId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const session = getOrCreateSession({ wechatUserId, accountId });
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

  getActive(wechatUserId: string, accountId: string): SessionContext | null {
    const session = getActiveSession(wechatUserId, accountId);
    if (!session) return null;
    return {
      sessionId: session.id,
      sessionName: session.name,
      wechatUserId,
      accountId,
      messageCount: session.messageCount,
    };
  }

  /** Build Anthropic Messages API params from conversation history. */
  buildMessages(wechatUserId: string, accountId: string, userText: string) {
    const cfg = loadConfig();
    const ctx = this.resolve(wechatUserId, accountId);
    const history = getContextMessages(ctx.sessionId, cfg.maxContextTurns);
    // Append current user message
    history.push({ role: "user", content: userText });
    return { messages: history, sessionId: ctx.sessionId };
  }

  /** Persist a user message to the session. */
  saveUserMessage(sessionId: string, text: string): void {
    addMessage({ sessionId, role: "user", content: text });
    // Invalidate cache for this session
    this.invalidateCache(sessionId);
  }

  /** Persist an assistant reply to the session (plain text only, no thinking). */
  saveAssistantMessage(sessionId: string, text: string): void {
    addMessage({ sessionId, role: "assistant", content: text });
    this.invalidateCache(sessionId);
  }

  /** Persist an assistant message with thinking + optional tool_use. */
  saveAssistantWithThinking(
    sessionId: string,
    text: string,
    thinking: { thinking: string; signature: string } | null,
    toolUse?: ToolUseData,
  ): void {
    addAssistantWithThinking({ sessionId, text, thinking, toolUse });
    this.invalidateCache(sessionId);
  }

  /** Persist a tool result message. */
  saveToolResult(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    result: string,
  ): void {
    addToolResult({
      sessionId,
      toolUseId,
      toolName,
      result,
    });
    this.invalidateCache(sessionId);
  }

  /** Start a fresh session for the given user. */
  newSession(
    wechatUserId: string,
    accountId: string,
    name?: string,
  ): SessionContext {
    const session = createSession({
      name,
      wechatUserId,
      accountId,
    });
    const key = `${accountId}:${wechatUserId}`;
    const ctx: SessionContext = {
      sessionId: session.id,
      sessionName: session.name,
      wechatUserId,
      accountId,
      messageCount: 0,
    };
    this.cache.set(key, ctx);
    return ctx;
  }

  /** Clear current session context (keep session, drop messages). */
  clearContext(wechatUserId: string, accountId: string): void {
    const ctx = this.getActive(wechatUserId, accountId);
    if (!ctx) return;
    clearMessages(ctx.sessionId);
    this.invalidateCache(ctx.sessionId);
  }

  /** List all sessions for this WeChat user. */
  list(wechatUserId: string, accountId: string) {
    return listSessions(wechatUserId, accountId);
  }

  /** Switch to a different session. */
  switchTo(
    sessionId: string,
    wechatUserId: string,
    accountId: string,
  ): SessionContext | null {
    const session = switchSession(sessionId, wechatUserId, accountId);
    if (!session) return null;
    const key = `${accountId}:${wechatUserId}`;
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

  /** Delete a session. */
  remove(sessionId: string, wechatUserId: string): boolean {
    const result = deleteSession(sessionId);
    if (result) this.invalidateCache(sessionId);
    return result;
  }

  getStats(wechatUserId: string, accountId: string): string {
    const ctx = this.getActive(wechatUserId, accountId);
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
      if (ctx.sessionId === sessionId) {
        this.cache.delete(key);
        return;
      }
    }
  }
}

/** Singleton */
export const sessionManager = new SessionManager();
