import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import type { Database } from "sql.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  wechatUserId: string;
  accountId: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

export type CronCallback = (job: CronJob) => Promise<void>;

// ---------------------------------------------------------------------------
// DB (shared singleton via same sql.js pattern)
// ---------------------------------------------------------------------------

let _db: Database | null = null;

function resolveDbPath(): string {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "cron.db");
}

async function getDb(): Promise<Database> {
  if (_db) return _db;
  const SQL = await initSqlJs();
  const dbPath = resolveDbPath();
  if (fs.existsSync(dbPath)) {
    _db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    _db = new SQL.Database();
  }
  _db.run(`CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, cron_expression TEXT NOT NULL,
    prompt TEXT NOT NULL, wechat_user_id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
    last_run_at INTEGER, next_run_at INTEGER
  )`);
  return _db;
}

function saveDb(): void {
  if (!_db) return;
  fs.writeFileSync(resolveDbPath(), Buffer.from(_db.export()));
}

function run(sql: string, params: any[] = []): void {
  if (!_db) throw new Error("DB not init");
  _db.run(sql, params);
  saveDb();
}

function all(sql: string, params: any[] = []): any[] {
  if (!_db) throw new Error("DB not init");
  const r: any[] = [];
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) r.push(stmt.getAsObject());
  stmt.free();
  return r;
}

// ---------------------------------------------------------------------------
// Cron parser
// ---------------------------------------------------------------------------

function parseCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") { for (let i = min; i <= max; i++) values.add(i); }
    else if (part.includes("/")) {
      const [range, stepStr] = part.split("/") as [string, string];
      const step = parseInt(stepStr!, 10);
      let start = min, end = max;
      if (range !== "*") { [start, end] = range.split("-").map(Number) as [number, number]; }
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes("-")) {
      const [s, e] = part.split("-").map(Number) as [number, number];
      for (let i = s; i <= e; i++) values.add(i);
    } else { values.add(parseInt(part, 10)); }
  }
  return [...values].sort((a, b) => a - b);
}

