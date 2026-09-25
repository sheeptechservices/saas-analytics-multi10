// POST /api/sdr/dispatch/ack
//
// Chamada servidor-a-servidor pelo n8n depois de CADA envio da campanha. Registra o
// envio em `blast_recipients` (no balde do dia, criado aqui se ainda não existir) e,
// quando o envio veio da régua nova, fecha o ciclo: avança a fase do lead na base do
// cliente e liquida a reserva no livro-caixa (lib/sdr/regua-ack).
//
// DOIS CONTRATOS AO MESMO TEMPO, e é isso que decide quase tudo aqui. O fluxo antigo do
// n8n ("Disparo de Templates v3") continua rodando durante a virada e manda o corpo
// curto — `{ tenantId, leadId, messageId, phone?, firstName?, template?, messageBody? }`
// — sem `leadActionId` e sem `status`. Ele avança a fase por conta própria. O disparador
// novo manda `leadActionId` e `status`, e é a app que avança.
//
// A REGRA QUE SEPARA OS DOIS É UMA SÓ: sem `leadActionId`, esta rota faz exatamente o
// que fazia — registra o envio e nada mais. Avançar a fase aqui TAMBÉM, enquanto o fluxo
// antigo avança lá, pularia uma fase de cada lead a cada mensagem.
//
// Corpo aceito:
//   { tenantId, leadId, messageId, phone?, firstName?, template?, messageBody?,
//     status?: 'enviado' | 'falhou', campanha?, campaignId?,
//     leadActionId?, fase?, sessionId?, erro? }
// Ver `lerCorpoDoAck` em lib/sdr/regua-ack para o que cada campo faz — e para os quatro
// que são aceitos e deliberadamente ignorados.
//
// Auth: Bearer token == campaignSettings.n8nDispatchSecret do tenant (source 'sdr-n8n').
// Sem sessão de usuário.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients, campaignSettings } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { readN8nSecret } from '@/lib/sdr/settings-merge'
import { timingSafeEqualStrings } from '@/lib/timing-safe'
import { conexaoDoTenant } from '@/lib/sdr/conexao-tenant'
import { concluirAck, lerCorpoDoAck, type ResultadoDoAck } from '@/lib/sdr/regua-ack'

const SOURCE = 'sdr-n8n'

/* Id determinístico do balde do dia: "${tenantId}:drip:${AAAAMMDD}" no fuso de São
 * Paulo. Tem de ser byte a byte o mesmo que `baldeDoDia` de lib/sdr/regua produz — é
 * esta rota que ESCREVE as linhas e é a régua que as CONTA para descontar o limite
 * diário. Divergir não daria erro nenhum: daria contagem eternamente zero.
 *
 * O instante entra como parâmetro para a requisição inteira usar UM relógio só: o
 * balde, os carimbos da linha e o agendamento da próxima fase têm de falar do mesmo
 * momento, e um `new Date()` por chamada os deixa cair em dias diferentes na virada. */
function dayBucketId(tenantId: string, agora: Date): string {
  const yyyymmdd = agora
    .toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // 'YYYY-MM-DD'
    .replace(/-/g, '')
  return `${tenantId}:drip:${yyyymmdd}`
}

/**
 * A RESPOSTA, e por que ela não é só `{ ok: true }`.
 *
 * Este ack faz até três gravações em DOIS bancos que não confirmam juntos: o registro do
 * envio (banco da app), o avanço de fase (base do cliente) e a liquidação da reserva
 * (banco da app). Responder `ok: true` porque a primeira passou esconderia justamente o
 * caso que interessa — a mensagem saiu, o lead não andou —, que é o silêncio que este
 * trabalho veio acabar. Então a resposta conta as três separadamente.
 *
 * `ok` é "tudo o que este ack tinha a fazer foi feito (ou já estava feito)". Um ack
 * repetido é `ok: true`: as duas guardas de idempotência tornam a repetição um no-op, e
 * chamar isso de falha faria o n8n tentar para sempre.
 *
 * O CÓDIGO HTTP é decidido por outra pergunta: "repetir resolve?".
 *   · 500 quando uma ETAPA falhou no banco. Repetir resolve, e repetir é seguro — as
 *     duas guardas valem —, então o 5xx é o que faz o retry do n8n terminar o serviço.
 *     É essa combinação (ordem + idempotência + 5xx) que fecha o buraco do processo que
 *     morre no meio.
 *   · 200 com `ok: false` quando repetir NÃO resolve: credencial do tenant ausente ou
 *     ilegível, `lead_actions` apagada, `id_fase` que não é número. Devolver 5xx aí
 *     poria o n8n num retry eterno contra um problema que só um humano conserta; o que
 *     resolve é o `ok: false` com o motivo, visível em quem lê a resposta, mais o log.
 */
