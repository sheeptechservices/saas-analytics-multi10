// POST /api/sdr/enroll
//
// Inscreve leads na campanha do SDR, criando `lead_actions` na base do cliente.
//
// Isto era um salto pelo n8n (`settings.n8nEnrollUrl`): a app mandava os ids e o
// fluxo escrevia no Supabase montando o SQL com os valores colados no texto. O salto
// saiu — a app escreve direto, com consulta parametrizada (lib/sdr/enroll-write) —
// e com ele saiu a contagem de mentira: `enrolled` era o que o n8n tivesse devolvido,
// quando devolvia, e virava `undefined` no resto das vezes. Agora é o número de
// linhas que o banco realmente criou.
//
// Body:     { leadIds: string[], fase?: string, agendarPara?: string }
// Response: { ok: true, enrolled: number } | { error: string, code?: string, message?: string }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { logAudit } from '@/lib/audit'
import { assertEntitlement } from '@/lib/entitlements'
import { requireTenantUser } from '@/lib/auth-guard'
import { conexaoDoTenant } from '@/lib/sdr/conexao-tenant'
import { CODIGO_CREDENCIAL_SDR_ILEGIVEL } from '@/lib/sdr/mensagens'
import { InscricaoInvalida, inscreverLeads } from '@/lib/sdr/enroll-write'
import { mapSdrDbError } from '@/lib/sdr/pg'

const MAX_LEADS = 100
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  let body: { leadIds?: unknown; fase?: unknown; agendarPara?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds deve ser um array não vazio' }, { status: 400 })
  }
  if (body.leadIds.length > MAX_LEADS) {
    return NextResponse.json({ error: `máximo de ${MAX_LEADS} leads por enrollment` }, { status: 400 })
  }

  // Filter to valid UUIDs — silently drop invalid entries
  const leadIds = (body.leadIds as unknown[])
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'nenhum leadId válido (UUID esperado)' }, { status: 400 })
  }

  const fase        = typeof body.fase === 'string' && body.fase ? body.fase : 'Template 1'
  const agendarPara = typeof body.agendarPara === 'string' && body.agendarPara ? body.agendarPara : undefined

  // Sem fonte cadastrada não há onde gravar — e isto é erro, não um passo a pular:
  // responder "ok" aqui seria dizer que a campanha começou sem ninguém nela. E
  // credencial ilegível não é fonte faltando: mandar cadastrar o que já está
  // cadastrado é conselho que não sai do lugar. 400 e 500, como nas rotas irmãs.
  const fonte = await conexaoDoTenant(tenantId)
  if (fonte.estado === 'nao_configurada') {
    return NextResponse.json({ error: 'fonte_sdr_nao_configurada' }, { status: 400 })
  }
  if (fonte.estado === 'ilegivel') {
    // Código próprio da fonte SDR, não o `config_invalid` genérico: a tela de leads
    // usa o mesmo tradutor para a credencial da YCloud. Ver lib/sdr/mensagens.
    return NextResponse.json({ error: CODIGO_CREDENCIAL_SDR_ILEGIVEL }, { status: 500 })
  }

  try {
    const { inscritos } = await inscreverLeads(fonte.connectionString, { leadIds, fase, agendarPara })

    await logAudit({
      req: request,
      session,
      action: 'enroll',
      metadata: { leadCount: leadIds.length, enrolled: inscritos, fase, agendarPara },
    })

    // `enrolled` pode vir menor que `leadCount`, e sem falha nenhuma: as guardas do
    // INSERT pulam quem não existe mais e quem já tem ação ativa. O número é o que o
    // banco gravou — a tela prefere ver 0 a ver um palpite.
    return NextResponse.json({ ok: true, enrolled: inscritos })
  } catch (err) {
    if (err instanceof InscricaoInvalida) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 })
    }
    // Texto do driver fica no log; o cliente recebe só código estável + português.
    console.error('[sdr enroll]', err)
    const erro = mapSdrDbError(err)
    return NextResponse.json(
      { error: 'db_error', code: erro.code, message: erro.message },
      { status: 502 },
    )
  }
}
