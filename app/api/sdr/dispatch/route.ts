// POST /api/sdr/dispatch
//
// O botão "Disparar agora" da tela de Credenciais. Roda UMA rodada da régua: recupera as
// reservas paradas, lê a configuração vigente na base do cliente, escolhe e RESERVA quem
// está devido, registra o recibo no livro-caixa e entrega ao disparador uma lista pronta
// de destinatários. A orquestração inteira mora em lib/sdr/rodada; aqui fica o que é
// HTTP.
//
// O QUE MUDOU, E POR QUE
// Esta rota mandava ao n8n só `{ tenantId, triggeredAt, limiteDiario }` e o fluxo do
// outro lado fazia a seleção inteira: lia `campaign_config`, varria `lead_actions`,
// buscava o template e disparava. Ele respondia 200 na hora, antes de mandar coisa
// alguma, então o botão SEMPRE dizia "ok" — inclusive quando nada saía, e sem nunca
// dizer por quê. Agora a app resolve tudo e manda a lista pronta, no mesmo formato de
// app/api/sdr/leads/blast: a resposta passa a carregar quantos foram, quantos voltaram
// para a fila e o MOTIVO de cada zero.
//
// O DISPARADOR CONTINUA SENDO `n8nDispatchUrl`/`n8nDispatchSecret`. O par não mudou de
// nome de propósito: o operador reaponta a URL para o fluxo novo (o que só recebe e
// envia) na tela de Credenciais, e nada aqui nem no ack precisa saber que a troca
// aconteceu. O mesmo segredo já autentica o ack, que é o outro lado deste par.
//
// CONVIVÊNCIA COM O CRON ANTIGO — o conselho operacional que vale enquanto ele existir
// O cron do n8n continua batendo no fluxo velho por conta própria, por decisão tomada: só
// o disparo MANUAL passa por aqui. Os dois caminhos não se atropelam na maior parte do
// tempo (a reserva desta rota marca `ativo = false` na mesma instrução que seleciona, e o
// fluxo antigo não enxerga linha inativa), mas existe UMA janela que nenhuma reserva
// fecha: o fluxo antigo desativa a linha dele só DEPOIS de mandar. Uma linha que ele já
// pegou continua `ativo = true` durante o envio, e se a régua a reservar nesse intervalo
// os dois mandam — a mesma pessoa recebe a mesma mensagem duas vezes.
//
// Ou seja: NÃO rodar o disparo manual em cima dos horários do cron — 9:15, 12:15 e 16:15.
// A janela só fecha de verdade quando o fluxo antigo for desligado.
//
// Resposta: ver `Resposta` lá embaixo. `ok` é verdadeiro num caso só — o disparador
// aceitou um lote COM destinatários.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { requireTenantUser } from '@/lib/auth-guard'
import { readN8nSecret } from '@/lib/sdr/settings-merge'
import { conexaoDoTenant } from '@/lib/sdr/conexao-tenant'
import { CODIGO_CREDENCIAL_SDR_ILEGIVEL } from '@/lib/sdr/mensagens'
import { mapSdrDbError } from '@/lib/sdr/pg'
import { configuredOrigin } from '@/lib/origin'
import {
  executarRodada,
  fraseDoMotivo,
  type MotivoDaRodada,
  type PayloadDoDisparo,
  type RespostaDoDisparador,
  type ResumoDaRecuperacao,
} from '@/lib/sdr/rodada'
import type { EstadoDaJanela, MotivoDescarte } from '@/lib/sdr/regua'

const SOURCE = 'sdr-n8n'

/** Teto de espera do disparador — o mesmo de app/api/sdr/leads/blast. */
const TIMEOUT_MS = 15_000

/**
 * A resposta da tela. Nada aqui carrega texto de driver nem segredo: os erros crus das
 * etapas ficam no `console.error` do servidor, que é onde eles servem para alguma coisa.
 */