type Resposta = {
  ok: boolean
  /** A linha de `blast_recipients` foi escrita NESTA chamada. */
  registrado: boolean
  /** O `messageId` já estava registrado — o ack é repetido. */
  duplicate?: true
  /** Como terminou o avanço de fase; `null` quando não havia o que avançar. */
  avanco?: string | null
  /** `'liquidada'` quando a reserva saiu de voo agora; `'sem_reserva_viva'` quando não
   *  havia reserva em voo — ack repetido (rotina) ou envio que nunca passou por reserva
   *  (o fluxo antigo). O zero não distingue os dois, e por isso não afirma nenhum. */
  reserva?: 'liquidada' | 'sem_reserva_viva'
  /** Só na falha: quantas `lead_actions` voltaram para a fila. */
  devolvidas?: number
  /** Só quando uma etapa falhou no banco. */
  etapa?: ResultadoDoAck['etapa']
  /** Só quando a credencial do tenant não serve. */
  fonte?: 'nao_configurada' | 'ilegivel'
}

export async function POST(req: NextRequest) {
  // ── Parse + validate body ─────────────────────────────────────────────────────
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  /* A leitura do corpo mora em lib/sdr/regua-ack, e não aqui, por um motivo mecânico:
   * `npm test` roda `lib/**` e nada de `app/**`. Regra de aceitação escrita numa rota é
   * regra sem teste. */
  const leitura = lerCorpoDoAck(body)
  if (!leitura.ok) {
    return NextResponse.json({ error: leitura.erro }, { status: 400 })
  }
  const ack = leitura.ack
  const { tenantId, leadId, messageId, acaoId } = ack

  // ── Auth: load n8nDispatchSecret for this tenant ──────────────────────────────
  const [csRow] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let dispatchSecret: string | null = null
  if (csRow) {
    try {
      const settings = JSON.parse(csRow.settings) as Record<string, unknown>
      // Guardado cifrado (legado em texto puro continua legível) — ver lib/sdr/settings-merge.
      dispatchSecret = readN8nSecret(settings, 'n8nDispatchSecret')
    } catch {}
  }

  if (!dispatchSecret) {
    // Missing config treated as auth failure — avoids tenantId enumeration
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  // Comparação em tempo constante: `!==` sai no primeiro byte diferente e deixa
  // o segredo ser descoberto byte a byte pelo tempo de resposta.
  if (!bearer || !timingSafeEqualStrings(bearer, dispatchSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Um relógio só para a requisição inteira — ver `dayBucketId`.
  const agora = new Date()

  let duplicate = false
  try {
    /* Idempotência do REGISTRO, pelo `messageId`. Um ack de falha não tem messageId (a
     * mensagem não existe no YCloud), então esta guarda não vale para ele: falha
     * repetida grava linha repetida em `blast_recipients`. É aceito de propósito — a
     * alternativa seria inventar uma chave para algo que não tem id —, e as duas
     * gravações que importam (devolver a reserva, liquidar o livro-caixa) continuam
     * idempotentes pelos seus próprios guardas. */
    if (messageId) {
      const [existing] = await db
        .select({ id: blastRecipients.id })
        .from(blastRecipients)
        .where(eq(blastRecipients.ycloudMessageId, messageId))
        .limit(1)
      duplicate = Boolean(existing)
    }

    if (!duplicate) {
      // ── Find-or-create the day's campaign bucket ──────────────────────────────
      const campaignId = dayBucketId(tenantId, agora)

      await db
        .insert(blastCampaigns)
        .values({
          id:              campaignId,
          tenantId,
          kind:            'campanha',
          template:        'Campanha SDR',
          templateBody:    null,
          totalSolicitado: 0,
          skipped:         0,
          started:         0,
          status:          'enviando',
          createdBy:       null,
          createdAt:       agora,
        })
        .onConflictDoNothing({ target: blastCampaigns.id })

      // ── Insert recipient ──────────────────────────────────────────────────────
      // `status` sai do corpo: 'enviado' como sempre, e agora também 'falhou', que já
      // existia no vocabulário da coluna (ver lib/db/schema) — nenhum valor novo foi
      // inventado, então a tela de campanha e a reconciliação leem esta linha sem mudar.
      await db
        .insert(blastRecipients)
        .values({
          id:              randomUUID(),
          campaignId,
          leadId,
          phone:           ack.phone,
          firstName:       ack.firstName,
          messageBody:     ack.messageBody,
          template:        ack.template,
          ycloudMessageId: messageId,
          status:          ack.status,
          errorMessage:    ack.erroDoEnvio,
          createdAt:       agora,
          lastStatusAt:    agora,
        })

      /* Contadores do balde. `started` conta mensagem que COMEÇOU a sair, então a falha
       * não entra nele — entra só no total, que é quantas tentativas o dia teve. */
      await db
        .update(blastCampaigns)
        .set({
          totalSolicitado: sql`${blastCampaigns.totalSolicitado} + 1`,
          ...(ack.status === 'enviado' ? { started: sql`${blastCampaigns.started} + 1` } : null),
        })
        .where(eq(blastCampaigns.id, campaignId))
    }

    const resposta: Resposta = { ok: true, registrado: !duplicate }
    if (duplicate) resposta.duplicate = true

    /* CAMINHO LEGADO. Sem `leadActionId` não há reserva nem fase a avançar: quem faz
     * isso é o fluxo antigo, do lado dele. A resposta sai IGUAL à de antes deste lote,
     * campo por campo, porque é ela que o fluxo antigo já lê. */
    if (!acaoId) {
      return NextResponse.json(duplicate ? { ok: true, duplicate: true } : { ok: true })
    }

    // ── A partir daqui é o caminho da régua nova ──────────────────────────────
    const fonte = await conexaoDoTenant(tenantId)
    if (fonte.estado !== 'ok') {
      /* O envio está registrado e a fase NÃO vai andar: sem credencial não há como
       * abrir a base do cliente. É `ok: false` com o motivo — quem já logou a
       * credencial ilegível foi lib/sdr/conexao-tenant; aqui fica o que o operador
       * precisa ver, que é o lead parado. Repetir não resolve: 200, não 500. */
      console.error('[dispatch/ack] sem conexão com a base do cliente —', fonte.estado, 'tenant', tenantId)
      return NextResponse.json({ ...resposta, ok: false, fonte: fonte.estado, avanco: null })
    }

    const fecho = await concluirAck(
      fonte.connectionString,
      // Sem cast: `CorpoDoAck` discrimina por `status` e no ramo 'enviado' o
      // `messageId` já é `string` — a garantia que `lerCorpoDoAck` deu viaja no tipo.
      ack.status === 'enviado'
        ? { acaoId, status: 'enviado', messageId: ack.messageId, agora }
        : { acaoId, status: 'falhou', agora },
    )

    resposta.ok = fecho.ok
    resposta.avanco = fecho.avanco?.motivo ?? null
    resposta.reserva = fecho.liquidadas > 0 ? 'liquidada' : 'sem_reserva_viva'
    if (fecho.devolvidas !== null) resposta.devolvidas = fecho.devolvidas

    if (fecho.etapa) {
      /* Etapa que caiu no banco. O erro cru vai para o log e NÃO para a resposta: um
       * `SdrDbError` carrega o original em `cause`, e dali sai texto de driver. */
      console.error('[dispatch/ack] etapa', fecho.etapa, 'falhou — tenant', tenantId, fecho.falha)
      resposta.etapa = fecho.etapa
      // 500 de propósito: repetir resolve e repetir é seguro. Ver o comentário de
      // `Resposta`.
      return NextResponse.json(resposta, { status: 500 })
    }

    if (!fecho.ok) {
      // O lead ficou sem ação ativa por um problema de dado (linha apagada, `id_fase`
      // ilegível). Repetir não conserta, então 200 — o que conserta é alguém ver isto.
      console.error('[dispatch/ack] fase não avançou —', resposta.avanco, 'tenant', tenantId, 'ação', acaoId)
    }

    return NextResponse.json(resposta)
  } catch (err) {
    console.error('[dispatch/ack]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
