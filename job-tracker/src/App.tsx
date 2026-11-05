import { useEffect, useMemo, useRef, useState } from "react"
import Papa from "papaparse"
import { db, migrationsReady } from "./db/client"
import { jobs } from "./db/schema"
import { eq } from "drizzle-orm"

type Job = {
  date_found: string
  title: string
  company: string
  score: string
  verdict: string
  reason: string
  url: string
  source: string
  status: string
  appliedDate?: string | null
  interviewDate?: string | null
}

type ManualForm = {
  title: string
  company: string
  url: string
  source: string
  score: string
  reason: string
  status: string
  verdict: string
}

const INITIAL_FORM: ManualForm = {
  title: "",
  company: "",
  url: "",
  source: "Manual",
  score: "50",
  reason: "",
  status: "New",
  verdict: "maybe",
}

const STATUSES = ["New", "Applied", "Interview", "Offer", "Rejected", "Set Aside"]
const TABS = ["All", "Today", ...STATUSES]
const PAGE_SIZE = 10

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    date_found: normalizeDate(row.dateFound) || new Date().toISOString().slice(0, 10),
    title: row.title,
    company: row.company,
    score: row.score,
    verdict: row.verdict,
    reason: row.reason,
    url: row.url,
    source: row.source,
    status: row.status,
    appliedDate: row.appliedDate ?? null,
    interviewDate: row.interviewDate ?? null,
  }
}

async function loadJobsFromDB(): Promise<Job[]> {
  const rows = await db.select().from(jobs)
  return rows.map(rowToJob)
}

