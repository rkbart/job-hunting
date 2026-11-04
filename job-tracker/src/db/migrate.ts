import type { SQLocalDrizzle } from 'sqlocal/drizzle'
import { migrations } from './migrations'

function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function tableHasColumn(client: SQLocalDrizzle, table: string, column: string): Promise<boolean> {
  const rows = await client.sql<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}') WHERE name = '${column}'`
  )
  return rows.length > 0
}

export async function runMigrations(client: SQLocalDrizzle): Promise<void> {
  await client.sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `

  const applied = await client.sql<{ id: string }>`SELECT id FROM _migrations`
  const appliedIds = new Set(applied.map((row) => row.id))

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue

    const statements = splitStatements(migration.sql)

    await client.transaction(async (tx) => {
      for (const statement of statements) {
        try {
          await tx.sql(statement)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : ''
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            continue
          }
          throw err
        }
      }
      await tx.sql`INSERT INTO _migrations (id, applied_at) VALUES (${migration.id}, ${Date.now()})`
    })
  }
}
