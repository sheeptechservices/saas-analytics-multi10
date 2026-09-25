// A RODADA da régua de disparo: recupera, seleciona, registra, manda e — quando dá
// errado — devolve. É o que o botão "Disparar agora" executa, de ponta a ponta.
//
// POR QUE EXISTE ESTE MÓDULO, E NÃO UMA ROTA GORDA
// `npm test` roda `lib/**/*.test.ts` e NADA de `app/**` (ver package.json). Tudo o que
// ficasse dentro de app/api/sdr/dispatch/route.ts ficaria sem teste nenhum — e o que
// esta orquestração decide não é enfeite: é em que ordem duas bases de dados são
// escritas, e o que acontece com as reservas quando o passo seguinte falha. Errar aqui
// não dá erro em lugar nenhum: dá lead fora da campanha para sempre, ou a mesma pessoa
// recebendo a mensagem duas vezes. É a mesma razão pela qual `lerCorpoDoAck` mora em
// lib/sdr/regua-ack e não na rota do ack.
//
// A rota fica com o que é HTTP e só isso: sessão, entitlement, a credencial do tenant,
// as settings do n8n, o código de status e o registro de auditoria.
//
// O QUE ESTE MÓDULO NÃO SABE, de propósito: a URL e o SEGREDO do disparador. Eles entram
// como uma PORTA (`enviarLote`), fechada sobre os dois lá na rota. Assim nenhum segredo
// atravessa este arquivo — nem para um log, nem para uma mensagem de erro — e o teste
// consegue provar o payload e a devolução sem rede nenhuma.
//
// A ORDEM DOS PASSOS, e o que cada um custa se sair do lugar
//
//   1. RECUPERAR PRIMEIRO. Uma reserva deixada por uma rodada que morreu no meio é um
//      lead com `ativo = false` parado fora da campanha. Pagar essa dívida no começo de
//      TODA rodada é o que torna o sistema autocurativo sem infraestrutura nenhuma: o
//      próprio botão mantém o livro-caixa honesto, sem cron, sem fila, sem worker (é o
//      uso que lib/sdr/varredura descreve em ONDE ISTO RODA). E recuperar ANTES de
//      selecionar tem um segundo efeito: o lead devolvido volta para a fila a tempo de
//      ser escolhido NESTA rodada.
//
//   2. LER A CONFIG VIGENTE da base do cliente, e passá-la inteira para a régua. A
//      config é do CLIENTE (`campaign_config`), não das nossas settings: é o que a tela
//      de Parâmetros grava lá, e é o mesmo `ORDER BY updated_at DESC LIMIT 1` que a rota
//      de blast e lib/sdr/regua-ack já chamam de "a configuração vigente".
//
//   3. SELECIONAR E RESERVAR, com a porta de contagem sendo `contarConsumidasHoje` do
//      livro-caixa — ver A COTA, logo abaixo.
//
//   4. REGISTRAR O LOTE INTEIRO no livro-caixa, destinatários E descartes. Ver
//      DESCARTE TAMBÉM É DÍVIDA.
//
//   5. DEVOLVER OS DESCARTES na hora, dos dois lados.
//
//   6. MANDAR. E, se o envio não for aceito, DEVOLVER TUDO — dos dois lados.
//
// A COTA — a porta de contagem é o livro-caixa, e nada mais
// `selecionarDevidos` exige `contarEnviadosHoje` e NÃO tem default, porque o default que
// existia era o errado: contar `blast_recipients`, que só o ack escreve, deixava a
// reserva EM VOO invisível e transformava o limite do DIA em limite POR RODADA. Quem
// enxerga o em voo é `contarConsumidasHoje` de lib/sdr/reservas, e ela entra NO LUGAR da
// contagem antiga, nunca ao lado dela: somar as duas conta duas vezes cada mensagem
// entregue (toda reserva liquidada como 'enviada' também vira uma linha de
// `blast_recipients` pelo ack) e corta a cota real pela metade. Não reintroduza fallback
// nenhum aqui — a ausência de default é a defesa.
//
// DESCARTE TAMBÉM É DÍVIDA — por que o registro é do LOTE INTEIRO
// A instrução de seleção da régua reserva (`ativo = false`) TUDO o que ela devolve: os
// destinatários e os descartes. Um descarte que não fosse registrado no livro-caixa
// seria uma linha desativada na base do cliente sem recibo nenhum do nosso lado — e a
// recuperação do passo 1, que lê o livro-caixa, NUNCA a encontraria. Bastaria o processo
// morrer entre a seleção e a devolução para aqueles leads saírem da campanha em silêncio
// e para sempre.
//
// Registrá-los não custa cota: a devolução vem logo em seguida e uma reserva 'devolvida'
// não consome (ver STATUS_QUE_CONSOMEM em lib/sdr/reservas). Ou seja, o registro é de
// graça e é o que torna o descarte RECUPERÁVEL. É a troca óbvia depois de escrita.
//
// A ORDEM DAS DEVOLUÇÕES é sempre a mesma, e é a de lib/sdr/varredura: PRIMEIRO a base do
// CLIENTE (`devolverReservas`, `ativo = true`), DEPOIS o livro-caixa (`marcarDevolvidas`).
// Morrer no meio dessa ordem deixa a cota PESSIMISTA por um dia — o recibo continua
// 'reservada' e a varredura seguinte o conserta sozinha. Na ordem contrária sobraria um
// recibo 'devolvida' com a linha do cliente ainda inativa, e aí acabou: nenhuma varredura
// futura olha para ela de novo. Cota pessimista por um dia contra lead perdido para
// sempre — a ordem é a primeira.
//
// NADA AQUI É "QUASE ENVIADO". A resposta diz quantos foram entregues ao disparador e por
// que os outros não foram. `ok` é verdadeiro num caso só: o disparador ACEITOU um lote
// com destinatários. Zero enviado nunca é sucesso, e zero enviado nunca sai sem motivo —
// é o silêncio que este diretório inteiro existe para acabar.
//
// OS DOIS BANCOS: a seleção, a devolução e a leitura da config falam com a base do
// CLIENTE (pelo pool de lib/sdr/pg); o registro, a contagem e as liquidações falam com o
// banco DA APP (pela fachada de lib/db). A string de conexão chega pronta de quem chamou
// (lib/sdr/conexao-tenant) e nunca entra em log nem em mensagem de erro.
//
// NADA ACONTECE NA IMPORTAÇÃO: sem leitura de ambiente, sem conexão, sem relógio.