type Resposta = {
  /** O disparador aceitou um lote COM destinatários. Zero enviado nunca é sucesso. */
  ok: boolean
  /** Por que a rodada terminou assim. É a resposta para "por que não saiu nada?". */
  motivo: MotivoDaRodada
  enviados: number
  /** Linhas que a régua marcou `ativo = false` nesta rodada: enviados + descartados. */
  reservadas: number
  descartados: number
  /** Quantos descartes de cada tipo — é o que transforma "0 enviados" em "0 enviados
   *  porque dez leads estão numa fase sem template cadastrado". */
  descartesPorMotivo: Partial<Record<MotivoDescarte, number>>
  /** O que voltou para a fila nesta rodada (descartes, e o lote inteiro quando o envio
   *  falhou), dos dois lados. */
  devolvidas: { naBaseDoCliente: number; noLivroCaixa: number }
  /** O que a recuperação do início da rodada pagou — ou que ela falhou, sem abortar. */
  recuperacao: ResumoDaRecuperacao
  /**
   * A conta do dia. `incompleta` é a honestidade que falta ao número: enquanto o cron
   * antigo rodar, o que ele manda não aparece nem em `dispatch_claims` nem em
   * `blast_recipients`, então `enviadosHoje` é um PISO e não o total. A tela deve dizer
   * isso em vez de apresentar um número que parece exato.
   */
  limite: {
    limiteDiario: number | null
    enviadosHoje: number | null
    disponivel: number | null
    incompleta: boolean
  } | null
  /** O relógio que a régua leu, para a tela não ter de falar em UTC. */
  janela: EstadoDaJanela | null
  /** Linhas devidas e ativas que a régua não enxerga porque a `fase` é NULL. */
  devidosSemFase: number | null
  /** Código HTTP do disparador, quando houve resposta. O nome é o que a tela já lê. */
  status?: number
  /**
   * A frase de QUALQUER rodada que não enviou — e não só das que deram erro.
   *
   * O nome é `error` porque é o campo que a tela de Credenciais já lê hoje, e ela o lê
   * assim: `Falha: {error ?? 'HTTP ' + status}`. Deixá-lo vazio numa recusa honesta
   * ("campanha inativa", "fora do horário") faria a tela escrever `Falha: HTTP
   * undefined` — um zero sem explicação, que é exatamente o que este trabalho remove.
   * Enquanto a tela não souber separar "não havia o que enviar" de "deu erro", a frase
   * do motivo é o que ela mostra; `motivo` está ali ao lado para quando souber.
   */
  error?: string
}

/**
 * O código HTTP sai de uma pergunta só: DE QUEM É O PROBLEMA?
 *
 *   · 200 para todo estado da CAMPANHA — desligada, fora do horário, sem cota, nada
 *     devido, tudo descartado. A requisição foi atendida e a resposta é "não saiu nada,
 *     e aqui está o porquê"; devolver 4xx/5xx faria a tela mostrar "erro" para uma
 *     campanha que está apenas configurada para não disparar agora.
 *   · 502 quando o DISPARADOR recusou ou não respondeu — o problema é do outro lado.
 *   · 500 quando o problema é NOSSO: o banco da app não contou a cota ou não aceitou o
 *     recibo. Em todos esses casos nada foi enviado e nada ficou preso.
 */
