// GET /api/sdr/leads/template
//
// Devolve um arquivo .xlsx (modelo) com as colunas PREENCHÍVEIS da tabela `leads`
// como cabeçalho — pronto para o usuário preencher e importar.
// Colunas de sistema (id, created_at, phone_adjusted, ativo, dealid, ...) são omitidas.
//
// SOMENTE LEITURA: usa apenas SELECT em information_schema. Nunca escreve.

import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { Client } from 'pg'
import * as XLSX from 'xlsx'

const PROVIDER_KEY = 'supabase-n8n'

// Only user-fillable columns — system columns (id, created_at, phone_adjusted, …) are excluded.
const FILLABLE_COLUMNS = ['name', 'phone', 'company', 'source', 'status']

export async function GET() {
  const session = await auth()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  const row = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, PROVIDER_KEY),
    ))
    .then(r => r[0])

  if (!row?.configEnc) {
    return new Response(JSON.stringify({ error: 'fonte_sdr_nao_configurada' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let connectionString: string
  try {
    const cfg = JSON.parse(decrypt(row.configEnc)) as { connectionString?: string }
    if (!cfg.connectionString) throw new Error('connectionString ausente')
    connectionString = cfg.connectionString
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'config_invalid', message: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let columns: string[] = FILLABLE_COLUMNS

  const client = new Client({ connectionString })
  try {
    await client.connect()

    const res = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'leads'
        ORDER BY ordinal_position`,
    )

    if (res.rows.length > 0) {
      const dbCols = new Set(res.rows.map(r => r.column_name.toLowerCase()))
      const intersected = FILLABLE_COLUMNS.filter(c => dbCols.has(c.toLowerCase()))
      // If intersection is empty (schema diverged), fall back to full allowlist
      columns = intersected.length > 0 ? intersected : FILLABLE_COLUMNS
    }
  } catch (err) {
    console.error('[sdr leads template] introspection failed, using fallback', err)
    // columns already set to FILLABLE_COLUMNS
  } finally {
    await client.end().catch(() => {})
  }

  const ws = XLSX.utils.aoa_to_sheet([columns])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Leads')

  // XLSX.write returns a Node Buffer (Uint8Array<ArrayBufferLike>); copy into a plain
  // Uint8Array<ArrayBuffer> so TypeScript accepts it as BodyInit.
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const body    = new Uint8Array(xlsxBuf)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-leads.xlsx"',
    },
  })
}
