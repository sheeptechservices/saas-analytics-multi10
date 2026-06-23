// GET /api/sdr/templates
//
// Lista os templates aprovados (meta_templates_whatsapp) no Supabase para o modal
// de disparo escolher. Connection string obtida do data_source do tenant
// (providerKey='supabase-n8n'), decifrada em runtime — nunca exposta ao cliente.
//
// SOMENTE LEITURA: apenas SELECT. Nunca escreve no Supabase.
//
// Response: { items: { nome_template: string, preview: string, fase_envio: string|null }[] }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { Client } from 'pg'

const PROVIDER_KEY = 'supabase-n8n'

interface TemplateRow {
  nome_template:     string
  mensagem_template: string | null
  fase_envio:        string | null
  rank_disparo:      number | null
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

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

    // SELECT only — never writes
    const res = await client.query<TemplateRow>(
      `SELECT nome_template, mensagem_template, fase_envio, rank_disparo
         FROM meta_templates_whatsapp
        WHERE nome_template IS NOT NULL
          AND COALESCE(mensagem_template, '') <> ''
        ORDER BY rank_disparo NULLS LAST, nome_template`,
    )

    const items = res.rows.map(r => ({
      nome_template: r.nome_template,
      preview:       r.mensagem_template ?? '',
      fase_envio:    r.fase_envio,
    }))

    return NextResponse.json({ items })
  } catch (err) {
    console.error('[sdr templates GET]', err)
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 502 },
    )
  } finally {
    await client.end().catch(() => {})
  }
}
