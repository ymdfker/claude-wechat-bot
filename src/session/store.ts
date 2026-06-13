import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
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
  content: string;
  toolUseId?: string;
  toolName?: string;
  toolUseJson?: string;
  thinkingJson?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// SQL.js handle (lazy init)
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _SQL: SqlJsStatic | null = null;

function resolveDbPath(): string {
  const cwdDataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(cwdDataDir, { recursive: true });
  return path.join(cwdDataDir, "sessions.db");
}

async function getDb(): Promise<Database> {
  if (_db) return _db;

  _SQL = await initSqlJs();
  const dbPath = resolveDbPath();

  // Load existing DB or create new
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    _db = new _SQL.Database(buffer);
  } else {
    _db = new _SQL.Database();
  }

  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");

  _db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wechat_user_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
  _db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_use_id TEXT,
      tool_name TEXT,
      tool_use_json TEXT,
      thinking_json TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  // Create indexes (safe to run multiple times)
  try { _db.run("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)"); } catch { /* ok */ }
  try { _db.run("CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(session_id, timestamp)"); } catch { /* ok */ }
  try { _db.run("CREATE INDEX IF NOT EXISTS idx_sessions_wechat ON sessions(wechat_user_id, account_id)"); } catch { /* ok */ }

  return _db;
}