import {
  devolverReservas,
  selecionarDevidos,
  type ConfigDaRegua,
  type ContagemDoDia,
  type Descartado,
  type EstadoDaJanela,
  type MotivoDoLote,
} from './regua'
import {
  contarConsumidasHoje,
  marcarDevolvidas,
  registrarReservas,
  type NovaReserva,
} from './reservas'
import { recuperarReservasParadas } from './varredura'
import { withSdrDb } from './pg'

// ─── Prazo de voo ─────────────────────────────────────────────────────────────

/**
 * Quanto tempo uma reserva pode ficar em voo antes de a recuperação considerá-la parada.
 *
 * lib/sdr/varredura se recusa a ter um número destes de propósito — é decisão
 * operacional, não fato — e manda o CHAMADOR escolher. Em produção o chamador é esta
 * rodada, então o número mora aqui, em voz alta, e não escondido numa chamada.
 *
 * Meia hora: o disparador manda um ack por mensagem logo depois de cada envio, então uma
 * reserva viva há trinta minutos não está a caminho — está perdida. Curto demais é o erro
 * que dói: devolver uma reserva que o n8n ainda vai enviar faz a MESMA pessoa receber a
 * MESMA mensagem duas vezes. Longo demais só atrasa o lead até a rodada seguinte.
 */
export const PRAZO_DE_VOO_MS = 30 * 60 * 1000

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Por que esta rodada terminou como terminou.
 *
 * É o vocabulário inteiro da régua (`MotivoDoLote`, que já separa campanha desligada de
 * fora do horário, de cota esgotada, de nada devido) mais três estados que só existem
 * aqui, porque só aqui é que eles podem acontecer.
 */
