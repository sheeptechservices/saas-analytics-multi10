// POST /api/sdr/leads/manual
//
// Recebe UM lead em JSON, deduplica contra a base do cliente e grava lá mesmo.
//
// A gravação era um salto HTTP para o `n8nImportUrl` — o mesmo webhook da
// importação por planilha, que foi o último a sair. Hoje a app escreve direto
// (lib/sdr/leads-write), pelo mesmo caminho e com as mesmas decisões de
// /api/sdr/leads/import. O que muda para quem cadastra um lead: o `leadId` que
// volta é o que o INSERT devolveu. Antes era o que o n8n tivesse dito — e, quando
// ele respondia sem `ids`, a resposta saía `ok: true` com `leadId: null` e a tela
// seguia com um lead que não dava para inscrever nem disparar.
//
// Request body: { name: string, phone: string, company?: string }
//
// Responses:
//   200  { ok: true, leadId, duplicate: true,  name }    — já existia na base
//   200  { ok: true, leadId, duplicate: false, name }    — gravado agora
//   400  { error }                                       — validação, ou fonte sem cadastro
//   409  { ok: false, error: 'telefone_ja_cadastrado' }  — o INSERT pulou a linha
//   500  { error: 'credencial_sdr_ilegivel' }            — credencial cadastrada que não abre
//   502  { ok: false, error: 'db_error', code, message } — a base do cliente recusou

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { logAudit } from '@/lib/audit'
import { assertEntitlement } from '@/lib/entitlements'
import { requireTenantUser } from '@/lib/auth-guard'
import { conexaoDoTenant } from '@/lib/sdr/conexao-tenant'
import { CODIGO_CREDENCIAL_SDR_ILEGIVEL } from '@/lib/sdr/mensagens'
import { gravarLeads, limparParaPostgres } from '@/lib/sdr/leads-write'
import { mapSdrDbError, withSdrDb } from '@/lib/sdr/pg'
import { normalizePhone, phoneKey } from '@/lib/sdr/leads-etl'

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Esta rota escreve na base do cliente (INSERT de lead), então precisa da mesma
  // porta das irmãs que escrevem — /api/sdr/leads/import e /api/sdr/enroll: ter
  // sessão não basta. lib/auth-guard.test.ts prende qual rota chama qual porta.
  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  // `limparParaPostgres` tira o byte NUL e o surrogate solto, como na importação:
  // a gravação limpa de novo, mas o `name` que volta daqui é o que a tela usa como
  // nome do destinatário no disparo seguinte — e ele tem de ser o mesmo que a base
  // guardou.
  const texto = (valor: unknown) =>
    typeof valor === 'string' ? limparParaPostgres(valor).trim() : ''

  const name     = texto(body.name)
  const rawPhone = texto(body.phone)
  const company  = texto(body.company)

  if (!name) {
    return NextResponse.json({ error: 'nome_obrigatorio' }, { status: 400 })
  }

  const phone = normalizePhone(rawPhone)
  if (!phone) {
    return NextResponse.json({ error: 'telefone_invalido' }, { status: 400 })
  }

  const key = phoneKey(phone)
  if (!key) {
    return NextResponse.json({ error: 'telefone_invalido' }, { status: 400 })
  }

  // ── Conexão do cliente: resolvida UMA vez, usada na dedup e na gravação ───────
  // Sem base não há onde gravar, e dizer "lead adicionado" sem ter escrito seria
  // mentir. As duas recusas continuam separadas — 400 para quem ainda não cadastrou
  // a fonte, 500 para a credencial que existe e não abre —, como em
  // /api/sdr/leads/import e /api/sdr/enroll. Ver lib/sdr/conexao-tenant.
  const fonte = await conexaoDoTenant(tenantId)
  if (fonte.estado === 'nao_configurada') {
    return NextResponse.json({ error: 'fonte_sdr_nao_configurada' }, { status: 400 })
  }
  if (fonte.estado === 'ilegivel') {
    // Código próprio da fonte SDR, não o `config_invalid` genérico: a tela de leads
    // usa o mesmo tradutor para a credencial da YCloud. Ver lib/sdr/mensagens.
    return NextResponse.json({ error: CODIGO_CREDENCIAL_SDR_ILEGIVEL }, { status: 500 })
  }
  const connectionString = fonte.connectionString

  // ── Dedup against Supabase (SELECT only — never writes) ───────────────────
  let existingId:   string | null = null
  let existingName: string | null = null

  try {
    // Perfil 'largo' pelo mesmo motivo do import: é a tabela inteira de leads, e
    // o catch abaixo segue sem dedup em vez de reprovar o cadastro.
    await withSdrDb(connectionString, async sdr => {
      const res = await sdr.query<{
        id: string; name: string | null; phone: string | null; phone_adjusted: string | null
      }>(
        `SELECT id, name, phone, phone_adjusted
           FROM leads
          WHERE phone IS NOT NULL OR phone_adjusted IS NOT NULL`,
      )
      for (const r of res.rows) {
        const k1 = phoneKey(r.phone ?? '')
        const k2 = phoneKey(r.phone_adjusted ?? '')
        if ((k1 && k1 === key) || (k2 && k2 === key)) {
          existingId   = r.id
          existingName = r.name
          break
        }
      }
    }, 'largo')
  } catch (err) {
    // Non-fatal: if Supabase is unavailable, skip dedup and proceed to insert.
    // A GRAVAÇÃO logo abaixo não tem essa licença — lá a falha vira resposta de erro.
    //
    // O QUE SE PERDE AQUI NÃO VOLTA NO INSERT. A guarda de corrida do INSERT compara
    // os dígitos EXATOS de `phone_adjusted` (lib/sdr/leads-write), enquanto o `key`
    // desta rota vem de `phoneKey`, que ainda tira o 55 e o nono dígito. Então um
    // lead guardado como `11988887777` ou `551188887777` não impede o INSERT de
    // `+5511988887777`: sem a dedup, o tenant cujas linhas antigas não estão em
    // DDI + 9 dígitos ganha uma linha duplicada, e o fluxo de disparo aborda a mesma
    // pessoa duas vezes. É o preço de não recusar o cadastro por causa de uma leitura
    // que falhou — e é sobre este risco que o log abaixo é a única pista.
    console.error('[sdr manual dedup]', err)
  }

  if (existingId) {
    return NextResponse.json({
      ok: true,
      leadId: existingId,
      duplicate: true,
      // Lead sem nome na base vem como string vazia, não como null: devolver isso
      // jogaria fora o nome que o operador acabou de digitar, e o disparo deixaria
      // o lead de fora por falta de nome.
      name: (existingName ?? '').trim() || name,
    })
  }

  // ── Gravação na base do cliente ───────────────────────────────────────────
  // Diferente da dedup acima, aqui falha NÃO é engolida: sem isto a tela diria
  // "lead adicionado" com a base intacta.
  let leadId: string | undefined
  try {
    const escrita = await gravarLeads(
      connectionString,
      [{ name, phone, company, source: 'manual', status: 'novo' }],
      [],
    )
    leadId = escrita.idsInseridos[0]
  } catch (err) {
    // Texto do driver fica no log; o cliente recebe só código estável + português.
    console.error('[sdr manual write]', err)
    const erro = mapSdrDbError(err)
    return NextResponse.json(
      { ok: false, error: 'db_error', code: erro.code, message: erro.message },
      { status: 502 },
    )
  }

  // Sem id não houve linha: o `NOT EXISTS` do INSERT pulou o lead porque alguém com
  // o mesmo `phone_adjusted` já estava lá — a dedup acima não viu (ela engole a
  // própria falha) ou o lead entrou entre a leitura e a escrita. Não dá para
  // responder `duplicate: true` sem inventar um id, e `ok: true` com id nulo é
  // exatamente o que esta rota deixou de fazer.
  if (!leadId) {
    return NextResponse.json({ ok: false, error: 'telefone_ja_cadastrado' }, { status: 409 })
  }

  // Trilha da escrita na base do cliente, no mesmo formato de /api/sdr/leads/import
  // (que registra `leads.import`): este é o outro caminho que insere lead, e sem isto
  // ele não deixava rastro de quem inseriu. Só o caminho que ESCREVEU passa por aqui —
  // o `duplicate: true` lá acima sai antes, e não tocou na base. `logAudit` nunca lança.
  await logAudit({ req: request, session, action: 'leads.manual', entityType: 'lead', entityId: leadId, metadata: { inserted: 1, updated: 0, skipped: 0, total: 1 } })
  return NextResponse.json({ ok: true, leadId, duplicate: false, name })
}
