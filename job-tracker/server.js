const express = require("express")
const cors = require("cors")
const Database = require("better-sqlite3")
const path = require("path")
const fs = require("fs")

const app = express()
const PORT = process.env.PORT || 4000

const DB_DIR = path.join(__dirname, "data")
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })
const dbPath = path.join(DB_DIR, "jobs.db")
const db = new Database(dbPath)

db.pragma("journal_mode = WAL")

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    url TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT,
    score TEXT,
    verdict TEXT,
    reason TEXT,
    source TEXT,
    status TEXT,
    date_found TEXT,
    appliedDate TEXT,
    interviewDate TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`)

app.use(cors())
app.use(express.json())

// GET all jobs
app.get("/api/jobs", (req, res) => {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC").all()
  res.json(rows.map(r => ({ ...r, appliedDate: r.appliedDate || null, interviewDate: r.interviewDate || null })))
})

// GET single job
app.get("/api/jobs/:url", (req, res) => {
  const row = db.prepare("SELECT * FROM jobs WHERE url = ?").get(decodeURIComponent(req.params.url))
  if (!row) return res.status(404).json({ error: "not found" })
  res.json({ ...row, appliedDate: row.appliedDate || null, interviewDate: row.interviewDate || null })
})

// CREATE job
app.post("/api/jobs", (req, res) => {
  const { url, title, company, score, verdict, reason, source, status, date_found } = req.body
  if (!url || !title) return res.status(400).json({ error: "url and title required" })
  const existing = db.prepare("SELECT url FROM jobs WHERE url = ?").get(url)
  if (existing) return res.status(409).json({ error: "already exists" })
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO jobs (url, title, company, score, verdict, reason, source, status, date_found, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(url, title, company || "", score || "50", verdict || "maybe", reason || "", source || "Manual", status || "New", date_found || now.slice(0, 10), now)
  res.status(201).json({ url, title, company, score, verdict, reason, source, status, date_found: date_found || now.slice(0, 10), appliedDate: null, interviewDate: null })
})

// UPDATE job (status, dates, or full replace)
app.put("/api/jobs/:url", (req, res) => {
  const url = decodeURIComponent(req.params.url)
  const { status, appliedDate, interviewDate, ...fields } = req.body
  const existing = db.prepare("SELECT * FROM jobs WHERE url = ?").get(url)
  if (!existing) return res.status(404).json({ error: "not found" })

  const updates = []
  const values = []
  if (status !== undefined) { updates.push("status = ?"); values.push(status) }
  if (appliedDate !== undefined) { updates.push("appliedDate = ?"); values.push(appliedDate) }
  if (interviewDate !== undefined) { updates.push("interviewDate = ?"); values.push(interviewDate) }
  if (fields.title !== undefined) { updates.push("title = ?"); values.push(fields.title) }
  if (fields.company !== undefined) { updates.push("company = ?"); values.push(fields.company) }
  if (fields.score !== undefined) { updates.push("score = ?"); values.push(fields.score) }
  if (fields.verdict !== undefined) { updates.push("verdict = ?"); values.push(fields.verdict) }
  if (fields.reason !== undefined) { updates.push("reason = ?"); values.push(fields.reason) }
  if (fields.source !== undefined) { updates.push("source = ?"); values.push(fields.source) }
  if (fields.date_found !== undefined) { updates.push("date_found = ?"); values.push(fields.date_found) }
  updates.push("updated_at = ?"); values.push(new Date().toISOString())
  values.push(url)

  db.prepare(`UPDATE jobs SET ${updates.join(", ")} WHERE url = ?`).run(...values)
  res.json({ ok: true })
})

// DELETE job
app.delete("/api/jobs/:url", (req, res) => {
  const url = decodeURIComponent(req.params.url)
  const info = db.prepare("DELETE FROM jobs WHERE url = ?").run(url)
  res.json({ deleted: info.changes })
})

app.listen(PORT, () => {
  console.log(`Job tracker API server on http://localhost:${PORT}`)
  console.log(`SQLite DB: ${dbPath}`)
})