export type MotivoDaRodada =
  | MotivoDoLote
  /**
   * A base do cliente não tem NENHUMA linha em `campaign_config`.
   *
   * Motivo próprio, e não `campanha_inativa`: sem linha nenhuma, `ativo !== true` é
   * verdade e a régua responderia "a campanha está desligada" — mandando o operador
   * procurar um interruptor numa tela que não tem o que mostrar. O que resolve é salvar
   * os Parâmetros uma primeira vez.
   */
  | 'config_ausente'
  /**
   * As linhas foram reservadas na base do cliente e o livro-caixa NÃO aceitou o recibo.
   * O lote inteiro já foi devolvido lá (ver A ORDEM em lib/sdr/reservas: é exatamente a
   * garantia que aquela ordem existe para dar). Nada foi enviado e nada ficou preso.
   */
  | 'registro_indisponivel'
  /**
   * O disparador recusou o lote ou não respondeu. TODAS as reservas foram devolvidas,
   * dos dois lados: um soluço de rede não pode custar um lote inteiro de leads.
   */
  | 'envio_falhou'

/**
 * A frase de cada motivo, em português, pronta para a resposta HTTP.
 *
 * Mora aqui, e não na rota, pelos dois motivos de sempre neste diretório: `npm test` não
 * roda `app/**`, então uma frase escrita lá é uma frase sem teste; e um `Record` sobre a
 * união inteira faz o COMPILADOR cobrar a frase de todo motivo novo — um `switch` com
 * `default` deixaria o motivo novo cair calado numa frase genérica, que é o zero sem
 * explicação voltando pela porta da tela.
 *
 * O texto fala com o OPERADOR e por isso aponta para onde ele resolve (a tela de
 * Parâmetros, quase sempre). Não cita coluna, tabela nem nome de variável.
 */
const FRASE_DO_MOTIVO: Record<MotivoDaRodada, string> = {
  ok: 'o lote foi entregue ao disparador',
  campanha_inativa: 'a campanha está desligada nos Parâmetros',
  remetente_nao_configurado: 'falta o remetente nos Parâmetros',
  fase_final_nao_configurada: 'falta a fase final nos Parâmetros',
  dias_ativos_invalido: 'os dias ativos dos Parâmetros não formam uma lista de dias válida',
  dia_inativo: 'hoje não é um dia ativo da campanha',
  horario_invalido: 'o horário dos Parâmetros está preenchido pela metade ou fora de forma',
  horario_invertido: 'nos Parâmetros, o horário de início é depois do de fim',
  fora_do_horario: 'agora está fora da janela de horário da campanha',
  limite_diario_nao_configurado: 'falta o limite diário nos Parâmetros',
  limite_diario_invalido: 'o limite diário dos Parâmetros não é um número inteiro utilizável',
  limite_diario_zero: 'o limite diário está em zero — a campanha está configurada para não disparar',
  limite_diario_atingido: 'a cota de hoje já foi usada',
  contagem_nao_fornecida: 'defeito interno: a rodada não disse como contar a cota do dia',
  contagem_indisponivel: 'não foi possível contar a cota de hoje no banco da aplicação',
  contagem_invalida: 'defeito interno: a contagem da cota de hoje veio inutilizável',
  nada_devido: 'não há lead vencido para receber mensagem agora',
  todos_descartados: 'todos os leads da vez foram descartados — veja o motivo de cada um',
  config_ausente: 'a base do cliente ainda não tem configuração de campanha — salve os Parâmetros uma vez',
  registro_indisponivel:
    'o banco da aplicação não aceitou o registro das reservas — nada foi enviado e tudo voltou para a fila',
  envio_falhou: 'o disparador não aceitou o lote — nada saiu e as reservas voltaram para a fila',
}

/** A frase do motivo, para a tela. */
export function fraseDoMotivo(motivo: MotivoDaRodada): string {
  return FRASE_DO_MOTIVO[motivo]
}

/** O que a recuperação do passo 1 conseguiu fazer. */
export type ResumoDaRecuperacao =
  | {
      estado: 'ok'
      /** Recibos em voo além do prazo que o livro-caixa entregou. */
      paradas: number
      /** `lead_actions` que voltaram a `ativo = true` na base do cliente. */
      reativadas: number
      /** Recibos que saíram de 'reservada'. */
      liquidadas: number
      /** Quantas a guarda impediu de reativar — `lead_com_acao_ativa` é sintoma de ack
       *  quebrado, não rotina, e por isso o número sai na resposta. */
      bloqueadas: number
    }
  /** A recuperação caiu. A rodada NÃO aborta por isso — ver `executarRodada`. */
  | { estado: 'falhou' }

