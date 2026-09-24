import { loadEnv } from './load-env'
loadEnv()
import { getTableName } from 'drizzle-orm'
/* O pool vem de ./index: ele lê DATABASE_URL só no primeiro uso, nunca na
 * importação — então o loadEnv() acima já rodou quando main() consulta. */
import { pool } from './index'
import * as schema from './schema'

// ─── helpers ────────────────────────────────────────────────────────────────

// O drizzle-kit guarda o histórico no schema `drizzle`, e a consulta abaixo já
// filtra por `public` — mas a entrada segue aqui caso uma instalação antiga
// tenha criado a tabela no schema padrão.
const IGNORED_TABLES = new Set(['__drizzle_migrations'])

function isIgnored(name: string) {
  return IGNORED_TABLES.has(name)
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
  // 1. tabelas reais. Equivalente Postgres do "SELECT name FROM sqlite_master
  //    WHERE type='table'": information_schema.tables, restrito ao schema
  //    `public` (é onde o drizzle cria tudo) e a BASE TABLE, para que view e
  //    tabela estrangeira não entrem como se fossem tabela do schema.
  const tablesRes = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  )
  const dbTableNames = tablesRes.rows.map(r => r.table_name).filter(n => !isIgnored(n))

  // 2. colunas de todas as tabelas de uma vez. Equivalente do
  //    PRAGMA table_info(x) — e numa consulta só, em vez de uma por tabela.
  const colsRes = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )
  const dbTables = new Map<string, Set<string>>()
  for (const nome of dbTableNames) dbTables.set(nome, new Set())
  for (const { table_name, column_name } of colsRes.rows) {
    dbTables.get(table_name)?.add(column_name)
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
  console.log(bold('  Drizzle ↔ Postgres schema check'))
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

  await pool.end()
}

main().catch(err => {
  console.error(red('Erro ao executar check-tables:'), err)
  process.exit(1)
})
