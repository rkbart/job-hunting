export const migrations = [
  {
    id: '0001_initial_schema',
    sql: `
CREATE TABLE IF NOT EXISTS jobs (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  score TEXT NOT NULL DEFAULT '50',
  verdict TEXT NOT NULL DEFAULT 'maybe',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Manual',
  status TEXT NOT NULL DEFAULT 'New',
  date_found TEXT NOT NULL,
  applied_date TEXT,
  interview_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_date_found_idx ON jobs(date_found);
`,
  },
  {
    id: '0002_import_tracking',
    sql: `
ALTER TABLE jobs ADD COLUMN import_batch TEXT;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN imported_at INTEGER;
`,
  },
]