function getNextRunTime(cronExpression: string, from: Date = new Date()): Date {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Invalid cron: ${cronExpression}`);
  const [mf, hf, df, mof, dwf] = fields as [string, string, string, string, string];
  const mins = parseCronField(mf, 0, 59);
  const hrs = parseCronField(hf, 0, 23);
  const doms = parseCronField(df, 1, 31);
  const mons = parseCronField(mof, 1, 12);
  const dows = parseCronField(dwf, 0, 6);

  const c = new Date(from);
  c.setSeconds(0, 0);
  c.setMinutes(c.getMinutes() + 1);
  const max = new Date(from);
  max.setFullYear(max.getFullYear() + 2);

  while (c <= max) {
    if (mons.includes(c.getMonth() + 1) && doms.includes(c.getDate()) &&
        dows.includes(c.getDay()) && hrs.includes(c.getHours()) && mins.includes(c.getMinutes())) {
      return new Date(c);
    }
    c.setMinutes(c.getMinutes() + 1);
  }
  throw new Error(`No next run for: ${cronExpression}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createCronJob(params: {
  name: string; cronExpression: string; prompt: string;
  wechatUserId: string; accountId: string;
}): Promise<CronJob> {
  await getDb();
  const id = randomUUID();
  const now = Date.now();
  const nextRunAt = getNextRunTime(params.cronExpression).getTime();
  run(`INSERT INTO cron_jobs (id,name,cron_expression,prompt,wechat_user_id,account_id,enabled,created_at,next_run_at)
       VALUES (?,?,?,?,?,?,1,?,?)`,
    [id, params.name, params.cronExpression, params.prompt, params.wechatUserId, params.accountId, now, nextRunAt]);
  return { id, name: params.name, cronExpression: params.cronExpression, prompt: params.prompt,
    wechatUserId: params.wechatUserId, accountId: params.accountId,
    enabled: true, createdAt: now, lastRunAt: null, nextRunAt };
}

export async function listCronJobs(wechatUserId: string): Promise<CronJob[]> {
  await getDb();
  return all(`SELECT * FROM cron_jobs WHERE wechat_user_id = ? ORDER BY created_at DESC`, [wechatUserId]).map(rowToJob);
}

export function deleteCronJobSync(id: string): boolean {
  if (!_db) return false;
  try { run(`DELETE FROM cron_jobs WHERE id = ?`, [id]); return true; } catch { return false; }
}

export function getDueJobsSync(): CronJob[] {
  if (!_db) return [];
  return all(`SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC`, [Date.now()]).map(rowToJob);
}

export function updateJobAfterRunSync(id: string): void {
  if (!_db) return;
  const rows = all(`SELECT * FROM cron_jobs WHERE id = ?`, [id]);
  if (!rows.length) return;
  const job = rowToJob(rows[0]);
  const next = getNextRunTime(job.cronExpression).getTime();
  run(`UPDATE cron_jobs SET last_run_at = ?, next_run_at = ? WHERE id = ?`, [Date.now(), next, id]);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class CronScheduler {
  private interval: NodeJS.Timeout | null = null;
  private callback: CronCallback | null = null;
  private running = false;
  private checkMs: number;

  constructor(checkMs = 30_000) { this.checkMs = checkMs; }

  start(cb: CronCallback): void {
    if (this.running) return;
    this.callback = cb;
    this.running = true;
    // Init DB eagerly
    getDb().then(() => {
      console.log(`⏰ Cron started (every ${this.checkMs / 1000}s)`);
      this.interval = setInterval(() => { void this.tick(); }, this.checkMs);
      void this.tick();
    });
  }

  stop(): void { this.running = false; if (this.interval) { clearInterval(this.interval); this.interval = null; } }

  private async tick(): Promise<void> {
    if (!this.callback || !_db) return;
    try {
      const jobs = getDueJobsSync();
      for (const job of jobs) {
        console.log(`⏰ Cron: ${job.name}`);
        try { await this.callback(job); updateJobAfterRunSync(job.id); }
        catch (e) { console.error(`Cron ${job.name} failed:`, e); updateJobAfterRunSync(job.id); }
      }
    } catch (e) { console.error("Cron tick error:", e); }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToJob(row: any): CronJob {
  return {
    id: row.id, name: row.name, cronExpression: row.cron_expression,
    prompt: row.prompt, wechatUserId: row.wechat_user_id, accountId: row.account_id,
    enabled: Boolean(row.enabled), createdAt: row.created_at,
    lastRunAt: row.last_run_at ?? null, nextRunAt: row.next_run_at ?? null,
  };
}

export function formatCronJob(job: CronJob, index?: number): string {
  const prefix = index !== undefined ? `[${index}] ` : "";
  const next = job.nextRunAt ? new Date(job.nextRunAt).toLocaleString("zh-CN") : "N/A";
  const last = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString("zh-CN") : "never";
  const status = job.enabled ? "✅" : "⏸";
  return `${prefix}${status} **${job.name}**\n   \`${job.cronExpression}\` | Next: ${next} | Last: ${last}`;
}

export function parseNaturalSchedule(text: string): { cronExpression: string; description: string } | null {
  const n = text.toLowerCase().trim();
  const em = n.match(/every\s+(\d+)\s*min/);
  if (em) return { cronExpression: `*/${em[1]} * * * *`, description: `Every ${em[1]} min` };
  const eh = n.match(/every\s+(\d+)\s*hour/);
  if (eh) return { cronExpression: `0 */${eh[1]} * * *`, description: `Every ${eh[1]} hours` };
  const dm = n.match(/(?:daily|every\s+day)\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (dm) {
    let h = parseInt(dm[1]!, 10);
    const min = parseInt(dm[2] ?? "0", 10);
    if (dm[3] === "pm" && h < 12) h += 12;
    if (dm[3] === "am" && h === 12) h = 0;
    return { cronExpression: `${min} ${h} * * *`, description: `Daily ${h}:${String(min).padStart(2, "0")}` };
  }
  if (n.includes("weekday")) {
    const tm = n.match(/(\d{1,2})(?::(\d{2}))?/);
    return { cronExpression: `${tm?.[2] ?? "0"} ${tm?.[1] ?? "9"} * * 1-5`, description: "Weekdays" };
  }
  if (n.includes("hourly")) return { cronExpression: "0 * * * *", description: "Hourly" };
  return null;
}
