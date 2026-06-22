// POST /api/ycloud/test-send
//
// Envia um template WhatsApp diretamente via YCloud para uma lista de números
// fornecidos pelo usuário. NÃO usa a fila de campanha (lead_actions).
//
// Body:  { numbers: string[], templateName: string, languageCode?: string, variaveis?: string[] }
// Response: { results: { to, ok, id?, status?, error? }[] }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { yCloudProvider, sendWhatsappMessage } from '@/lib/providers/ycloud'

const PROVIDER_KEY = 'ycloud-whatsapp'
const MODULE_KEY   = 'integration.ycloud-whatsapp'
const E164_RE      = /^\+[1-9]\d{6,14}$/
const MAX_NUMBERS  = 10

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, MODULE_KEY)
  if (denied) return denied

  let body: { numbers?: unknown; templateName?: unknown; languageCode?: unknown; variaveis?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const templateName = typeof body.templateName === 'string' ? body.templateName.trim() : ''
  if (!templateName) {
    return NextResponse.json({ error: 'templateName é obrigatório' }, { status: 400 })
  }

  if (!Array.isArray(body.numbers) || body.numbers.length === 0) {
    return NextResponse.json({ error: 'numbers deve ser um array não vazio' }, { status: 400 })
  }
  if (body.numbers.length > MAX_NUMBERS) {
    return NextResponse.json(
      { error: `máximo de ${MAX_NUMBERS} números por teste` },
      { status: 400 },
    )
  }

  const languageCode =
    typeof body.languageCode === 'string' && body.languageCode
      ? body.languageCode
      : 'pt_BR'

  const variaveis: string[] = Array.isArray(body.variaveis)
    ? body.variaveis.filter((v): v is string => typeof v === 'string')
    : []

  // Load YCloud config for this tenant
  const row = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, PROVIDER_KEY),
    ))
    .then(r => r[0])

  if (!row?.configEnc) {
    return NextResponse.json({ error: 'ycloud_nao_configurado' }, { status: 400 })
  }

  let cfg: ReturnType<typeof yCloudProvider.parseConfig>
  try {
    cfg = yCloudProvider.parseConfig(JSON.parse(decrypt(row.configEnc)))
  } catch (err) {
    return NextResponse.json(
      { error: 'config_invalid', message: (err as Error).message },
      { status: 500 },
    )
  }

  const components = variaveis.length > 0
    ? [{ type: 'body', parameters: variaveis.map(text => ({ type: 'text', text })) }]
    : undefined

  // Send to each number in parallel — per-number errors don't abort the batch
  const results = await Promise.all(
    (body.numbers as unknown[]).map(async (raw) => {
      const to = typeof raw === 'string' ? raw.trim() : ''
      if (!E164_RE.test(to)) {
        return { to: to || String(raw), ok: false, error: 'número inválido (E.164 esperado)' }
      }
      try {
        const sent = await sendWhatsappMessage(cfg, {
          to,
          type:         'template',
          templateName,
          languageCode,
          components,
        })
        return { to, ok: true, id: sent.id, status: sent.status }
      } catch (err) {
        return { to, ok: false, error: (err as Error).message }
      }
    })
  )

  return NextResponse.json({ results })
}
