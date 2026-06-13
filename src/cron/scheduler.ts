import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  name: string;
  /** Cron expression: minute hour dom month dow */
  cronExpression: string;
  /** Prompt to send to Claude when the job fires */
  prompt: string;
  /** WeChat user ID to deliver results to */
  wechatUserId: string;
  /** Bot account ID */
  accountId: string;
  /** Whether this job is enabled */
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

export type CronCallback = (job: CronJob) => Promise<void>;

// ---------------------------------------------------------------------------
// DB Setup
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "cron.db");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      wechat_user_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER
    );
  `);

  return _db;
}

// ---------------------------------------------------------------------------
// Cron expression parser (standard 5-field: min hour dom month dow)
// ---------------------------------------------------------------------------

function parseCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/") as [string, string];
      const step = parseInt(stepStr!, 10);
      let start = min;
      let end = max;
      if (range !== "*") {
        [start, end] = range.split("-").map(Number) as [number, number];
      }
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number) as [number, number];
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return [...values].sort((a, b) => a - b);
}

function getNextRunTime(cronExpression: string, from: Date = new Date()): Date {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  const [minField, hourField, domField, monthField, dowField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minutes = parseCronField(minField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 6);

  // Start from the next minute
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 2 years ahead
  const maxDate = new Date(from);
  maxDate.setFullYear(maxDate.getFullYear() + 2);

  while (candidate <= maxDate) {
    const month = candidate.getMonth() + 1;
    const day = candidate.getDate();
    const dow = candidate.getDay();
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (
      months.includes(month) &&
      doms.includes(day) &&
      dows.includes(dow) &&
      hours.includes(hour) &&
      minutes.includes(minute)
    ) {
      return new Date(candidate);
    }

    // Advance by 1 minute
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`No next run time found for: ${cronExpression}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createCronJob(params: {
  name: string;
  cronExpression: string;
  prompt: string;
  wechatUserId: string;
  accountId: string;
}): CronJob {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const nextRunAt = getNextRunTime(params.cronExpression).getTime();

  db.prepare(
    `INSERT INTO cron_jobs (id, name, cron_expression, prompt, wechat_user_id, account_id, enabled, created_at, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    params.name,
    params.cronExpression,
    params.prompt,
    params.wechatUserId,
    params.accountId,
    now,
    nextRunAt,
  );

  return {
    id,
    name: params.name,
    cronExpression: params.cronExpression,
    prompt: params.prompt,
    wechatUserId: params.wechatUserId,
    accountId: params.accountId,
    enabled: true,
    createdAt: now,
    lastRunAt: null,
    nextRunAt,
  };
}

export function listCronJobs(wechatUserId: string): CronJob[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM cron_jobs WHERE wechat_user_id = ? ORDER BY created_at DESC`,
    )
    .all(wechatUserId) as any[];
  return rows.map(rowToCronJob);
}

export function deleteCronJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM cron_jobs WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function toggleCronJob(id: string, enabled: boolean): boolean {
  const db = getDb();
  const result = db
    .prepare(`UPDATE cron_jobs SET enabled = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function getDueJobs(): CronJob[] {
  const db = getDb();
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC`,
    )
    .all(now) as any[];
  return rows.map(rowToCronJob);
}

