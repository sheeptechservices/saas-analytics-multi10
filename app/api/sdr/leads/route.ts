// GET /api/sdr/leads?q=&source=&status=&page=1&limit=50
//
// Lista leads da tabela `leads` no Supabase (SOMENTE SELECT — nunca escreve).
// Connection string obtida do data_source do tenant (providerKey='supabase-n8n'),
// decifrada em runtime — nunca exposta ao cliente.
//
// Response: { items: LeadItem[], page: number, limit: number, total: number }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { Client } from 'pg'

const PROVIDER_KEY = 'supabase-n8n'
const MAX_LIMIT    = 50

interface LeadRow {
  id:             string
  name:           string | null
  phone:          string | null
  phone_adjusted: string | null
  company:        string | null
  source:         string | null
  status:         string | null
  ativo:          boolean | null
  dealid:         string | null
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const q      = searchParams.get('q')?.trim() ?? ''
  const source = searchParams.get('source')?.trim() ?? ''
  const status = searchParams.get('status')?.trim() ?? ''
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  // Load Supabase connection string from the tenant's data source
  const row = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, PROVIDER_KEY),
    ))
    .then(r => r[0])

  if (!row?.configEnc) {
    return NextResponse.json({ error: 'fonte_sdr_nao_configurada' }, { status: 400 })
  }

  let connectionString: string
  try {
    const cfg = JSON.parse(decrypt(row.configEnc)) as { connectionString?: string }
    if (!cfg.connectionString) throw new Error('connectionString ausente')
    connectionString = cfg.connectionString
  } catch (err) {
    return NextResponse.json(
      { error: 'config_invalid', message: (err as Error).message },
      { status: 500 },
    )
  }

  const client = new Client({ connectionString })
  try {
    await client.connect()

    // Build parameterized WHERE clause — never interpolate user input into SQL
    const conditions: string[] = []
    const params: unknown[]    = []
    let idx = 1

    if (q) {
      conditions.push(`(name ILIKE $${idx} OR phone ILIKE $${idx + 1} OR company ILIKE $${idx + 2})`)
      params.push(`%${q}%`, `%${q}%`, `%${q}%`)
      idx += 3
    }
    if (source) {
      conditions.push(`source = $${idx++}`)
      params.push(source)
    }
    if (status) {
      conditions.push(`status = $${idx++}`)
      params.push(status)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Count (separate query — Postgres planner handles this well on 23k rows)
    const countRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM leads ${where}`,
      params,
    )
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

    // Rows — SELECT only, no writes
    const dataRes = await client.query<LeadRow>(
      `SELECT id, name, phone, phone_adjusted, company, source, status, ativo, dealid
         FROM leads ${where}
        ORDER BY created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    )

    const items = dataRes.rows.map(r => ({
      id:            r.id,
      name:          r.name,
      phone:         r.phone_adjusted ?? r.phone,
      company:       r.company,
      source:        r.source,
      status:        r.status,
      ativo:         r.ativo,
    }))

    return NextResponse.json({ items, page, limit, total })
  } catch (err) {
    console.error('[sdr leads GET]', err)
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 502 },
    )
  } finally {
    await client.end().catch(() => {})
  }
}