function statusDaResposta(motivo: MotivoDaRodada): number {
  switch (motivo) {
    case 'envio_falhou':
      return 502
    case 'registro_indisponivel':
    case 'contagem_indisponivel':
    case 'contagem_invalida':
    case 'contagem_nao_fornecida':
      return 500
    default:
      return 200
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // ── O disparador: URL + segredo das settings do tenant ──────────────────────
  const [row] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let settings: Record<string, unknown> = {}
  if (row) {
    try { settings = JSON.parse(row.settings) } catch {}
  }

  const dispatchUrl =
    typeof settings.n8nDispatchUrl === 'string' && settings.n8nDispatchUrl
      ? settings.n8nDispatchUrl
      : null

  if (!dispatchUrl) {
    return NextResponse.json({ error: 'dispatch_url_nao_configurada' }, { status: 400 })
  }

  // Guardado cifrado (legado em texto puro continua legível) — ver lib/sdr/settings-merge.
  const dispatchSecret = readN8nSecret(settings, 'n8nDispatchSecret') ?? undefined

  // ── A credencial da base do cliente ─────────────────────────────────────────
  const fonte = await conexaoDoTenant(tenantId)
  if (fonte.estado === 'nao_configurada') {
    return NextResponse.json({ error: 'fonte_sdr_nao_configurada' }, { status: 400 })
  }
  if (fonte.estado === 'ilegivel') {
    // Código próprio da fonte SDR, não o `config_invalid` genérico da YCloud — quem já
    // registrou a credencial ilegível foi lib/sdr/conexao-tenant. Ver lib/sdr/mensagens.
    return NextResponse.json({ error: CODIGO_CREDENCIAL_SDR_ILEGIVEL }, { status: 500 })
  }

  /* Para onde o disparador confirma cada envio. Sai de `configuredOrigin`, que lê
   * APP_URL e SÓ ela: NEXTAUTH_URL é proibida neste projeto (lib/ambiente.ts, nível
   * "proibida"), porque o next-auth reescreve a origem de toda requisição com ela.
   *
   * A origem CONFIGURADA, e não a da requisição, pelo mesmo motivo do webhook da YCloud
   * (app/api/ycloud/source): isto é uma chamada servidor-a-servidor e precisa ser estável
   * e igual para todos — origem tirada do cabeçalho daria um ack diferente por subdomínio
   * de acesso. E ela viaja no CORPO em vez de ficar escrita dentro do fluxo do n8n porque
   * uma URL escrita à mão lá dentro envelheceu numa troca de host e quebrou o histórico
   * de envios por meses, sem erro em lugar nenhum. Trocar de domínio agora é trocar
   * APP_URL. */
  const ackUrl = `${configuredOrigin()}/api/sdr/dispatch/ack`

  // Um relógio só para a rodada inteira: o corte do prazo da recuperação, o balde do dia,
  // a janela de horário e os carimbos das liquidações têm de falar do mesmo instante.
  const agora = new Date()

  /* A porta de envio. A URL e o segredo ficam FECHADOS aqui dentro e não entram em
   * lib/sdr/rodada — assim nenhum segredo atravessa aquele módulo, nem para log nem para
   * mensagem de erro. Erro de rede sobe e a rodada o trata devolvendo o lote inteiro. */
  const enviarLote = async (payload: PayloadDoDisparo): Promise<RespostaDoDisparador> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (dispatchSecret) headers['Authorization'] = `Bearer ${dispatchSecret}`

    const res = await fetch(dispatchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    // Só o código: o corpo da resposta do n8n pode trazer qualquer coisa, e a URL não
    // volta para a tela em hipótese nenhuma.
    return {
      ok: res.ok,
      status: res.status,
      erro: res.ok ? undefined : `o disparador respondeu ${res.status}`,
    }
  }

  let resultado: Awaited<ReturnType<typeof executarRodada>>
  try {
    resultado = await executarRodada(fonte.connectionString, {
      tenantId,
      agora,
      ackUrl,
      enviarLote,
    })
  } catch (err) {
    // Texto do driver fica no log; o cliente recebe só código estável + português. Mesma
    // tradução de app/api/sdr/leads/blast.
    console.error('[sdr dispatch] base do cliente —', err)
    const erro = mapSdrDbError(err)
    return NextResponse.json(
      { error: 'db_error', code: erro.code, message: erro.message },
      { status: 502 },
    )
  }

  /* Os erros CRUS das etapas: log do servidor, nunca resposta. Um `SdrDbError` carrega o
   * original em `cause`, e dali sai texto de driver. */
  if (resultado.falhaDaRecuperacao !== undefined) {
    console.error('[sdr dispatch] recuperação falhou — tenant', tenantId, resultado.falhaDaRecuperacao)
  }
  if (resultado.falhaDoRegistro !== undefined) {
    console.error('[sdr dispatch] livro-caixa recusou o lote — tenant', tenantId, resultado.falhaDoRegistro)
  }
  if (resultado.falhaNaDevolucao !== undefined) {
    // A mais grave das três: há leads reservados que NÃO voltaram para a fila. A
    // recuperação da rodada seguinte os acha (o recibo deles continua 'reservada'), mas
    // isto merece olho humano.
    console.error('[sdr dispatch] devolução falhou — tenant', tenantId, resultado.falhaNaDevolucao)
  }
  if (resultado.limite?.falha !== undefined) {
    console.error('[sdr dispatch] contagem da cota falhou — tenant', tenantId, resultado.limite.falha)
  }

  /* Toda rodada sem envio sai com frase. Quando o disparador é que falhou, a frase do
   * motivo vem primeiro e o detalhe dele depois — "o disparador não aceitou o lote — …
   * — o disparador respondeu 502" —, porque o que o operador precisa saber antes do
   * código HTTP é que as reservas voltaram para a fila. */
  const erro = resultado.ok
    ? undefined
    : [fraseDoMotivo(resultado.motivo), resultado.erroDoEnvio].filter(Boolean).join(' — ')

  const descartesPorMotivo: Partial<Record<MotivoDescarte, number>> = {}
  for (const descarte of resultado.descartados) {
    descartesPorMotivo[descarte.motivo] = (descartesPorMotivo[descarte.motivo] ?? 0) + 1
  }

  /* Auditoria do que ACONTECEU, e não só do sucesso: antes desta rota só registrava
   * quando o n8n respondia 200, que era o caso em que ela não sabia de nada. */
  await logAudit({
    req: request,
    session,
    action: 'disparo.campanha',
    metadata: {
      motivo: resultado.motivo,
      enviados: resultado.enviados,
      reservadas: resultado.reservadas,
      descartados: resultado.descartados.length,
      descartesPorMotivo,
      devolvidas: resultado.devolvidas,
      recuperacao: resultado.recuperacao,
      limiteDiario: resultado.limite?.limiteDiario ?? null,
      enviadosHoje: resultado.limite?.enviadosHoje ?? null,
      contagemIncompleta: resultado.limite?.incompleta ?? null,
    },
  })

  const resposta: Resposta = {
    ok: resultado.ok,
    motivo: resultado.motivo,
    enviados: resultado.enviados,
    reservadas: resultado.reservadas,
    descartados: resultado.descartados.length,
    descartesPorMotivo,
    devolvidas: resultado.devolvidas,
    recuperacao: resultado.recuperacao,
    // `balde` e `falha` de `ContagemDoDia` ficam de fora: o primeiro não diz nada a quem
    // lê a tela, e o segundo pode carregar texto de driver.
    limite: resultado.limite
      ? {
          limiteDiario: resultado.limite.limiteDiario,
          enviadosHoje: resultado.limite.enviadosHoje,
          disponivel: resultado.limite.disponivel,
          incompleta: resultado.limite.incompleta,
        }
      : null,
    janela: resultado.janela,
    devidosSemFase: resultado.devidosSemFase,
    ...(resultado.statusDoEnvio === undefined ? null : { status: resultado.statusDoEnvio }),
    ...(erro === undefined ? null : { error: erro }),
  }

  return NextResponse.json(resposta, { status: statusDaResposta(resultado.motivo) })
}