export function updateJobAfterRun(id: string): void {
  const db = getDb();
  const job = db
    .prepare(`SELECT * FROM cron_jobs WHERE id = ?`)
    .get(id) as any;
  if (!job) return;

  const cronJob = rowToCronJob(job);
  const nextRunAt = getNextRunTime(cronJob.cronExpression).getTime();

  db.prepare(
    `UPDATE cron_jobs SET last_run_at = ?, next_run_at = ? WHERE id = ?`,
  ).run(Date.now(), nextRunAt, id);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class CronScheduler {
  private interval: NodeJS.Timeout | null = null;
  private callback: CronCallback | null = null;
  private running = false;
  private checkIntervalMs: number;

  constructor(checkIntervalMs = 30_000) {
    this.checkIntervalMs = checkIntervalMs;
  }

  start(callback: CronCallback): void {
    if (this.running) return;
    this.callback = callback;
    this.running = true;

    console.log(
      `⏰ Cron scheduler started (check every ${this.checkIntervalMs / 1000}s)`,
    );

    this.interval = setInterval(() => {
      void this.tick();
    }, this.checkIntervalMs);

    // Run first tick immediately
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log("⏰ Cron scheduler stopped");
  }

  private async tick(): Promise<void> {
    if (!this.callback) return;

    try {
      const dueJobs = getDueJobs();
      for (const job of dueJobs) {
        console.log(`⏰ Cron firing: ${job.name} (${job.id.slice(0, 8)}...)`);
        try {
          await this.callback(job);
          updateJobAfterRun(job.id);
          console.log(`✅ Cron done: ${job.name}`);
        } catch (err) {
          console.error(`❌ Cron job ${job.name} failed:`, err);
          // Still update next run time to avoid infinite retries
          updateJobAfterRun(job.id);
        }
      }
    } catch (err) {
      console.error("Cron tick error:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToCronJob(row: any): CronJob {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    prompt: row.prompt,
    wechatUserId: row.wechat_user_id,
    accountId: row.account_id,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastRunAt: row.last_run_at ?? null,
    nextRunAt: row.next_run_at ?? null,
  };
}

/** Format cron job for display */
export function formatCronJob(job: CronJob, index?: number): string {
  const prefix = index !== undefined ? `[${index}] ` : "";
  const nextRun = job.nextRunAt
    ? new Date(job.nextRunAt).toLocaleString("zh-CN")
    : "N/A";
  const lastRun = job.lastRunAt
    ? new Date(job.lastRunAt).toLocaleString("zh-CN")
    : "never";
  const status = job.enabled ? "✅" : "⏸";

  return [
    `${prefix}${status} **${job.name}**`,
    `   Schedule: \`${job.cronExpression}\``,
    `   Prompt: ${job.prompt.slice(0, 80)}${job.prompt.length > 80 ? "..." : ""}`,
    `   Next: ${nextRun} | Last: ${lastRun}`,
  ].join("\n");
}

/** Parse natural language cron from Claude's tool call (simple mapping) */
export function parseNaturalSchedule(text: string): {
  cronExpression: string;
  description: string;
} | null {
  const normalized = text.toLowerCase().trim();

  // Every N minutes
  const everyMinMatch = normalized.match(/every\s+(\d+)\s*min/);
  if (everyMinMatch) {
    const min = parseInt(everyMinMatch[1]!, 10);
    return {
      cronExpression: `*/${min} * * * *`,
      description: `Every ${min} minutes`,
    };
  }

  // Every N hours
  const everyHourMatch = normalized.match(/every\s+(\d+)\s*hour/);
  if (everyHourMatch) {
    const hours = parseInt(everyHourMatch[1]!, 10);
    return {
      cronExpression: `0 */${hours} * * *`,
      description: `Every ${hours} hours`,
    };
  }

  // Daily at specific time
  const dailyMatch = normalized.match(/(?:daily|every\s+day)\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (dailyMatch) {
    let hour = parseInt(dailyMatch[1]!, 10);
    const minute = parseInt(dailyMatch[2] ?? "0", 10);
    const ampm = dailyMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return {
      cronExpression: `${minute} ${hour} * * *`,
      description: `Daily at ${hour}:${String(minute).padStart(2, "0")}`,
    };
  }

  // Weekdays
  if (normalized.includes("weekday") || normalized.includes("week day")) {
    const timeMatch = normalized.match(/(\d{1,2})(?::(\d{2}))?/);
    const hour = timeMatch ? parseInt(timeMatch[1]!, 10) : 9;
    const minute = timeMatch ? parseInt(timeMatch[2] ?? "0", 10) : 0;
    return {
      cronExpression: `${minute} ${hour} * * 1-5`,
      description: `Weekdays at ${hour}:${String(minute).padStart(2, "0")}`,
    };
  }

  // Hourly
  if (normalized.includes("hourly")) {
    return { cronExpression: "0 * * * *", description: "Hourly" };
  }

  return null;
}
