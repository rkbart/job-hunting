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
  interviewDate: string
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
  interviewDate: "",
}

const STATUSES = ["New", "Applied", "Interview", "Offer", "Rejected", "Set Aside"]
const TABS = ["All", "Today", ...STATUSES]
const PAGE_SIZE = 12

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
  const [scrolled, setScrolled] = useState(false)

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
    const onScroll = () => setScrolled(window.scrollY > 200)
    window.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

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
      interviewDate: job.interviewDate || "",
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editJob || !editForm.title || !editForm.url) return
    if (editForm.status === "Interview" && !editForm.interviewDate) {
      setError("Interview date is required when status is Interview")
      return
    }
    const now = new Date().toISOString().slice(0, 10)
    await updateJobInDB(editJob.url, {
      title: editForm.title,
      company: editForm.company,
      score: editForm.score,
      verdict: editForm.verdict,
      reason: editForm.reason,
      source: editForm.source,
      status: editForm.status,
      interviewDate: editForm.interviewDate || null,
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
    if (form.status === "Interview" && !form.interviewDate) {
      setError("Interview date is required when status is Interview")
      return
    }

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
      interviewDate: form.interviewDate || null,
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
      <div className="min-h-screen bg-[#ffffff] flex items-center justify-center">
        <p className="text-[#000000] text-[17px]">Loading database…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#ffffff] text-[#000000] font-['Apercu','Helvetica Neue',Helvetica,Arial,sans-serif]">
      <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 md:py-10">
        <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-normal italic tracking-tight" style={{ letterSpacing: "-0.5px", fontFamily: 'Georgia, "Times New Roman", serif' }}>
              Job Sweep Tracker
            </h1>
            <p className="text-[#757575] mt-2 text-[16px] md:text-[17px]">Ranked shortlist — {jobsState.length} roles</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowModal(true)}
              className="px-3 py-1.5 md:px-4 md:py-2 rounded-none bg-white border border-[#000000] text-[14px] sm:text-[16px] hover:border-[#000000] transition"
            >
              + Add manual
            </button>
            <label
              className={`px-3 py-1.5 md:px-4 md:py-2 rounded-none text-[14px] sm:text-[16px] cursor-pointer transition ${importing ? "opacity-50 cursor-not-allowed" : "bg-[#000000] text-white hover:bg-[#1a1a1a]"}`}
            >
              {importing ? "Importing…" : "Import CSV"}
              <input type="file" accept=".csv" className="hidden" disabled={importing} onChange={handleImport} />
            </label>
            <button
              onClick={() => exportJobsToCSV(filtered)}
              className={`px-3 py-1.5 md:px-4 md:py-2 rounded-none text-[14px] sm:text-[16px] cursor-pointer transition ${importing ? "opacity-50 cursor-not-allowed" : "bg-[#000000] text-white hover:bg-[#1a1a1a]"}`}
            >
              Export CSV
            </button>
          </div>
        </header>

        {importResult && (
          <div className="mb-4 rounded-none bg-white border border-[#e0e0e0] text-[#000000] px-5 py-3 text-[15px] flex items-center justify-between">
            <span>Imported: {importResult.inserted} new, {importResult.updated} updated, {importResult.skipped} already tracked</span>
            <button onClick={() => setImportResult(null)} className="underline underline-offset-4 hover:text-[#000000]">
              Dismiss
            </button>
          </div>
        )}

        {error && <p className="text-[#000000] text-[17px] mb-4">{error}</p>}

        <div className="flex flex-wrap gap-1 mb-6">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-none text-[14px] sm:text-[16px] transition ${tab === t ? "bg-[#000000] text-white" : "bg-white border border-[#e0e0e0] text-[#000000] hover:bg-[#f5f5f5]"}`}
            >
              {t} ({counts[t] ?? 0})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="relative flex-1 sm:col-span-2">
            <input
              className="w-full px-4 py-2.5 md:px-5 md:py-2.5 rounded-none bg-white border border-[#e0e0e0] focus:outline-none focus:ring-0 text-[16px] md:text-[17px]"
              placeholder="Search title, company, reason..."
              value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (debounceTimer.current) clearTimeout(debounceTimer.current)
              debounceTimer.current = setTimeout(() => setQ(e.target.value), 300)
            }}          />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[15px] text-[#757575] hover:text-[#000000] cursor-pointer transition" onClick={() => { setQ("") } } aria-label="Clear search">×</span>
          </div>
          <select
            className="w-full px-4 py-2.5 md:px-4 md:py-2.5 rounded-none bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
          >
            <option value="all">All verdicts</option>
            <option value="apply">Apply</option>
            <option value="maybe">Maybe</option>
          </select>
          <select
            className="w-full px-4 py-2.5 md:px-4 md:py-2.5 rounded-none bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All sources</option>
            <option value="Manual">Manual</option>
            <option value="JobStreet">JobStreet</option>
            <option value="Kalibrr">Kalibrr</option>
          </select>
          <div className="flex flex-col gap-1">
            <select
              className="w-full px-4 py-2.5 md:px-4 md:py-2.5 rounded-none bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
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
              className="w-full px-4 py-2.5 md:px-4 md:py-2.5 rounded-none bg-white border border-[#e0e0e0] text-[16px] md:text-[17px]"
            >
              {sortDir === "asc" ? "Asc" : "Desc"}
            </button>
          </div>
        </div>

        {!error && filtered.length === 0 && (
          <p className="text-[#757575] text-[17px]">No jobs match. Try importing a CSV or adding manually.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paged.map((j) => (
            <div key={j.url} className="rounded-none bg-white border border-[#e0e0e0] p-4 md:p-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[18px] md:text-[21px] font-normal italic" style={{ letterSpacing: "-0.28px", fontFamily: 'Georgia, "Times New Roman", serif' }}>
                    {j.title}
                  </h2>
                  <span className={`text-xs px-2 py-0.5 rounded-none ${j.verdict === "apply" ? "bg-[#f5f5f5] text-[#000000]" : "bg-[#f5f5f5] text-[#000000]"}`}>
                    {j.score} · {j.verdict}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-none bg-[#f5f5f5] text-[#757575]">{j.source}</span>
                </div>
                <p className="text-[#000000] mt-1 font-medium">{j.company}</p>
                <p className="text-[14px] text-[#757575] mt-2" style={{ lineHeight: 1.43 }}>
                  {j.reason}
                </p>
                <div className="flex gap-3 mt-2 text-[12px] text-[#757575] flex-wrap">
                  <span>Found: {j.date_found}</span>
                  {j.appliedDate && <span>Applied: {j.appliedDate}</span>}
                  {j.interviewDate && <span>Interview: {j.interviewDate}</span>}
                </div>
                <div className="flex flex-col gap-3 mt-2 sm:flex-row">
                  <div className="flex-1 md:flex-1 max-w-full">
                    <label className="text-[12px] text-[#757575] block mb-1">Applied date</label>
                    <input
                      type="date"
                      className="max-w-full md:w-[160px] px-2 py-1 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={j.appliedDate || ""}
                      onChange={(e) => handleDateChange(j, "appliedDate", e.target.value)}
                    />
                  </div>
                  {j.status === "Interview" && (
                    <div className="flex-1 md:flex-1 max-w-full">
                      <label className="text-[12px] text-[#757575] block mb-1">Interview date</label>
                      <input
                        type="date"
                        className="max-w-full md:w-[160px] px-2 py-1 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                        value={j.interviewDate || ""}
                        onChange={(e) => handleDateChange(j, "interviewDate", e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row mt-3 pt-3 border-t border-[#e0e0e0]">
                  <select
                    className="max-w-full md:w-auto px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={j.status}
                    onChange={(e) => handleStatusChange(j, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-col sm:flex-row gap-2 mt-2 md:mt-0">
                    <button
                      onClick={() => openEditModal(j)}
                      className="max-w-full sm:w-auto px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px] text-[#000000] hover:bg-[#f5f5f5]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(j.url)}
                      className="max-w-full sm:w-auto px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px] text-[#000000] hover:bg-[#f5f5f5]"
                    >
                      Delete
                    </button>
                    <a
                      href={j.url}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-full sm:w-auto px-4 py-1.5 rounded-none bg-[#000000] hover:bg-[#1a1a1a] text-white text-[14px] text-center"
                    >
                      Open ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 mt-6 sm:gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 md:px-4 md:py-1.5 rounded-none bg-white border border-[#e0e0e0] disabled:opacity-40 text-[14px] sm:text-[16px]"
          >
            Prev
          </button>
          <span className="text-sm text-[#757575]">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 md:px-4 md:py-1.5 rounded-none bg-white border border-[#e0e0e0] disabled:opacity-40 text-[14px] sm:text-[16px]"
          >
            Next
          </button>
        </div>

        {scrolled && (
          <button
            onClick={scrollToTop}
            className="fixed bottom-4 right-4 z-40 bg-[#000000] text-white px-4 py-2 rounded-none text-[14px] shadow-md hover:bg-[#1a1a1a] transition"
            aria-label="Back to top"
          >
            ↑ Top
          </button>
        )}

        {showEditModal && editJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-0">
            <div className="bg-white rounded-none p-4 md:p-6 max-w-md w-full mx-auto max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-normal italic mb-4" style={{ letterSpacing: "-0.28px", fontFamily: 'Georgia, "Times New Roman", serif' }}>
                Edit Job
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Company</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.company}
                    onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Score</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={editForm.score}
                      onChange={(e) => setEditForm({ ...editForm, score: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Source</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={editForm.source}
                      onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Verdict</label>
                  <select
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.verdict}
                    onChange={(e) => setEditForm({ ...editForm, verdict: e.target.value })}
                  >
                    <option value="apply">Apply</option>
                    <option value="maybe">Maybe</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Status</label>
                  <select
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
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
                {editForm.status === "Interview" && (
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Interview date</label>
                    <input
                      type="date"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={editForm.interviewDate}
                      onChange={(e) => setEditForm({ ...editForm, interviewDate: e.target.value })}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Reason</label>
                  <textarea
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.reason}
                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">URL</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={editForm.url}
                    onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-6 justify-end">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="w-full sm:w-auto px-4 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[#757575] hover:bg-[#f5f5f5]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="w-full sm:w-auto px-4 py-1.5 rounded-none bg-[#000000] text-white hover:bg-[#1a1a1a]"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-0">
            <div className="bg-white rounded-none p-4 md:p-6 max-w-md w-full mx-auto max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-normal italic mb-4" style={{ letterSpacing: "-0.28px", fontFamily: 'Georgia, "Times New Roman", serif' }}>
                Add Job Manually
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Title *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Company</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">URL *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Source</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.source}
                      onChange={(e) => setForm({ ...form, source: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Score</label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.score}
                      onChange={(e) => setForm({ ...form, score: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Verdict</label>
                    <select
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.verdict}
                      onChange={(e) => setForm({ ...form, verdict: e.target.value })}
                    >
                      <option value="apply">Apply</option>
                      <option value="maybe">Maybe</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Status</label>
                  <select
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
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
                {form.status === "Interview" && (
                  <div>
                    <label className="block text-[12px] text-[#757575] mb-1">Interview date</label>
                    <input
                      type="date"
                      className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                      value={form.interviewDate}
                      onChange={(e) => setForm({ ...form, interviewDate: e.target.value })}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[12px] text-[#757575] mb-1">Reason</label>
                  <textarea
                    className="w-full px-3 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[14px]"
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-6 justify-end">
                <button
                  onClick={() => setShowModal(false)}
                  className="w-full sm:w-auto px-4 py-1.5 rounded-none bg-white border border-[#e0e0e0] text-[#757575] hover:bg-[#f5f5f5]"
                >
                  Cancel
                </button>
                <button
                  onClick={addManual}
                  className="w-full sm:w-auto px-4 py-1.5 rounded-none bg-[#000000] text-white hover:bg-[#1a1a1a]"
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
