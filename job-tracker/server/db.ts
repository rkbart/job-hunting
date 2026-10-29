import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const DB_PATH = process.env.DB_PATH || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tracker.db")

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new DatabaseSync(DB_PATH)
  _db.exec("PRAGMA foreign_keys = ON")
  _db.exec("PRAGMA journal_mode = WAL")
  _db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      url TEXT PRIMARY KEY,
      date_found TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      score TEXT NOT NULL,
      verdict TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'New',
      appliedDate TEXT,
      interviewDate TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return _db
}

export function insertJob(row: Record<string, string>): "inserted" | "skipped" {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO jobs (url, date_found, title, company, score, verdict, reason, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO NOTHING
  `)
  const info = stmt.run(
    row.url,
    row.date_found,
    row.title,
    row.company,
    row.score,
    row.verdict,
    row.reason,
    row.source,
    row.status || "New"
  )
  return info.changes > 0 ? "inserted" : "skipped"
}

export function getAllJobs(): Record<string, string>[] {
  const db = getDb()
  return db.prepare("SELECT * FROM jobs ORDER BY date_found DESC, score DESC").all() as Record<string, string>[]
}

export function updateJobStatus(url: string, status: string, appliedDate?: string | null, interviewDate?: string | null) {
  const db = getDb()
  const sets: string[] = ["status = ?"]
  const vals: any[] = [status]
  if (appliedDate !== undefined) { sets.push("appliedDate = ?"); vals.push(appliedDate) }
  if (interviewDate !== undefined) { sets.push("interviewDate = ?"); vals.push(interviewDate) }
  vals.push(url)
  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE url = ?`).run(...vals)
}

export function addManualJob(row: Record<string, string>): "inserted" | "error" {
  const db = getDb()
  try {
    db.prepare(`
      INSERT INTO jobs (url, date_found, title, company, score, verdict, reason, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.url,
      row.date_found || new Date().toISOString().slice(0, 10),
      row.title,
      row.company || "",
      row.score || "50",
      row.verdict || "maybe",
      row.reason || "",
      row.source || "Manual",
      row.status || "New"
    )
    return "inserted"
  } catch {
    return "error"
  }
}

export function getDbPath() { return DB_PATH }