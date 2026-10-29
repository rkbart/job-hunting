import { useEffect, useMemo, useRef, useState } from "react"
import Papa from "papaparse"

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

const STORAGE_KEY = "tracker-jobs"

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

const STATUSES = ["New", "Applied", "Interview", "Offer", "Rejected"]
const TABS = ["All", "Today", ...STATUSES]
const PAGE_SIZE = 10

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
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
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const importStats = useRef<{ inserted: number; skipped: number }>({ inserted: 0, skipped: 0 })
  const [form, setForm] = useState<ManualForm>({ ...INITIAL_FORM })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setJobs(JSON.parse(raw) as Job[])
    } catch {
      setError("Failed to load saved jobs")
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  }, [jobs])

  useEffect(() => {
    setPage(1)
  }, [q, verdict, tab, sourceFilter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModal(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const handleStatusChange = (job: Job, status: string) => {
    const now = new Date().toISOString().slice(0, 10)
    setJobs((prev) =>
      prev.map((j) =>
        j.url === job.url
          ? {
              ...j,
              status,
              appliedDate: status === "Applied" && !j.appliedDate ? now : j.appliedDate ?? null,
              interviewDate: status === "Interview" && !j.interviewDate ? now : j.interviewDate ?? null,
            }
          : j
      )
    )
  }

  const handleDateChange = (job: Job, field: "appliedDate" | "interviewDate", value: string) => {
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

      // Dedupe against the latest state (not the render-time closure) so
      // consecutive imports always compare against what's already saved.
      setJobs((prev) => {
        const existingUrls = new Set(prev.map((j) => j.url))
        const newJobs = parsed.data.filter((j: Job) => j.url && !existingUrls.has(j.url))
        const skipped = parsed.data.filter((j: Job) => !j.url || existingUrls.has(j.url)).length
        importStats.current = { inserted: newJobs.length, skipped }
        return [...newJobs, ...prev]
      })

      setImportResult(importStats.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  const addManual = () => {
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
    setJobs((prev) => [j, ...prev])
    setShowModal(false)
    setForm({ ...INITIAL_FORM })
  }

  const filtered = useMemo(() => {
    const list = jobs
      .filter((j) => {
        if (tab === "All") return true
        if (tab === "Today") return j.date_found === today
        return j.status === tab
      })
      .filter((j) => (verdict === "all" ? true : j.verdict === verdict))
      .filter((j) => (sourceFilter === "all" ? true : j.source === sourceFilter))
      .filter((j) => (q ? (j.title + j.company + j.reason).toLowerCase().includes(q.toLowerCase()) : true))
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
  }, [jobs, q, verdict, tab, sortBy, sortDir, sourceFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: jobs.length }
    c["Today"] = jobs.filter((j) => j.date_found === today).length
    STATUSES.forEach((s) => { c[s] = jobs.filter((j) => j.status === s).length })
    return c
  }, [jobs])

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] font-['SF Pro Text','system-ui','-apple-system',sans-serif]">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight" style={{ letterSpacing: "-0.28px" }}>
              Job Sweep Tracker
            </h1>
            <p className="text-[#7a7a7a] mt-2 text-[17px]">Ranked shortlist — {jobs.length} roles</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowModal(true)}
              className="px-5 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[17px] hover:border-[#0066cc] transition"
            >
              + Add manual
            </button>
            <label
              className={`px-5 py-2.5 rounded-lg text-[17px] cursor-pointer transition ${importing ? "opacity-50 cursor-not-allowed" : "bg-[#0066cc] text-white hover:bg-[#0071e3]"}`}
            >
              {importing ? "Importing…" : "Import CSV"}
              <input type="file" accept=".csv" className="hidden" disabled={importing} onChange={handleImport} />
            </label>
          </div>
        </header>

        {importResult && (
          <div className="mb-4 rounded-lg bg-[#e8f5e9] border border-[#1b5e20] text-[#1b5e20] px-5 py-3 text-[15px] flex items-center justify-between">
            <span>Imported: {importResult.inserted} new, {importResult.skipped} already tracked</span>
            <button onClick={() => setImportResult(null)} className="underline underline-offset-4 hover:text-[#1b5e20]">
              Dismiss
            </button>
          </div>
        )}

        {error && <p className="text-red-600 text-[17px] mb-4">{error}</p>}

        <div className="flex gap-2 mb-4 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm border transition ${tab === t ? "bg-[#0066cc] border-[#0066cc] text-white" : "bg-white border-[#e0e0e0] text-[#1d1d1f] hover:border-[#0066cc]"}`}
            >
              {t} <span className="opacity-70 ml-1">{counts[t]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <input
            className="flex-1 px-5 py-2.5 rounded-lg bg-white border border-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-[17px]"
            placeholder="Search title, company, reason..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[17px]"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
          >
            <option value="all">All verdicts</option>
            <option value="apply">Apply</option>
            <option value="maybe">Maybe</option>
          </select>
          <select
            className="px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[17px]"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All sources</option>
            <option value="Manual">Manual</option>
            <option value="JobStreet">JobStreet</option>
            <option value="Kalibrr">Kalibrr</option>
          </select>
          <select
            className="px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[17px]"
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
            className="px-4 py-2.5 rounded-lg bg-white border border-[#e0e0e0] text-[17px]"
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
        </div>

        {!error && filtered.length === 0 && (
          <p className="text-[#7a7a7a] text-[17px]">No jobs match. Try importing a CSV or adding manually.</p>
        )}

        <div className="grid gap-4">
          {paged.map((j) => (
            <div key={j.url} className="rounded-[8px] bg-white border border-[#e0e0e0] p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[21px] font-semibold" style={{ letterSpacing: "0.231px" }}>
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
                  <div className="mt-2 flex gap-3">
                    <div>
                      <label className="text-[12px] text-[#7a7a7a] block mb-1">Applied date</label>
                      <input
                        type="date"
                        className="px-2 py-1 rounded-[8px] bg-white border border-[#e0e0e0] text-[14px] w-[160px]"
                        value={j.appliedDate || ""}
                        onChange={(e) => handleDateChange(j, "appliedDate", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[12px] text-[#7a7a7a] block mb-1">Interview date</label>
                      <input
                        type="date"
                        className="px-2 py-1 rounded-[8px] bg-white border border-[#e0e0e0] text-[14px] w-[160px]"
                        value={j.interviewDate || ""}
                        onChange={(e) => handleDateChange(j, "interviewDate", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                  <select
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#e0e0e0] text-[14px]"
                    value={j.status}
                    onChange={(e) => handleStatusChange(j, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <a
                    href={j.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#0071e3] text-white text-[14px] text-center"
                  >
                    Open ↗
                  </a>
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
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[8px] p-6 w-full max-w-lg space-y-3">
            <h2 className="text-[21px] font-semibold">Add manual job</h2>
            {(
              [
              "title",
              "company",
              "url",
              "source",
              "score",
              "reason",
            ] as const).map((f) => (
              <label key={f} className="block">
                <span className="text-[12px] text-[#7a7a7a] capitalize">{f}</span>
                <input
                  className="w-full px-4 py-2 rounded-[8px] border border-[#e0e0e0] text-[17px]"
                  placeholder={f}
                  value={form[f]}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                />
              </label>
            ))}
            <div className="flex gap-3">
              <select
                className="flex-1 px-4 py-2 rounded-[8px] border border-[#e0e0e0]"
                value={form.verdict}
                onChange={(e) => setForm({ ...form, verdict: e.target.value })}
              >
                <option value="apply">apply</option>
                <option value="maybe">maybe</option>
              </select>
              <select
                className="flex-1 px-4 py-2 rounded-[8px] border border-[#e0e0e0]"
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
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg border border-[#e0e0e0]">
                Cancel
              </button>
              <button onClick={addManual} className="px-4 py-2 rounded-lg bg-[#0066cc] text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
