import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  name: string;
  wechatUserId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isActive: boolean;
}

export interface ToolUseData {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ContextMessage {
  id: number;
  role: "user" | "assistant";
  /** Plain text content (for user messages and plain assistant replies) */
  content: string;
  /** For tool_result messages: the tool_use_id this result corresponds to */
  toolUseId?: string;
  /** For tool_result messages: the tool name */
  toolName?: string;
  /** For assistant tool_use messages: the tool_use block data (JSON) */
  toolUseJson?: string;
  /** For assistant messages: serialized thinking blocks (JSON array of {thinking, signature}) */
  thinkingJson?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

function resolveDbPath(): string {
  const cwdDataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(cwdDataDir, { recursive: true });
  return path.join(cwdDataDir, "sessions.db");
}

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = resolveDbPath();
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wechat_user_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_use_id TEXT,
      tool_name TEXT,
      tool_use_json TEXT,
      thinking_json TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_wechat ON sessions(wechat_user_id, account_id);
  `);

  // Migrate: add columns if they don't exist (safe to run repeatedly)
  for (const col of ["tool_use_json", "thinking_json"]) {
    try { _db.exec(`ALTER TABLE messages ADD COLUMN ${col} TEXT`); } catch { /* already exists */ }
  }

  return _db;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function createSession(params: {
  name?: string;
  wechatUserId: string;
  accountId?: string;
}): SessionRecord {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const name = params.name ?? `Chat-${new Date().toLocaleDateString("zh-CN")}`;

  deactivateSessions(params.wechatUserId, params.accountId ?? "");

  db.prepare(
    `INSERT INTO sessions (id, name, wechat_user_id, account_id, created_at, updated_at, message_count, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
  ).run(id, name, params.wechatUserId, params.accountId ?? "", now, now);

  return {
    id,
    name,
    wechatUserId: params.wechatUserId,
    accountId: params.accountId ?? "",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    isActive: true,
  };
}

function deactivateSessions(wechatUserId: string, accountId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET is_active = 0 WHERE wechat_user_id = ? AND account_id = ?`,
  ).run(wechatUserId, accountId);
}

export function getActiveSession(
  wechatUserId: string,
  accountId: string,
): SessionRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM sessions
     WHERE wechat_user_id = ? AND account_id = ? AND is_active = 1
     ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(wechatUserId, accountId) as any;

  if (!row) return null;
  return rowToSession(row);
}

export function getOrCreateSession(params: {
  wechatUserId: string;
  accountId: string;
}): SessionRecord {
  const existing = getActiveSession(params.wechatUserId, params.accountId);
  if (existing) return existing;
  return createSession(params);
}

export function getSession(id: string): SessionRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return rowToSession(row);
}

export function listSessions(
  wechatUserId: string,
  accountId: string,
): SessionRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM sessions
     WHERE wechat_user_id = ? AND account_id = ?
     ORDER BY updated_at DESC LIMIT 20`,
    )
    .all(wechatUserId, accountId) as any[];
  return rows.map(rowToSession);
}

export function switchSession(
  sessionId: string,
  wechatUserId: string,
  accountId: string,
): SessionRecord | null {
  const session = getSession(sessionId);
  if (!session || session.wechatUserId !== wechatUserId) return null;

  const db = getDb();
  deactivateSessions(wechatUserId, accountId);
  db.prepare(`UPDATE sessions SET is_active = 1, updated_at = ? WHERE id = ?`).run(
    Date.now(),
    sessionId,
  );
  return { ...session, isActive: true };
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function addMessage(params: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  toolUseId?: string;
  toolName?: string;
  toolUseJson?: string;
  thinkingJson?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_use_id, tool_name, tool_use_json, thinking_json, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.sessionId,
    params.role,
    params.content,
    params.toolUseId ?? null,
    params.toolName ?? null,
    params.toolUseJson ?? null,
    params.thinkingJson ?? null,
    Date.now(),
  );
  db.prepare(
    `UPDATE sessions SET updated_at = ?, message_count = message_count + 1 WHERE id = ?`,
  ).run(Date.now(), params.sessionId);
}

/** Save an assistant message that includes thinking + optional tool_use block. */
export function addAssistantWithThinking(params: {
  sessionId: string;
  text: string;
  thinking?: { thinking: string; signature: string } | null;
  toolUse?: ToolUseData;
}): void {
  addMessage({
    sessionId: params.sessionId,
    role: "assistant",
    content: params.text,
    thinkingJson: params.thinking ? JSON.stringify(params.thinking) : undefined,
    toolUseJson: params.toolUse ? JSON.stringify(params.toolUse) : undefined,
  });
}