async function saveJobToDB(j: Job) {
  await db.insert(jobs).values({
    url: j.url,
    title: j.title,
    company: j.company,
    score: j.score,
    verdict: j.verdict,
    reason: j.reason,
    source: j.source,
    status: j.status,
    dateFound: j.date_found,
    appliedDate: j.appliedDate ?? null,
    interviewDate: j.interviewDate ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing()
}

async function updateJobInDB(url: string, patch: Partial<Job>) {
  const values: Record<string, any> = { updatedAt: new Date() }
  if (patch.status !== undefined) values.status = patch.status
  if (patch.appliedDate !== undefined) values.appliedDate = patch.appliedDate ?? null
  if (patch.interviewDate !== undefined) values.interviewDate = patch.interviewDate ?? null
  if (patch.title !== undefined) values.title = patch.title
  if (patch.company !== undefined) values.company = patch.company
  if (patch.score !== undefined) values.score = patch.score
  if (patch.verdict !== undefined) values.verdict = patch.verdict
  if (patch.reason !== undefined) values.reason = patch.reason
  if (patch.source !== undefined) values.source = patch.source
  if (patch.date_found !== undefined) values.dateFound = patch.date_found

  await db.update(jobs).set(values).where(eq(jobs.url, url))
}

async function deleteJob(url: string) {
  await db.delete(jobs).where(eq(jobs.url, url))
}

async function importJobsToDB(jobsList: Job[]) {
  const now = new Date()
  for (const j of jobsList) {
    await db.insert(jobs).values({
      url: j.url,
      title: j.title,
      company: j.company,
      score: j.score,
      verdict: j.verdict,
      reason: j.reason,
      source: j.source,
      status: j.status,
      dateFound: j.date_found,
      appliedDate: j.appliedDate ?? null,
      interviewDate: j.interviewDate ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()
  }
}

// Export jobs from the database to a CSV file for download
async function exportJobsToCSV(jobsList?: Job[]) {
  const allJobs = jobsList ?? (await loadJobsFromDB())
  const headers = ['url', 'title', 'company', 'score', 'verdict', 'reason', 'source', 'status', 'date_found', 'appliedDate', 'interviewDate', 'importBatch', 'importedAt']
  const rows = allJobs.map(j => [
    j.url, j.title, j.company, j.score, j.verdict, j.reason, j.source, j.status,
    j.date_found, j.appliedDate ?? '', j.interviewDate ?? '', j.importBatch ?? '', j.importedAt ?? ''
  ])
  const bodyRows = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))
  const csv = [headers.join(','), ...bodyRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.setAttribute('href', url)
  a.setAttribute('download', `job-tracker-export-all-${new Date().toISOString().slice(0, 10)}.csv`)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function App() {
  const [jobsState, setJobs] = useState<Job[]>([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState("")
  const [verdict, setVerdict] = useState("all")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [tab, setTab] = useState("New")
  const [page, setPage] = useState(1)
  const today = new Date().toISOString().slice(0, 10)
  const [showModal, setShowModal] = useState(false)
  const [sortBy, setSortBy] = useState("score")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; updated: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const importBatchRef = useRef<string>("")
  const [importPreview, setImportPreview] = useState<{ newJobs: Job[]; updates: Job[]; skipped: number; headers: string[] } | null>(null)
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [showErrorToast, setShowErrorToast] = useState(false)
  const errorMessage = useRef<string | null>(null)
  const [uniqueSources, setUniqueSources] = useState<string[]>([])
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  const importStats = useRef<{ inserted: number; skipped: number; updated: number }>({ inserted: 0, skipped: 0, updated: 0 })
  const [form, setForm] = useState<ManualForm>({ ...INITIAL_FORM })
  const [editJob, setEditJob] = useState<Job | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState<ManualForm>({ ...INITIAL_FORM })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        await migrationsReady
        if (!mounted) return
        const rows = await loadJobsFromDB()
        setJobs(rows)
        setLoaded(true)
      } catch {
        setError("Failed to load saved jobs")
        setLoaded(true)
      }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [q, verdict, tab, sourceFilter])

  useEffect(() => {
    const timeoutId = setTimeout(() => {}
    , 300)
    return () => clearTimeout(timeoutId)
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowModal(false)
        setShowEditModal(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const handleStatusChange = async (job: Job, status: string) => {
    const now = new Date().toISOString().slice(0, 10)
    const patch: Partial<Job> = {
      status,
      appliedDate: status === "Applied" && !job.appliedDate ? now : job.appliedDate ?? null,
      interviewDate: status === "Interview" && !job.interviewDate ? now : job.interviewDate ?? null,
    }
    await updateJobInDB(job.url, patch)
    setJobs((prev) =>
      prev.map((j) =>
        j.url === job.url ? { ...j, ...patch } : j
      )
    )
  }

  const handleDelete = async (url: string) => {
    if (!confirm("Delete this job?")) return
    await deleteJob(url)
    setJobs((prev) => prev.filter((j) => j.url !== url))
  }

  const openEditModal = (job: Job) => {
    setEditJob(job)
    setEditForm({
      title: job.title,
      company: job.company,
      url: job.url,
      source: job.source,
      score: job.score,
      reason: job.reason,
      status: job.status,
      verdict: job.verdict,
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editJob || !editForm.title || !editForm.url) return
    const now = new Date().toISOString().slice(0, 10)
    await updateJobInDB(editJob.url, {
      title: editForm.title,
      company: editForm.company,
      score: editForm.score,
      verdict: editForm.verdict,
      reason: editForm.reason,
      source: editForm.source,
      status: editForm.status,
      date_found: now,
    })
    setJobs((prev) =>
      prev.map((j) => (j.url === editJob.url ? { ...j, ...editForm, date_found: now } : j))
    )
    setShowEditModal(false)
    setEditJob(null)
  }

  const handleDateChange = async (job: Job, field: "appliedDate" | "interviewDate", value: string) => {
    const patch: Partial<Job> = { [field]: value || null }
    await updateJobInDB(job.url, patch)
    setJobs((prev) =>
      prev.map((j) => (j.url === job.url ? { ...j, [field]: value || null } : j))
    )
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    ;(e.target as HTMLInputElement).value = ""
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ""))
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"))
        reader.readAsText(file)
      })
      const parsed = Papa.parse<Job>(text, { header: true, skipEmptyLines: true })

      const existingUrls = new Set(jobsState.map((j) => j.url))
      const newJobs: Job[] = []
      let skipped = 0
      let updated = 0

      for (const j of parsed.data) {
        if (!j.url) { skipped++; continue }
        if (existingUrls.has(j.url)) {
          skipped++
          if (j.status !== "New") {
            await updateJobInDB(j.url, {
              title: j.title,
              company: j.company,
              score: j.score,
              verdict: j.verdict,
              reason: j.reason,
              source: j.source,
              date_found: j.date_found,
            })
            updated++
          }
        } else {
          newJobs.push(j)
        }
      }

      if (newJobs.length > 0) {
        await importJobsToDB(newJobs)
      }

      importStats.current = { inserted: newJobs.length, skipped, updated }
      setJobs(await loadJobsFromDB())
      setImportResult(importStats.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  const addManual = async () => {
    if (!form.title || !form.url) return

    const j: Job = {
      date_found: new Date().toISOString().slice(0, 10),
      title: form.title,
      company: form.company || "",
      score: form.score || "50",
      verdict: form.verdict || "maybe",
      reason: form.reason || "",
      url: form.url,
      source: form.source || "Manual",
      status: form.status || "New",
    }
    await saveJobToDB(j)
    setJobs((prev) => [j, ...prev])
    setShowModal(false)
    setForm({ ...INITIAL_FORM })
  }

  const filtered = useMemo(() => {
    let list = jobsState
    if (tab === "Today") {
      list = list.filter((j) => j.date_found === today)
    } else if (tab !== "All") {
      list = list.filter((j) => j.status === tab)
    }
    list = list.filter((j) => (verdict === "all" ? true : j.verdict === verdict))
    list = list.filter((j) => (sourceFilter === "all" ? true : j.source === sourceFilter))
    list = list.filter((j) => {
      if (!q) return true
      const searchable = `${j.title} ${j.company} ${j.reason} ${j.url} ${j.source}`.toLowerCase()
      return searchable.includes(q.toLowerCase())
    })
    list.sort((a, b) => {
      let va: any, vb: any
      if (sortBy === "score") { va = Number(a.score); vb = Number(b.score) }
      else if (sortBy === "found") { va = a.date_found; vb = b.date_found }
      else if (sortBy === "applied") { va = a.appliedDate || ""; vb = b.appliedDate || "" }
      else { va = a.title; vb = b.title }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return list
  }, [jobsState, q, verdict, tab, sortBy, sortDir, sourceFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: jobsState.length }
    c["Today"] = jobsState.filter((j) => j.date_found === today).length
    STATUSES.forEach((s) => { c[s] = jobsState.filter((j) => j.status === s).length })
    return c
  }, [jobsState])

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <p className="text-[#1d1d1f] text-[17px]">Loading database…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] font-['SF Pro Text','system-ui','-apple-system',sans-serif]">
      <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 md:py-10">
        <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight" style={{ letterSpacing: "-0.28px" }}>
              Job Sweep Tracker
            </h1>
            <p className="text-[#7a7a7a] mt-2 text-[16px] md:text-[17px]">Ranked shortlist — {jobsState.length} roles</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 md:px-5 md:py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[16px] md:text-[17px] hover:border-[#0066cc] transition"
            >
              + Add manual
            </button>
            <label
              className={`px-4 py-2 md:px-5 md:py-2.5 rounded-lg text-[16px] md:text-[17px] cursor-pointer transition ${importing ? "opacity-50 cursor-not-allowed" : "bg-[#0066cc] text-white hover:bg-[#0071e3]"}`}
            >
              {importing ? "Importing…" : "Import CSV"}
              <input type="file" accept=".csv" className="hidden" disabled={importing} onChange={handleImport} />
            </label>
            <button
              onClick={() => exportJobsToCSV(filtered)}
              className={`px-4 py-2 md:px-5 md:py-2.5 rounded-lg text-[16px] md:text-[17px] cursor-pointer transition ${importing ? "opacity-50 cursor-not-allowed" : "bg-[#0066cc] text-white hover:bg-[#0071e3]"}`}
            >
              Export CSV
            </button>
          </div>
        </header>

        {importResult && (
          <div className="mb-4 rounded-lg bg-[#e8f5e9] border border-[#1b5e20] text-[#1b5e20] px-5 py-3 text-[15px] flex items-center justify-between">
            <span>Imported: {importResult.inserted} new, {importResult.updated} updated, {importResult.skipped} already tracked</span>
            <button onClick={() => setImportResult(null)} className="underline underline-offset-4 hover:text-[#1b5e20]">
              Dismiss
            </button>
          </div>
        )}

        {error && <p className="text-red-600 text-[17px] mb-4">{error}</p>}

        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <input
              className="w-full px-4 py-2.5 md:px-5 md:py-2.5 rounded-lg bg-white border border-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-[16px] md:text-[17px]"
              placeholder="Search title, company, reason..."
              value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (debounceTimer.current) clearTimeout(debounceTimer.current)
              debounceTimer.current = setTimeout(() => setQ(e.target.value), 300)
            }}          />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[15px] text-[#7a7a7a] hover:text-[#1d1d1f] cursor-pointer transition" onClick={() => { setQ("") } } aria-label="Clear search">×</span>
          </div>
          <select
            className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
          >
            <option value="all">All verdicts</option>
            <option value="apply">Apply</option>
            <option value="maybe">Maybe</option>
          </select>
          <select
            className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All sources</option>
            <option value="Manual">Manual</option>
            <option value="JobStreet">JobStreet</option>
            <option value="Kalibrr">Kalibrr</option>
          </select>
          <select
            className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="score">Score</option>
            <option value="found">Date found</option>
            <option value="applied">Date applied</option>
            <option value="title">Title</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
        </div>

        {!error && filtered.length === 0 && (
          <p className="text-[#7a7a7a] text-[17px]">No jobs match. Try importing a CSV or adding manually.</p>
        )}

        <div className="grid gap-4">
          {paged.map((j) => (
            <div key={j.url} className="rounded-[8px] bg-white border border-[#e0e0e0] p-4 md:p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[18px] md:text-[21px] font-semibold" style={{ letterSpacing: "0.231px" }}>
                      {j.title}
                    </h2>
                    <span className={`text-xs px-2 py-0.5 rounded-lg ${j.verdict === "apply" ? "bg-[#e8f5e9] text-[#1b5e20]" : "bg-[#fff3e0] text-[#e65100]"}`}>
                      {j.score} · {j.verdict}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-lg bg-[#f5f5f7] text-[#7a7a7a]">{j.source}</span>
                  </div>
                  <p className="text-[#1d1d1f] mt-1 font-medium">{j.company}</p>
                  <p className="text-[14px] text-[#7a7a7a] mt-2" style={{ lineHeight: 1.43 }}>
                    {j.reason}
                  </p>
                  <div className="flex gap-3 mt-2 text-[12px] text-[#7a7a7a] flex-wrap">
                    <span>Found: {j.date_found}</span>
                    {j.appliedDate && <span>Applied: {j.appliedDate}</span>}
                    {j.interviewDate && <span>Interview: {j.interviewDate}</span>}
                  </div>
                  <div className="flex gap-3 mt-2 flex-col md:flex-row">
                    <div className="flex-1 md:flex-1">
                      <label className="text-[12px] text-[#7a7a7a] block mb-1">Applied date</label>
                      <input
                        type="date"
                        className="w-full md:w-[160px] px-2 py-1 rounded-[8px] bg-white border border-[#e0e0e0] text-[14px]"
                        value={j.appliedDate || ""}
                        onChange={(e) => handleDateChange(j, "appliedDate", e.target.value)}
                      />
                    </div>
                    <div className="flex-1 md:flex-1">
                      <label className="text-[12px] text-[#7a7a7a] block mb-1">Interview date</label>
                      <input
                        type="date"
                        className="w-full md:w-[160px] px-2 py-1 rounded-[8px] bg-white border border-[#e0e0e0] text-[14px]"
                        value={j.interviewDate || ""}
                        onChange={(e) => handleDateChange(j, "interviewDate", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 md:items-end w-full md:w-auto">
                  <select
                    className="w-full md:w-auto px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={j.status}
                    onChange={(e) => handleStatusChange(j, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1 mt-1 md:mt-0">
                    <button
                      onClick={() => openEditModal(j)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px] text-[#0066cc] hover:bg-[#f5f5f7]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(j.url)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px] text-[#d32f2f] hover:bg-[#fdecea]"
                    >
                      Delete
                    </button>
                    <a
                      href={j.url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full md:w-auto px-4 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#0071e3] text-white text-[14px] text-center"
                    >
                      Open ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-4 py-1.5 rounded-lg bg-white border border-[#e0e0e0] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-sm text-[#7a7a7a]">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-4 py-1.5 rounded-lg bg-white border border-[#e0e0e0] disabled:opacity-40"
          >
            Next
          </button>
        </div>

        {showEditModal && editJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 md:p-0">
            <div className="bg-white rounded-[8px] p-4 md:p-6 max-w-md w-full mx-auto shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-4">Edit Job</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Company</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.company}
                    onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#7a7a7a] mb-1">Score</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                      value={editForm.score}
                      onChange={(e) => setEditForm({ ...editForm, score: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#7a7a7a] mb-1">Source</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                      value={editForm.source}
                      onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Verdict</label>
                  <select
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.verdict}
                    onChange={(e) => setEditForm({ ...editForm, verdict: e.target.value })}
                  >
                    <option value="apply">Apply</option>
                    <option value="maybe">Maybe</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Status</label>
                  <select
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Reason</label>
                  <textarea
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.reason}
                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">URL</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.url}
                    onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[#7a7a7a] hover:bg-[#f5f5f7]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-1.5 rounded-lg bg-[#0066cc] text-white hover:bg-[#0071e3]"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 md:p-0">
            <div className="bg-white rounded-[8px] p-4 md:p-6 max-w-md w-full mx-auto shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-4">Add Job Manually</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Title *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Company</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#7a7a7a] mb-1">URL *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#7a7a7a] mb-1">Source</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.source}
                      onChange={(e) => setForm({ ...form, source: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#7a7a7a] mb-1">Score</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.score}
                      onChange={(e) => setForm({ ...form, score: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#7a7a7a] mb-1">Verdict</label>
                    <select
                      className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.verdict}
                      onChange={(e) => setForm({ ...form, verdict: e.target.value })}
                    >
                      <option value="apply">Apply</option>
                      <option value="maybe">Maybe</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Status</label>
                  <select
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-[#7a7a7a] mb-1">Reason</label>
                  <textarea
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[#7a7a7a] hover:bg-[#f5f5f7]"
                >
                  Cancel
                </button>
                <button
                  onClick={addManual}
                  className="px-4 py-1.5 rounded-lg bg-[#0066cc] text-white hover:bg-[#0071e3]"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}