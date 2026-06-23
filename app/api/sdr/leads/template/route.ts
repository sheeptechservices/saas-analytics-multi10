// GET /api/sdr/leads/template
//
// Devolve um .xlsx estilizado (cabeçalho vermelho, texto branco negrito,
// grade de bordas em 100 linhas) com as colunas PREENCHÍVEIS da tabela `leads`.
// Colunas de sistema (id, created_at, phone_adjusted, …) são omitidas.
//
// Geração: exceljs (suporta estilos). Leitura de importação usa xlsx — não alterar.
// SOMENTE LEITURA: usa apenas SELECT em information_schema. Nunca escreve.

import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { Client } from 'pg'
import ExcelJS from 'exceljs'

const PROVIDER_KEY = 'supabase-n8n'
const DATA_ROWS    = 100

// Only user-fillable columns — system columns (id, created_at, phone_adjusted, …) are excluded.
const FILLABLE_COLUMNS = ['name', 'phone', 'company', 'source', 'status']

const COLUMN_WIDTHS: Record<string, number> = {
  name:    28,
  phone:   20,
  company: 28,
  source:  16,
  status:  16,
}

const THIN_BORDER: Partial<ExcelJS.Border> = { style: 'thin' }
const CELL_BORDER: ExcelJS.Borders = {
  top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER,
  diagonal: {},
}

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

  // ── Introspect columns (SOMENTE SELECT) ──────────────────────────────────────
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
      columns = intersected.length > 0 ? intersected : FILLABLE_COLUMNS
    }
  } catch (err) {
    console.error('[sdr leads template] introspection failed, using fallback', err)
  } finally {
    await client.end().catch(() => {})
  }

  // ── Build styled workbook with exceljs ───────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Leads')

  // Column definitions (width + key for cell addressing)
  ws.columns = columns.map(c => ({
    header: c,
    key:    c,
    width:  COLUMN_WIDTHS[c] ?? 18,
  }))

  // Style the header row (row 1)
  const headerRow = ws.getRow(1)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } }
    cell.font      = { color: { argb: 'FFFFFFFF' }, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border    = CELL_BORDER
  })

  // Apply thin-border grid to data rows (rows 2 … DATA_ROWS+1)
  for (let r = 2; r <= DATA_ROWS + 1; r++) {
    const dataRow = ws.getRow(r)
    for (let c = 1; c <= columns.length; c++) {
      dataRow.getCell(c).border = CELL_BORDER
    }
    dataRow.commit()
  }

  // Freeze the header row
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Serialize and return ─────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer()
  // writeBuffer returns Buffer (Uint8Array<ArrayBufferLike>); copy to plain Uint8Array
  // so TypeScript accepts it as BodyInit.
  const body = new Uint8Array(buf)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-leads.xlsx"',
    },
  })
}