/** Save a tool result (user role with tool_result content). */
export function addToolResult(params: {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  result: string;
}): void {
  addMessage({
    sessionId: params.sessionId,
    role: "user",
    content: params.result,
    toolUseId: params.toolUseId,
    toolName: params.toolName,
  });
}

export function getRecentMessages(
  sessionId: string,
  limit: number,
): ContextMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM messages
     WHERE session_id = ?
     ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(sessionId, limit) as any[];
  return rows.reverse().map(rowToContextMessage);
}

/**
 * Rebuild Anthropic Messages API params from stored conversation history.
 * This properly constructs tool_use and tool_result content blocks so the
 * API doesn't reject tool_result blocks referencing unknown tool_use_ids.
 */
export function getContextMessages(
  sessionId: string,
  maxTurns: number,
): MessageParam[] {
  // Fetch more than needed to avoid splitting tool_use/tool_result pairs
  const messages = getRecentMessages(sessionId, maxTurns * 4 + 20);
  const seenToolUseIds = new Set<string>();

  // First pass: collect all tool_use IDs
  for (const msg of messages) {
    if (msg.toolUseJson) {
      try {
        const toolUse = JSON.parse(msg.toolUseJson) as ToolUseData;
        seenToolUseIds.add(toolUse.id);
      } catch { /* skip */ }
    }
  }

  const result: MessageParam[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;

    // Skip orphan tool_results (their tool_use was truncated)
    if (msg.role === "user" && msg.toolUseId) {
      if (!seenToolUseIds.has(msg.toolUseId)) {
        i++;
        continue; // drop orphan
      }
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolUseId,
            content: msg.content,
          },
        ],
      });
      i++;
      continue;
    }

    if (msg.role === "assistant" && (msg.toolUseJson || msg.thinkingJson)) {
      const contentBlocks: any[] = [];

      if (msg.thinkingJson) {
        try {
          const thinking = JSON.parse(msg.thinkingJson);
          if (Array.isArray(thinking)) {
            for (const t of thinking) {
              contentBlocks.push({ type: "thinking", thinking: t.thinking, signature: t.signature });
            }
          } else {
            contentBlocks.push({ type: "thinking", thinking: thinking.thinking, signature: thinking.signature });
          }
        } catch { /* skip malformed */ }
      }

      if (msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }

      if (msg.toolUseJson) {
        try {
          const toolUse = JSON.parse(msg.toolUseJson) as ToolUseData;
          contentBlocks.push({
            type: "tool_use",
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input,
          });
        } catch { /* skip malformed */ }
      }

      if (contentBlocks.length > 0) {
        result.push({ role: "assistant", content: contentBlocks });
      }
      i++;
      continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else {
      if (msg.thinkingJson) {
        try {
          const thinking = JSON.parse(msg.thinkingJson);
          const blocks: any[] = [];
          if (Array.isArray(thinking)) {
            for (const t of thinking) blocks.push({ type: "thinking", thinking: t.thinking, signature: t.signature });
          } else {
            blocks.push({ type: "thinking", thinking: thinking.thinking, signature: thinking.signature });
          }
          blocks.push({ type: "text", text: msg.content });
          result.push({ role: "assistant", content: blocks });
        } catch {
          result.push({ role: "assistant", content: msg.content });
        }
      } else {
        result.push({ role: "assistant", content: msg.content });
      }
    }
    i++;
  }

  // Enforce maxTurns limit on final result (keep last N pairs of user/assistant)
  const maxMessages = maxTurns * 4 + 10;
  if (result.length > maxMessages) {
    return result.slice(result.length - maxMessages);
  }

  return result;
}

export function clearMessages(sessionId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
  db.prepare(
    `UPDATE sessions SET message_count = 0, updated_at = ? WHERE id = ?`,
  ).run(Date.now(), sessionId);
}

export function getMessageCount(sessionId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM messages WHERE session_id = ?`)
    .get(sessionId) as any;
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSession(row: any): SessionRecord {
  return {
    id: row.id,
    name: row.name,
    wechatUserId: row.wechat_user_id,
    accountId: row.account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    isActive: Boolean(row.is_active),
  };
}

function rowToContextMessage(row: any): ContextMessage {
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content ?? "",
    toolUseId: row.tool_use_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    toolUseJson: row.tool_use_json ?? undefined,
    thinkingJson: row.thinking_json ?? undefined,
    timestamp: row.timestamp,
  };
}

/** Close the database connection gracefully. */
export function closeStore(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