/**
 * Um destinatário como o disparador o recebe. Os cinco primeiros campos são, letra por
 * letra, a forma que app/api/sdr/leads/blast/route.ts já manda ao n8n; `leadActionId` e
 * `fase` são o recibo da reserva, e o nome `leadActionId` (e não `acaoId`) é o que
 * `lerCorpoDoAck` de lib/sdr/regua-ack lê de volta no ack. Renomear um dos dois lados
 * quebra o fecho da campanha sem dar erro em lugar nenhum.
 */
export type DestinatarioDoDisparo = {
  leadId: string
  phone: string
  first_name: string
  message: string
  session_id: string
  template: string
  leadActionId: string
  fase: string
}

/** O corpo que a porta de envio entrega ao disparador. */
export type PayloadDoDisparo = {
  tenantId: string
  /** Sempre `'regua'`: separa este lote do blast avulso, que manda `campaignId`. */
  campanha: 'regua'
  remetente: string
  /**
   * Para onde o disparador confirma CADA envio. Viaja no corpo, e não fica escrito
   * dentro do fluxo do n8n, porque uma URL escrita à mão lá dentro envelheceu numa
   * troca de host e quebrou o histórico de envios por meses, sem erro em lugar nenhum.
   * Quem a monta é a rota, a partir da origem configurada do app.
   */
  ackUrl: string
  recipients: DestinatarioDoDisparo[]
}

/** O que a porta de envio conta sobre a chamada. */
export type RespostaDoDisparador = {
  /** O disparador aceitou o lote. Só isso conta como envio. */
  ok: boolean
  /** Código HTTP, quando houve resposta. */
  status?: number
  /** Uma frase curta sobre a falha, para a tela. Nunca a URL, nunca o segredo. */
  erro?: string
}

export type PedidoDaRodada = {
  /** Dono da campanha. Recorta o livro-caixa e nomeia o balde do dia; a base do cliente
   *  já é recortada pela própria credencial. */
  tenantId: string
  /** O instante da rodada. Entra como parâmetro (em vez de `new Date()` aqui dentro)
   *  para que o corte do prazo, o balde do dia, a janela de horário e os carimbos das
   *  liquidações venham todos do MESMO relógio — e para o teste poder escolhê-lo. */
  agora: Date
  /** URL absoluta de `/api/sdr/dispatch/ack`, montada por quem chamou. */
  ackUrl: string
  /**
   * Como o lote chega ao disparador. Porta, e não um `fetch` aqui dentro, por dois
   * motivos: a URL e o segredo do n8n não entram neste módulo, e o teste consegue
   * exercitar a recusa do disparador — que é o caminho em que TUDO precisa voltar — sem
   * rede nenhuma.
   */
  enviarLote: (payload: PayloadDoDisparo) => Promise<RespostaDoDisparador>
  /** Prazo de voo da recuperação. O padrão é `PRAZO_DE_VOO_MS`. */
  prazoDeVooMs?: number
}

