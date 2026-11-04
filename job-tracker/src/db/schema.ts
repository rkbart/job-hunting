import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const jobs = sqliteTable('jobs', {
  url: text('url').primaryKey(),
  title: text('title').notNull(),
  company: text('company').notNull().default(''),
  score: text('score').notNull().default('50'),
  verdict: text('verdict').notNull().default('maybe'),
  reason: text('reason').notNull().default(''),
  source: text('source').notNull().default('Manual'),
  status: text('status').notNull().default('New'),
  dateFound: text('date_found').notNull(),
  appliedDate: text('applied_date'),
  interviewDate: text('interview_date'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  importBatch: text('import_batch'),
  importedAt: integer('imported_at', { mode: 'timestamp' }),
}, (t) => ({
  statusIdx: index('jobs_status_idx').on(t.status),
  dateFoundIdx: index('jobs_date_found_idx').on(t.dateFound),
}))

export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
