import { createClient } from '@libsql/client'
import { getTableName } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as schema from './schema'

// load .env.local so the script works outside of Next.js
try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* .env.local não encontrado — variáveis devem vir do ambiente */ }

// ─── helpers ────────────────────────────────────────────────────────────────

const IGNORED_TABLES = new Set(['__drizzle_migrations', 'sqlite_sequence'])
const IGNORED_PREFIX = 'libsql_'

function isIgnored(name: string) {
  return IGNORED_TABLES.has(name) || name.startsWith(IGNORED_PREFIX)
}

function bold(s: string) { return `\x1b[1m${s}\x1b[0m` }
function green(s: string) { return `\x1b[32m${s}\x1b[0m` }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m` }
function red(s: string) { return `\x1b[31m${s}\x1b[0m` }
function cyan(s: string) { return `\x1b[36m${s}\x1b[0m` }

// ─── extract schema info from drizzle table objects ─────────────────────────

interface SchemaTable {
  name: string
  columns: Set<string>
}

function extractSchemaInfo(): Map<string, SchemaTable> {
  const tables = new Map<string, SchemaTable>()

  for (const [exportKey, value] of Object.entries(schema)) {
    if (!value || typeof value !== 'object') continue

    // drizzle table objects expose getSQL / Symbol(drizzle:Name) — getTableName() handles that
    let tableName: string
    try {
      tableName = getTableName(value as Parameters<typeof getTableName>[0])
    } catch {
      continue // not a table object
    }

    // column names live under the public fields that are column builders
    const columns = new Set<string>()
    for (const [, col] of Object.entries(value as unknown as Record<string, unknown>)) {
      if (col && typeof col === 'object' && 'name' in col && typeof (col as { name: unknown }).name === 'string') {
        const colObj = col as { name: string; columnType?: string }
        // filter out drizzle internals — real columns always have a columnType
        if ('columnType' in colObj) {
          columns.add(colObj.name)
        }
      }
    }

    tables.set(tableName, { name: tableName, columns })
    void exportKey // suppress unused-var
  }

  return tables
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:./data/app.db'
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!process.env.TURSO_DATABASE_URL) {
    console.warn(yellow('⚠  TURSO_DATABASE_URL not set — connecting to local file: ' + url))
  }

  const client = createClient({ url, authToken })

  // 1. fetch real tables
  const tablesRes = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  )
  const dbTableNames = (tablesRes.rows as unknown as Array<{ name: string }>)
    .map(r => r.name)
    .filter(n => !isIgnored(n))

  // 2. fetch columns per table from the db
  const dbTables = new Map<string, Set<string>>()
  for (const tbl of dbTableNames) {
    const colRes = await client.execute(`PRAGMA table_info(${tbl})`)
    const cols = new Set<string>(
      (colRes.rows as unknown as Array<{ name: string }>).map(r => r.name)
    )
    dbTables.set(tbl, cols)
  }

  // 3. extract schema expectations
  const schemaTables = extractSchemaInfo()

  const schemaNames = new Set(schemaTables.keys())
  const dbNames = new Set(dbTables.keys())

  const missing = [...schemaNames].filter(n => !dbNames.has(n))
  const orphan = [...dbNames].filter(n => !schemaNames.has(n))
  const common = [...schemaNames].filter(n => dbNames.has(n))

  const diverged: Array<{ table: string; missingInDb: string[]; missingInSchema: string[] }> = []
  const ok: string[] = []

  for (const tbl of common) {
    const schemaCols = schemaTables.get(tbl)!.columns
    const dbCols = dbTables.get(tbl)!
    const missingInDb = [...schemaCols].filter(c => !dbCols.has(c))
    const missingInSchema = [...dbCols].filter(c => !schemaCols.has(c))
    if (missingInDb.length || missingInSchema.length) {
      diverged.push({ table: tbl, missingInDb, missingInSchema })
    } else {
      ok.push(tbl)
    }
  }

  // ─── report ──────────────────────────────────────────────────────────────

  console.log()
  console.log(bold('══════════════════════════════════════════════════'))
  console.log(bold('  Drizzle ↔ Turso schema check'))
  console.log(bold('══════════════════════════════════════════════════'))
  console.log()

  // MISSING
  console.log(bold(red(`[FALTANDO NO BANCO] (${missing.length})`)))
  if (missing.length === 0) {
    console.log('  nenhuma')
  } else {
    for (const t of missing) {
      console.log(red(`  ✗ ${t}`))
      const cols = schemaTables.get(t)!.columns
      for (const c of cols) console.log(`      col: ${c}`)
    }
  }

  console.log()

  // ORPHAN
  console.log(bold(yellow(`[ÓRFÃS NO BANCO] (${orphan.length})`)))
  if (orphan.length === 0) {
    console.log('  nenhuma')
  } else {
    for (const t of orphan) {
      console.log(yellow(`  ? ${t}`))
      const cols = dbTables.get(t)!
      for (const c of cols) console.log(`      col: ${c}`)
    }
  }

  console.log()

  // DIVERGED
  console.log(bold(yellow(`[DIVERGÊNCIAS DE COLUNAS] (${diverged.length})`)))
  if (diverged.length === 0) {
    console.log('  nenhuma')
  } else {
    for (const { table, missingInDb, missingInSchema } of diverged) {
      console.log(yellow(`  ~ ${table}`))
      for (const c of missingInDb)
        console.log(red(`      ✗ falta no banco: ${c}`))
      for (const c of missingInSchema)
        console.log(cyan(`      + extra no banco (não no schema): ${c}`))
    }
  }

  console.log()

  // OK
  console.log(bold(green(`[OK] (${ok.length})`)))
  for (const t of ok) console.log(green(`  ✓ ${t}`))

  console.log()

  // ─── future suggestions ──────────────────────────────────────────────────

  console.log(bold('══════════════════════════════════════════════════'))
  console.log(bold('  Sugestões de tabelas futuras'))
  console.log(bold('══════════════════════════════════════════════════'))
  console.log()

  const suggestions = [
    {
      table: 'ai_conversations',
      feature: 'SDR-IA (mockado)',
      reason:
        'Armazena o histórico de conversas do assistente AI por tenant/lead, ' +
        'necessário para contexto persistente entre sessões e auditoria.',
    },
    {
      table: 'ai_messages',
      feature: 'SDR-IA (mockado)',
      reason:
        'Mensagens individuais de cada conversa (role: user|assistant, content, tokens). ' +
        'Separa do log de uso para permitir replay e fine-tuning.',
    },
    {
      table: 'marketing_campaigns',
      feature: 'Marketing dashboard (mockado)',
      reason:
        'Campanhas de marketing com métricas (impressões, cliques, custo, período). ' +
        'Base para o dashboard de marketing que hoje retorna dados fixos.',
    },
    {
      table: 'marketing_channel_metrics',
      feature: 'Marketing dashboard (mockado)',
      reason:
        'Métricas diárias por canal (Google Ads, Meta, email…) vinculadas a uma campanha, ' +
        'permitindo séries temporais no dashboard.',
    },
    {
      table: 'lead_activities',
      feature: 'SDR-IA + CRM',
      reason:
        'Histórico de interações de um lead (ligação, email, reunião, mensagem AI). ' +
        'Alimenta o timeline do lead e dá contexto ao SDR-IA sem precisar reprocessar o CRM.',
    },
    {
      table: 'ranking_snapshots',
      feature: 'Equipes e ranking (planejado)',
      reason:
        'Snapshots periódicos de posição dos vendedores para histórico de ranking, ' +
        'evitando recalcular todo o período cada vez que o dashboard carrega.',
    },
  ]

  for (const s of suggestions) {
    console.log(bold(cyan(`  ${s.table}`)) + `  (${s.feature})`)
    console.log(`    ${s.reason}`)
    console.log()
  }

  await client.close()
}

main().catch(err => {
  console.error(red('Erro ao executar check-tables:'), err)
  process.exit(1)
})