/** Persist SQL.js in-memory DB back to disk. */
function saveDb(): void {
  if (!_db) return;
  const dbPath = resolveDbPath();
  const data = _db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function run(sql: string, params: any[] = []): void {
  if (!_db) throw new Error("DB not initialized");
  _db.run(sql, params);
  saveDb();
}

function get(sql: string, params: any[] = []): any | null {
  if (!_db) throw new Error("DB not initialized");
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql: string, params: any[] = []): any[] {
  if (!_db) throw new Error("DB not initialized");
  const results: any[] = [];
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function createSession(params: {
  name?: string;
  wechatUserId: string;
  accountId?: string;
}): Promise<SessionRecord> {
  await getDb();
  const id = randomUUID();
  const now = Date.now();
  const name = params.name ?? `Chat-${new Date().toLocaleDateString("zh-CN")}`;

  deactivateSessions(params.wechatUserId, params.accountId ?? "");

  run(
    `INSERT INTO sessions (id, name, wechat_user_id, account_id, created_at, updated_at, message_count, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    [id, name, params.wechatUserId, params.accountId ?? "", now, now],
  );

  return {
    id, name,
    wechatUserId: params.wechatUserId,
    accountId: params.accountId ?? "",
    createdAt: now, updatedAt: now,
    messageCount: 0, isActive: true,
  };
}

function deactivateSessions(wechatUserId: string, accountId: string): void {
  run(
    `UPDATE sessions SET is_active = 0 WHERE wechat_user_id = ? AND account_id = ?`,
    [wechatUserId, accountId],
  );
}

export async function getActiveSession(
  wechatUserId: string, accountId: string,
): Promise<SessionRecord | null> {
  await getDb();
  const row = get(
    `SELECT * FROM sessions WHERE wechat_user_id = ? AND account_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1`,
    [wechatUserId, accountId],
  );
  return row ? rowToSession(row) : null;
}

export async function getOrCreateSession(params: {
  wechatUserId: string; accountId: string;
}): Promise<SessionRecord> {
  const existing = await getActiveSession(params.wechatUserId, params.accountId);
  if (existing) return existing;
  return createSession(params);
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  await getDb();
  const row = get(`SELECT * FROM sessions WHERE id = ?`, [id]);
  return row ? rowToSession(row) : null;
}

export async function listSessions(
  wechatUserId: string, accountId: string,
): Promise<SessionRecord[]> {
  await getDb();
  const rows = all(
    `SELECT * FROM sessions WHERE wechat_user_id = ? AND account_id = ? ORDER BY updated_at DESC LIMIT 20`,
    [wechatUserId, accountId],
  );
  return rows.map(rowToSession);
}

export async function switchSession(
  sessionId: string, wechatUserId: string, accountId: string,
): Promise<SessionRecord | null> {
  const session = await getSession(sessionId);
  if (!session || session.wechatUserId !== wechatUserId) return null;

  deactivateSessions(wechatUserId, accountId);
  run(`UPDATE sessions SET is_active = 1, updated_at = ? WHERE id = ?`, [Date.now(), sessionId]);
  return { ...session, isActive: true };
}

export function deleteSessionSync(id: string): boolean {
  if (!_db) return false;
  try {
    run(`DELETE FROM sessions WHERE id = ?`, [id]);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function _addMessage(params: {
  sessionId: string; role: string; content: string;
  toolUseId?: string; toolName?: string;
  toolUseJson?: string; thinkingJson?: string;
}): void {
  run(
    `INSERT INTO messages (session_id, role, content, tool_use_id, tool_name, tool_use_json, thinking_json, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.sessionId, params.role, params.content,
     params.toolUseId ?? null, params.toolName ?? null,
     params.toolUseJson ?? null, params.thinkingJson ?? null, Date.now()],
  );
  run(`UPDATE sessions SET updated_at = ?, message_count = message_count + 1 WHERE id = ?`,
    [Date.now(), params.sessionId]);
}

export function addMessage(params: {
  sessionId: string; role: "user" | "assistant"; content: string;
  toolUseId?: string; toolName?: string;
  toolUseJson?: string; thinkingJson?: string;
}): void {
  _addMessage(params);
}

export function addAssistantWithThinking(params: {
  sessionId: string; text: string;
  thinking?: { thinking: string; signature: string } | null;
  toolUse?: ToolUseData;
}): void {
  _addMessage({
    sessionId: params.sessionId, role: "assistant", content: params.text,
    thinkingJson: params.thinking ? JSON.stringify(params.thinking) : undefined,
    toolUseJson: params.toolUse ? JSON.stringify(params.toolUse) : undefined,
  });
}

export function addToolResult(params: {
  sessionId: string; toolUseId: string; toolName: string; result: string;
}): void {
  _addMessage({
    sessionId: params.sessionId, role: "user", content: params.result,
    toolUseId: params.toolUseId, toolName: params.toolName,
  });
}

function getRecentMessages(sessionId: string, limit: number): ContextMessage[] {
  const rows = all(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
    [sessionId, limit],
  );
  return rows.reverse().map(rowToContextMessage);
}

export function getContextMessages(
  sessionId: string, maxTurns: number,
): MessageParam[] {
  const messages = getRecentMessages(sessionId, maxTurns * 4 + 20);
  const seenToolUseIds = new Set<string>();

  for (const msg of messages) {
    if (msg.toolUseJson) {
      try { seenToolUseIds.add((JSON.parse(msg.toolUseJson) as ToolUseData).id); } catch { /* skip */ }
    }
  }

  const result: MessageParam[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;

    if (msg.role === "user" && msg.toolUseId) {
      if (!seenToolUseIds.has(msg.toolUseId)) { i++; continue; }
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.toolUseId, content: msg.content }],
      });
      i++; continue;
    }

    if (msg.role === "assistant" && (msg.toolUseJson || msg.thinkingJson)) {
      const blocks: any[] = [];
      if (msg.thinkingJson) {
        try {
          const t = JSON.parse(msg.thinkingJson);
          if (Array.isArray(t)) {
            for (const b of t) blocks.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
          } else {
            blocks.push({ type: "thinking", thinking: t.thinking, signature: t.signature });
          }
        } catch { /* skip */ }
      }
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      if (msg.toolUseJson) {
        try {
          const tu = JSON.parse(msg.toolUseJson) as ToolUseData;
          blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        } catch { /* skip */ }
      }
      if (blocks.length > 0) result.push({ role: "assistant", content: blocks });
      i++; continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else {
      if (msg.thinkingJson) {
        try {
          const t = JSON.parse(msg.thinkingJson);
          const blocks: any[] = [];
          if (Array.isArray(t)) {
            for (const b of t) blocks.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
          } else {
            blocks.push({ type: "thinking", thinking: t.thinking, signature: t.signature });
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

  // Enforce limit, filter orphans
  const maxMsgs = maxTurns * 4 + 10;
  if (result.length > maxMsgs) {
    const sliced = result.slice(result.length - maxMsgs);
    const slicedIds = new Set<string>();
    for (const m of sliced) {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        for (const b of m.content as any[]) {
          if (b.type === "tool_use" && b.id) slicedIds.add(b.id);
        }
      }
    }
    return sliced.filter(m => {
      if (m.role === "user" && Array.isArray(m.content)) {
        for (const b of m.content as any[]) {
          if (b.type === "tool_result" && b.tool_use_id && !slicedIds.has(b.tool_use_id)) return false;
        }
      }
      return true;
    });
  }

  return result;
}

export function clearMessages(sessionId: string): void {
  run(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
  run(`UPDATE sessions SET message_count = 0, updated_at = ? WHERE id = ?`, [Date.now(), sessionId]);
}

export function getMessageCount(sessionId: string): number {
  const row = get(`SELECT COUNT(*) as count FROM messages WHERE session_id = ?`, [sessionId]);
  return (row as any)?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

function rowToSession(row: any): SessionRecord {
  return {
    id: row.id, name: row.name,
    wechatUserId: row.wechat_user_id, accountId: row.account_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
    messageCount: row.message_count, isActive: Boolean(row.is_active),
  };
}

function rowToContextMessage(row: any): ContextMessage {
  return {
    id: row.id, role: row.role,
    content: row.content ?? "",
    toolUseId: row.tool_use_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    toolUseJson: row.tool_use_json ?? undefined,
    thinkingJson: row.thinking_json ?? undefined,
    timestamp: row.timestamp,
  };
}

export function closeStore(): void {
  if (_db) {
    saveDb();
    _db.close();
    _db = null;
  }
}

/** Initialize the DB eagerly (call at startup). */
export async function initStore(): Promise<void> {
  await getDb();
}