export type ResultadoDaRodada = {
  /** `true` num caso só: o disparador aceitou um lote COM destinatários. */
  ok: boolean
  motivo: MotivoDaRodada
  /** Quantos destinatários foram entregues ao disparador. Zero em todo motivo que não
   *  seja `'ok'` — inclusive em `'envio_falhou'`, onde tudo voltou para a fila. */
  enviados: number
  /** Linhas que a régua marcou `ativo = false` nesta rodada: enviados + descartados. */
  reservadas: number
  /** As reservas que não viraram mensagem, com o motivo de cada uma. Já devolvidas. */
  descartados: Descartado[]
  /** O que esta rodada devolveu para a fila, dos dois lados. Os dois números podem
   *  divergir sem ser erro: cada lado só conta o que ele mesmo mudou. */
  devolvidas: { naBaseDoCliente: number; noLivroCaixa: number }
  recuperacao: ResumoDaRecuperacao
  /**
   * O erro CRU de cada etapa que falhou, para o chamador LOGAR — nunca para a tela.
   * Um `SdrDbError` carrega o original em `cause`, e dali sai texto de driver.
   */
  falhaDaRecuperacao?: unknown
  falhaDoRegistro?: unknown
  /** A devolução em si falhou: há leads presos AGORA. É a linha de log mais grave que
   *  esta rodada pode produzir. */
  falhaNaDevolucao?: unknown
  /** A contagem do dia, como a régua a montou — inclusive `incompleta`. `null` só
   *  quando a rodada parou antes de a régua rodar (`config_ausente`). */
  limite: ContagemDoDia | null
  /** O relógio que a régua leu. `null` pelo mesmo motivo acima. */
  janela: EstadoDaJanela | null
  /** Linhas devidas e ativas que a régua não enxerga porque a `fase` é NULL. `null`
   *  quando a rodada não chegou a olhar. */
  devidosSemFase: number | null
  /** Código HTTP do disparador, quando houve resposta. */
  statusDoEnvio?: number
  /** A frase da falha de envio, já sem URL e sem segredo. */
  erroDoEnvio?: string
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

/**
 * A configuração vigente da campanha, na base do CLIENTE.
 *
 * É o mesmo `ORDER BY updated_at DESC LIMIT 1` de app/api/sdr/leads/blast/route.ts e de
 * `SQL_LER_ACAO` em lib/sdr/regua-ack: a tela de Parâmetros INSERE uma linha nova a cada
 * save, então "a config" é sempre a última.
 *
 * `SELECT *` e não a lista de colunas, e a escolha é deliberada: o schema é do cliente e
 * `ConfigDaRegua` já está escrito como "a linha como o `SELECT *` a devolve". Uma lista
 * explícita derrubaria a rodada inteira com `sdr_db_schema` numa base antiga que não
 * tenha, digamos, `horario_inicio` — enquanto o `*` deixa o campo chegar `undefined`, que
 * a régua lê como "não informado" e trata como "não restringe nada". Campanha parada por
 * coluna que nunca existiu é pior que campanha sem janela de horário.
 */
const SQL_CONFIG_VIGENTE = `SELECT * FROM campaign_config ORDER BY updated_at DESC LIMIT 1`

// ─── Rodada ───────────────────────────────────────────────────────────────────

/** Os quatro campos do recibo, a partir do que a régua devolveu. `idFase` é `null` para
 *  descarte: `Descartado` não carrega o número da fase, e inventá-lo seria pior. */
function reciboDe(
  reserva: { acaoId: string; leadId: string; fase: string; idFase?: number | null },
): NovaReserva {
  return {
    acaoId: reserva.acaoId,
    leadId: reserva.leadId,
    fase: reserva.fase,
    idFase: reserva.idFase ?? null,
  }
}

/**
 * Roda uma campanha do começo ao fim: recupera o que ficou parado, lê a config vigente,
 * seleciona e reserva o lote devido, registra o recibo, devolve os descartes, manda o
 * resto ao disparador — e devolve TUDO se o envio não for aceito.
 *
 * Ver A ORDEM DOS PASSOS no cabeçalho antes de trocar qualquer um deles de lugar.
 *
 * Erro da base do CLIENTE sobe como `SdrDbError` (pelo `withSdrDb` e pelas funções da
 * régua); erro do banco da APP sobe cru. "Nada a enviar" NUNCA é erro: é um resultado com
 * motivo.
 */
export async function executarRodada(
  connectionString: string,
  pedido: PedidoDaRodada,
): Promise<ResultadoDaRodada> {
  const { tenantId, agora, ackUrl } = pedido
  const prazoMs = pedido.prazoDeVooMs ?? PRAZO_DE_VOO_MS

  /* ── 1. RECUPERAR, antes de qualquer outra coisa ──────────────────────────────
   *
   * E FALHAR AQUI NÃO ABORTA A RODADA. A decisão é escolhida, e o argumento é este: a
   * recuperação paga a dívida de rodadas ANTERIORES; a correção desta rodada não depende
   * dela. Abortar transformaria um recibo velho — ou um soluço do nosso banco — num
   * bloqueio permanente do disparo, ou seja, trocaria "alguns leads atrasados" por
   * "campanha inteira parada". Seria fazer da rede de segurança o ponto único de falha.
   *
   * E o que de fato NÃO PODE seguir às cegas — a cota — tem portão próprio e fechado: a
   * contagem do passo 3 é `contarConsumidasHoje`, que fala com o MESMO banco da app; se
   * ele estiver fora, a régua devolve `contagem_indisponivel` e não reserva NADA. Não há
   * caminho em que a recuperação caia por indisponibilidade do nosso banco e a rodada
   * ainda assim mande mensagem sem conferir o limite.
   *
   * O que a falha custa está declarado na resposta (`recuperacao.estado === 'falhou'`), e
   * o erro cru vai para o log de quem chamou. */
  let recuperacao: ResumoDaRecuperacao
  let falhaDaRecuperacao: unknown
  try {
    const paga = await recuperarReservasParadas(connectionString, { tenantId, agora, prazoMs })
    recuperacao = {
      estado: 'ok',
      paradas: paga.paradas,
      reativadas: paga.reativadas,
      liquidadas: paga.liquidadas,
      bloqueadas: paga.bloqueadas.length,
    }
  } catch (erro) {
    recuperacao = { estado: 'falhou' }
    falhaDaRecuperacao = erro
  }

  /** O esqueleto comum de toda saída sem envio. */
  const semEnvio = (
    motivo: MotivoDaRodada,
    extra: Partial<ResultadoDaRodada> = {},
  ): ResultadoDaRodada => ({
    ok: false,
    motivo,
    enviados: 0,
    reservadas: 0,
    descartados: [],
    devolvidas: { naBaseDoCliente: 0, noLivroCaixa: 0 },
    recuperacao,
    ...(falhaDaRecuperacao === undefined ? null : { falhaDaRecuperacao }),
    limite: null,
    janela: null,
    devidosSemFase: null,
    ...extra,
  })

  // ── 2. A config vigente, da base do cliente ─────────────────────────────────
  const { rows } = await withSdrDb(connectionString, sdr =>
    sdr.query<ConfigDaRegua>(SQL_CONFIG_VIGENTE),
  )
  const config = rows[0]
  if (!config) return semEnvio('config_ausente')

  // ── 3. Selecionar e RESERVAR ────────────────────────────────────────────────
  const lote = await selecionarDevidos(connectionString, {
    tenantId,
    config,
    agora,
    /* A porta de contagem É o livro-caixa, e nada mais — ver A COTA no cabeçalho. Sem
     * `??`, sem `||`, sem contagem somada: qualquer coisa ao lado disto reabre o furo
     * que a ausência de default foi feita para impedir. */
    contarEnviadosHoje: contarConsumidasHoje,
  })

  const daRegua = {
    limite: lote.limite,
    janela: lote.janela,
    devidosSemFase: lote.devidosSemFase,
    reservadas: lote.reservadas,
    descartados: lote.descartados,
  }

  // Nada foi reservado: a régua parou antes do banco do cliente, ou não havia fila.
  if (lote.reservadas === 0) return semEnvio(lote.motivo, daRegua)

  // ── 4. Registrar o LOTE INTEIRO no livro-caixa ──────────────────────────────
  // Destinatários E descartes — ver DESCARTE TAMBÉM É DÍVIDA no cabeçalho.
  const recibos: NovaReserva[] = [
    ...lote.enviar.map(reciboDe),
    ...lote.descartados.map(reciboDe),
  ]

  try {
    await registrarReservas(tenantId, agora, recibos)
  } catch (erro) {
    /* As linhas JÁ estão `ativo = false` na base do cliente e não existe recibo nenhum
     * delas. Esta é exatamente a situação para a qual lib/sdr/reservas escolheu a ordem
     * "cliente primeiro, livro-caixa depois": quem chamou sabe quais ids reservou e
     * devolve na hora. Se esta devolução também cair, o `SdrDbError` sobe — e é o
     * desfecho certo, porque aí as duas bases estão fora e o operador precisa saber. */
    const naBaseDoCliente = await devolverReservas(connectionString, recibos.map(r => r.acaoId))
    return semEnvio('registro_indisponivel', {
      ...daRegua,
      devolvidas: { naBaseDoCliente, noLivroCaixa: 0 },
      falhaDoRegistro: erro,
    })
  }

  // ── 5. Devolver os descartes, na hora e dos dois lados ──────────────────────
  const devolvidas = { naBaseDoCliente: 0, noLivroCaixa: 0 }
  if (lote.descartados.length > 0) {
    const ids = lote.descartados.map(descarte => descarte.acaoId)
    // Cliente primeiro, livro-caixa depois. Ver A ORDEM DAS DEVOLUÇÕES no cabeçalho.
    devolvidas.naBaseDoCliente += await devolverReservas(connectionString, ids)
    devolvidas.noLivroCaixa += await marcarDevolvidas(ids, agora)
  }

  /* Reservou, descartou tudo, e não sobrou ninguém para receber. O motivo da régua
   * (`todos_descartados`) é a resposta, e cada descarte vem com o seu próprio motivo em
   * `descartados` — é a diferença entre "0 enviados" e "0 enviados porque dez leads estão
   * numa fase sem template cadastrado". */
  if (lote.enviar.length === 0) return semEnvio(lote.motivo, { ...daRegua, devolvidas })

  // ── 6. Mandar ───────────────────────────────────────────────────────────────
  const payload: PayloadDoDisparo = {
    tenantId,
    campanha: 'regua',
    // A régua já recusou o lote quando falta remetente (`remetente_nao_configurado`),
    // então aqui ele existe; o `?? ''` é só o que o tipo da coluna do cliente exige.
    remetente: String(config.remetente ?? '').trim(),
    ackUrl,
    recipients: lote.enviar.map(destinatario => ({
      leadId: destinatario.leadId,
      phone: destinatario.phone,
      first_name: destinatario.first_name,
      message: destinatario.message,
      session_id: destinatario.session_id,
      template: destinatario.template,
      leadActionId: destinatario.acaoId,
      fase: destinatario.fase,
    })),
  }

  let aceito = false
  let statusDoEnvio: number | undefined
  let erroDoEnvio: string | undefined
  try {
    const resposta = await pedido.enviarLote(payload)
    aceito = resposta.ok === true
    statusDoEnvio = resposta.status
    erroDoEnvio = resposta.erro
  } catch (erro) {
    /* Porta pública: o que ela levanta não pode escapar e levar o lote junto. Só a
     * MENSAGEM viaja — a URL e o segredo do disparador não existem neste módulo. */
    erroDoEnvio = erro instanceof Error ? erro.message : String(erro)
  }

  if (!aceito) {
    /* TUDO VOLTA. Sem isto, um soluço de rede custa à campanha um lote inteiro de leads,
     * permanentemente: eles ficariam `ativo = false` sem nunca terem recebido mensagem
     * nenhuma. A devolução é o que transforma "o n8n não respondeu" em "tenta de novo". */
    const ids = lote.enviar.map(destinatario => destinatario.acaoId)
    let falhaNaDevolucao: unknown
    try {
      devolvidas.naBaseDoCliente += await devolverReservas(connectionString, ids)
      devolvidas.noLivroCaixa += await marcarDevolvidas(ids, agora)
    } catch (erro) {
      /* Engolido AQUI, e só aqui, porque a alternativa é pior: deixar subir trocaria a
       * resposta "o disparador recusou" por um erro de banco, escondendo do operador o
       * que de fato aconteceu com o envio. O erro vai inteiro para o log do chamador, e
       * os leads que ficaram presos serão achados pela recuperação da rodada seguinte —
       * o recibo deles continua 'reservada', que é justamente o que ela procura. */
      falhaNaDevolucao = erro
    }

    return semEnvio('envio_falhou', {
      ...daRegua,
      devolvidas,
      ...(statusDoEnvio === undefined ? null : { statusDoEnvio }),
      ...(erroDoEnvio === undefined ? null : { erroDoEnvio }),
      ...(falhaNaDevolucao === undefined ? null : { falhaNaDevolucao }),
    })
  }

  return {
    ok: true,
    motivo: 'ok',
    enviados: lote.enviar.length,
    ...daRegua,
    devolvidas,
    recuperacao,
    ...(falhaDaRecuperacao === undefined ? null : { falhaDaRecuperacao }),
    ...(statusDoEnvio === undefined ? null : { statusDoEnvio }),
  }
}
