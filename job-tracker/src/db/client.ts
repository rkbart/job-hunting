import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLocalDrizzle } from 'sqlocal/drizzle'
import * as schema from './schema'
import { runMigrations } from './migrate'

const client = new SQLocalDrizzle('job-tracker.sqlite3')
const { driver, batchDriver } = client

export const db = drizzle(driver, batchDriver, { schema })

// Raw SQLocal client — exposed for file-level operations
export const sqlocalClient = client

// Await this before rendering the app so no component
// can query before the schema exists.
export const migrationsReady = runMigrations(client)
