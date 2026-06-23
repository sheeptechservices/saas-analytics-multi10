// GET /api/sdr/templates
//
// Lista os templates do YCloud enviáveis pelo fluxo n8n de blast:
// aprovados + idioma pt_BR + exatamente 1 variável no BODY + 0 variáveis fora do BODY.
//
// Response: { items: { nome_template: string, preview: string, fase_envio: null }[] }
// Shape mantido igual ao consumido pelo modal de disparo — sem mudança na UI.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { yCloudProvider, listWhatsappTemplates } from '@/lib/providers/ycloud'

const PROVIDER_KEY = 'ycloud-whatsapp'

/** Counts {{...}} variables in a string. */
function countVars(t: unknown): number {
  return (String(t ?? '').match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).length
}

interface TemplateComponent {
  type?:    unknown
  text?:    unknown
  buttons?: Array<{ text?: unknown; url?: unknown }>
}

function componentVars(comp: TemplateComponent): number {
  let n = countVars(comp.text)
  if (Array.isArray(comp.buttons)) {
    for (const btn of comp.buttons) {
      n += countVars(btn.text) + countVars(btn.url)
    }
  }
  return n
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  let templates: Awaited<ReturnType<typeof listWhatsappTemplates>>
  try {
    templates = await listWhatsappTemplates(cfg)
  } catch (err) {
    return NextResponse.json(
      { error: 'ycloud_error', message: (err as Error).message },
      { status: 502 },
    )
  }

  const items = templates
    .filter(t => {
      if (String(t.status).toLowerCase() !== 'approved') return false
      if (t.language !== 'pt_BR') return false

      const comps = (t.components ?? []) as TemplateComponent[]
      const bodyComps   = comps.filter(c => String(c.type ?? '').toUpperCase() === 'BODY')
      const otherComps  = comps.filter(c => String(c.type ?? '').toUpperCase() !== 'BODY')

      const bodyVars  = bodyComps.reduce((s, c) => s + componentVars(c), 0)
      const otherVars = otherComps.reduce((s, c) => s + componentVars(c), 0)

      return bodyVars === 1 && otherVars === 0
    })
    .map(t => {
      const comps = (t.components ?? []) as TemplateComponent[]
      const body  = comps.find(c => String(c.type ?? '').toUpperCase() === 'BODY')
      return {
        nome_template: t.name,
        preview:       String(body?.text ?? ''),
        fase_envio:    null,
      }
    })
    .sort((a, b) => a.nome_template.localeCompare(b.nome_template))

  return NextResponse.json({ items })
}
