import express from "express"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync } from "node:fs"
import { insertJob, getAllJobs, updateJobStatus, addManualJob, getDbPath } from "./db.js"
import Papa from "papaparse"

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT || 3000)

app.use(express.json({ limit: "5mb" }))

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: getDbPath() })
})

app.get("/api/jobs", (_req, res) => {
  res.json(getAllJobs())
})

app.post("/api/jobs", (req, res) => {
  const row = req.body
  if (!row?.url || !row?.title) return res.status(400).json({ error: "url and title required" })
  const result = addManualJob(row)
  if (result === "error") return res.status(400).json({ error: "could not insert (duplicate url?)" })
  res.json({ ok: true })
})

app.patch("/api/jobs/:url", (req, res) => {
  const { url } = req.params
  const { status, appliedDate, interviewDate } = req.body
  if (!status) return res.status(400).json({ error: "status required" })
  updateJobStatus(url, status, appliedDate ?? null, interviewDate ?? null)
  res.json({ ok: true })
})

app.post("/api/import-csv", (req, res) => {
  const csvText: string = req.body?.csv
  if (!csvText) return res.status(400).json({ error: "csv text required" })
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  let inserted = 0
  let skipped = 0
  for (const row of parsed.data) {
    if (!row.url) continue
    const result = insertJob(row)
    if (result === "inserted") inserted++
    else skipped++
  }
  res.json({ ok: true, inserted, skipped, total: inserted + skipped })
})

// Serve static frontend
const publicDir = join(__dirname, "..", "dist")
if (existsSync(publicDir)) {
  app.use(express.static(publicDir))
  app.use((_req, res) => {
    res.sendFile(join(publicDir, "index.html"))
  })
}

app.listen(PORT, () => {
  console.log(`Job tracker server running → http://localhost:${PORT}`)
  console.log(`SQLite DB: ${getDbPath()}`)
})