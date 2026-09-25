// Varredura da régua de disparo: RECUPERA a reserva que ninguém liquidou, e RELATA o
// lead que ficou parado fora do alcance do livro-caixa.
//
// POR QUE EXISTE
// Reserva é dívida. lib/sdr/regua marca `lead_actions.ativo = false` na base do
// CLIENTE dentro da mesma instrução que seleciona, e lib/sdr/reservas registra o recibo
// no banco DA APP (`dispatch_claims`, status 'reservada', com `claimed_at`). A dívida é
// paga pelo ack: 'enviada' quando a mensagem saiu, 'falhou' quando a tentativa
// aconteceu e não deu, 'devolvida' quando o lead voltou para a fila.
//
// Se o processo morrer entre a reserva e o ack, a dívida não é paga por ninguém: a
// linha do cliente fica `ativo = false` PARA SEMPRE e aquele lead sai da campanha em
// silêncio. E não há como descobrir isso olhando a tabela do cliente — reserva em voo e
// campanha encerrada são, byte a byte, o mesmo estado. Não existe coluna nossa lá
// dizendo "esta linha está reservada, não terminada", e não vamos acrescentar uma no
// schema de outra empresa.
//
// DUAS CAPACIDADES, DELIBERADAMENTE NÃO FUNDIDAS
// De fora as duas respondem à mesma pergunta ("quem ficou parado?"). Por dentro têm
// riscos de ordens de grandeza diferentes, e é por isso que são duas funções:
//
//   1. `recuperarReservasParadas` CONSERTA — e conserta só o que o livro-caixa conhece.
//      Toda linha que ela toca é uma que NÓS desativamos, NÓS registramos, e sobre a
//      qual temos prova de que nunca liquidamos. Essa estreiteza é a segurança: não há
//      palpite nenhum sobre a intenção de ninguém. Não a alargue para além do
//      livro-caixa.
//
//   2. `relatarLeadsParados` RELATA, e não escreve NADA. Ela responde pela INVARIANTE —
//      lead sem nenhuma `lead_actions` ativa, tendo ao menos uma inativa — e por isso
//      acha o que o livro-caixa não pode achar: a órfã de um processo que morreu ANTES
//      do `registrarReservas` (ver A ORDEM em lib/sdr/reservas) e a sujeira legada de
//      antes de tudo isto existir.
//
//      "Sem linha ativa" diz que o lead está parado; NÃO diz por quê. Reativar às cegas
//      retomaria a campanha de quem pediu para parar, e mandar WhatsApp para quem pediu
//      para parar é o pior desfecho que este sistema consegue produzir — pior que lead
//      parado, pior que cota furada, pior que tudo o mais neste diretório. Então ela
//      devolve números e uma amostra, e quem conhece o contexto decide.
//
// O QUE ACONTECE QUANDO ALGUÉM PEDE PARA PARAR — o que eu procurei e o que achei
// Isto decide como o relatório tem de ser lido, então fica escrito em voz alta em vez
// de virar um `WHERE` que ninguém confere.
//
// NÃO EXISTE, NESTE REPOSITÓRIO, NENHUM SINAL DE OPT-OUT. O que foi conferido:
//
//   · varredura por `opt_out`/`optout`/`unsubscribe`/`descadastr`/`blacklist`/
//     `lista_negra`/`nao_perturbe`/`consent`/`LGPD`/`sair`/`parar`/`cancelar` em todo o
//     repositório (.ts, .tsx, .sql, .md, .json) e no histórico do git. Os acertos são
//     todos de outro assunto: botão "Sair" da interface, remoção de usuário, mensagem de
//     bloqueio de SSRF. O único acerto literal de "opt-out" é uma prop de UI em
//     components/ui/Badge.tsx, que não tem nada com campanha;
//   · as mensagens RECEBIDAS chegam (app/api/webhooks/ycloud/[token]) e param no banco DA
//     APP, por lib/sync/runner: aquele caminho não abre a base do cliente e não olha o
//     TEXTO de mensagem nenhuma. Não existe palavra-chave, não existe ramo por conteúdo.
//     O ack (app/api/sdr/dispatch/ack) é CONFIRMAÇÃO DE ENVIO, não resposta do lead;
//   · as seis únicas escritas na base do cliente em todo o repositório (config-write,
//     enroll-write, leads-write, as duas da régua e a do regua-ack) são disparadas por
//     ação do OPERADOR ou pelo avanço da campanha. Nenhuma é disparada por algo que um
//     lead diga.
//
// As colunas do `leads` do cliente são `id`, `name`, `phone`, `phone_adjusted`,
// `company`, `source`, `status`, `ativo`, `created_at` e `dealid`. Três pareciam
// candidatas e nenhuma das três serve:
//
//   · `leads.status` NÃO é opt-out, e é a mais perigosa de confundir: a importação grava
//     'novo', a planilha do operador pode gravar texto livre qualquer, e lib/sdr/regua-ack
//     SOBRESCREVE a coluna com a FASE recém-enviada a cada envio. É marcador de progresso,
//     e apaga o que estava antes. A tela de leads pinta 'inativo' de vermelho, o que faz
//     esse valor PARECER o sinal — mas nenhum código o escreve, e o primeiro ack o apaga.
//   · `leads.dealid` existe em produção (app/api/sdr/leads o seleciona), não aparece em
//     DDL de teste nenhum e não tem significado documentado em lugar algum. Quase
//     certamente referência de negócio no CRM.
//   · `leads.ativo` é a única candidata sobrevivente, e não passa de candidata: a
//     importação grava `true` e NADA neste repositório grava `false` nem nunca a atualiza.
//     Quem escreve `false` — se alguém escreve — é o fluxo do n8n, que não está aqui. Não
//     sei o que significa, e chutar seria o pior dos dois mundos: usada como filtro,
//     esconderia lead genuinamente parado; ignorada, jogaria fora a única pista que há.
//
// FICA UM PONTO CEGO, e é honesto declará-lo: a base do cliente tem `lead_logs`, com a
// coluna de texto livre `tipo_interacao`, que lib/providers/supabase-n8n lê com `SELECT *`
// e repassa sem traduzir. Os valores possíveis dela não estão enumerados em lugar nenhum
// deste repositório. Se o n8n do cliente registrou opt-out em algum lugar da base dele,
// é ali. Um `SELECT DISTINCT tipo_interacao FROM lead_logs` numa base real responderia —
// e é o primeiro passo de quem for tentar filtrar este relatório de verdade.
//
// A DECISÃO, portanto: o relatório NÃO FILTRA por `leads.ativo` — ele CARREGA a coluna,
// em cada linha da amostra (`leadAtivo`) e como contagem à parte (`comLeadInativo`).
// Quem lê vê a pista e decide. E vale a frase que o filtro ausente obriga:
//
//   O RELATÓRIO PODE CONTER PESSOAS QUE PEDIRAM PARA PARAR. Ele não distingue "o
//   processo morreu no meio" de "alguém desistiu": as duas coisas deixam o lead sem
//   linha ativa, e a base do cliente não guarda a diferença em lugar que a app veja.
//   Nada aqui pode ser retomado em lote, por script, nem por botão de "consertar
//   todos". Cada lead desta lista é uma decisão de quem conhece o histórico dele.
//
// Se um dia aparecer o sinal — coluna nova, tabela de descadastro, o que for —, o lugar
// de usá-lo é o `HAVING` de `SQL_LEADS_PARADOS`, e este parágrafo é o que sai.
//
// A ORDEM DAS DUAS GRAVAÇÕES DA RECUPERAÇÃO — e o que cada sentido custa
// São dois bancos, e não existe transação que atravesse os dois. A ordem é escolhida:
//
//   1º  devolve na base do CLIENTE (`ativo = true`, via `devolverReservas` da régua);
//   2º  liquida no livro-caixa (`marcarDevolvidas` de lib/sdr/reservas).
//
// MORRER NO MEIO DESTA ORDEM custa: a linha do cliente voltou para a fila e o
// livro-caixa continua 'reservada'. A reserva segue gastando a cota do seu balde, então
// a cota fica PESSIMISTA por um dia — saem menos mensagens do que o limite permitia.
// Nada se perde, e a própria varredura seguinte conserta: `listarReservasParadas`
// devolve a reserva de novo, a guarda logo abaixo vê que o lead JÁ TEM ação ativa, e o
// livro-caixa é liquidado sem tocar no cliente. Autocorrige.
//
// MORRER NO MEIO DA ORDEM CONTRÁRIA (livro-caixa primeiro) custa: a reserva fica
// 'devolvida' e a linha do cliente continua `ativo = false`. E aí acabou —
// `listarReservasParadas` só acha o que está 'reservada', então NENHUMA varredura
// futura olha para aquela linha outra vez. O lead está fora da campanha para sempre,
// sem erro em lugar nenhum, e a única coisa que ainda o enxergaria é o relatório da
// invariante, que de propósito não conserta. É o lead perdido em silêncio, que é o
// defeito que este diretório inteiro existe para eliminar.
//
// Cota pessimista por um dia contra lead perdido para sempre: a ordem é a primeira. É a
// mesma que o docblock de `marcarDevolvidas` prescreve, e não é coincidência — é a
// mesma conta.
//
// A GUARDA — por que a recuperação NÃO reativa às cegas
// Há um jeito de a reserva estar parada sem o lead estar parado: o ack avançou a fase
// (criou a `lead_actions` da fase seguinte, ATIVA) e falhou ANTES de liquidar o
// livro-caixa. A reserva velha continua lendo 'reservada', e reativar a linha dela
// daria ao lead DUAS ações ativas — que é exatamente a mensagem duplicada que este
// trabalho vem removendo. Uma varredura que se propõe a consertar não pode ser a porta
// por onde o defeito volta.
//
// Então antes de devolver qualquer coisa a recuperação PERGUNTA à base do cliente quais
// daqueles leads já têm ação ativa, e sobre esses não toca. O livro-caixa é liquidado
// dos dois lados — quem foi reativado e quem foi bloqueado —, porque em ambos os casos
// a reserva terminou: deixá-la 'reservada' faria a varredura seguinte reencontrar a
// mesma linha para sempre, gastando cota.
//
// O PREÇO DO 'devolvida' NO CASO BLOQUEADO, declarado: um lead bloqueado quase
// certamente RECEBEU a mensagem (foi o ack que avançou a fase dele). Marcá-lo
// 'devolvida' tira aquela vaga da conta da cota, então a cota daquele balde fica
// otimista em um. Não há status melhor disponível: 'enviada' exige o `messageId` do
// YCloud, que não temos, e 'falhou' diria que a tentativa deu errado, o que é falso.
// Entre inventar um desfecho e assumir um erro de um a mais numa cota de um balde que
// provavelmente já virou, assume-se o erro — e ele fica escrito aqui.
//
// A BORDA DO PRAZO É EXCLUSIVA, e o sentido da folga é escolhido
// `listarReservasParadas` filtra `claimed_at < antesDe`, estritamente menor. Uma reserva
// exatamente na idade do prazo NÃO é devolvida: fica em voo mais uma rodada. Na borda a
// direção conservadora é deixar em voo, porque devolver cedo é como a mesma pessoa
// recebe a mesma mensagem duas vezes — a linha volta para a fila enquanto o envio
// original ainda está a caminho. Deixar em voo custa uma rodada de atraso.
//
// CHAMAR DUAS VEZES NÃO DÓI. As duas gravações são idempotentes por construção:
// `devolverReservas` tem `AND ativo = false` e `marcarDevolvidas` tem
// `AND status = 'reservada'`. Duas varreduras simultâneas não reativam a mesma linha
// duas vezes nem liquidam o mesmo recibo duas vezes.
//
// ONDE ISTO RODA: em nenhum lugar, ainda. A recuperação é desenhada para ser a primeira
// coisa de cada rodada de seleção — é barata (uma consulta ao banco da app, e nem abre
// a base do cliente quando não há nada parado), autocurativa e não precisa de
// infraestrutura nova: o botão de disparo manual, sozinho, mantém o sistema honesto.
// Mas ligar não é deste lote, pelo mesmo motivo da régua e do livro-caixa: a lógica
// entra para ser revisada e testada ANTES de mudar quantas mensagens saem.
//
// OS DOIS BANCOS, e quem fala com qual: `listarReservasParadas` e `marcarDevolvidas`
// falam com o banco DA APP (lib/db); a guarda, `devolverReservas` e o relatório falam
// com a base do CLIENTE, pelo pool de lib/sdr/pg. A string de conexão chega pronta de
// quem chamou (lib/sdr/conexao-tenant) e nunca entra em log nem em mensagem de erro.
// Nenhum valor é colado em texto de SQL: tudo é parâmetro.
//
// NADA ACONTECE NA IMPORTAÇÃO: sem leitura de ambiente, sem conexão, sem relógio.

import { toDate } from '@/lib/date'
import { contagemUtilizavel, devolverReservas } from './regua'
import { listarReservasParadas, marcarDevolvidas } from './reservas'
import { withSdrDb } from './pg'

// ─── Ids que o Postgres aceita ────────────────────────────────────────────────

/**
 * Formato de uuid. Serve para uma coisa só: não mandar ao Postgres um `::uuid` que ele
 * vai recusar.
 *
 * `dispatch_claims.lead_id` e `lead_action_id` são `text` no NOSSO banco, e o que a
 * régua grava ali vem do schema do cliente — onde as duas são `uuid`. Na maior parte
 * dos casos batem. Mas `Descartado.leadId` da régua é `linha.lead_id ?? ''`: um descarte
 * por `lead_ausente` registra a reserva com `leadId` VAZIO, de propósito (sumir com ela
 * seria fabricar reserva órfã). Esse `''` chegando a um `''::uuid` derruba a instrução
 * inteira — e, como a varredura reencontraria a mesma linha a cada rodada, derrubaria
 * TODA varredura futura daquele tenant. Uma reserva malformada travaria a recuperação
 * de todas as outras.
 *
 * Por isso a conferência é aqui, antes do parâmetro sair: id irreconhecível não vai ao
 * banco do cliente, não é reativado (não há como provar que o lead está livre) e tem o
 * recibo liquidado, para parar de gastar cota e parar de voltar.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor.trim())
}

// ─── Recuperação: contrato ────────────────────────────────────────────────────

/** Por que a recuperação NÃO reativou a linha de uma reserva parada. */
export type MotivoDoBloqueio =
  /**
   * O lead já tem `lead_actions` ATIVA na base do cliente. É o sintoma de um ack que
   * avançou a fase e não liquidou o livro-caixa — ver A GUARDA no cabeçalho. Reativar
   * daria ao lead duas ações ativas, ou seja, mensagem duplicada.
   */
  | 'lead_com_acao_ativa'
  /**
   * Outra reserva parada DO MESMO LEAD foi reativada nesta mesma varredura. A guarda
   * vale dentro do lote também: consultar o banco e ignorar o que a própria varredura
   * está a ponto de escrever seria a mesma duplicação, só mais difícil de ver.
   */
  | 'outra_reserva_do_mesmo_lead'
  /** O `acaoId` ou o `leadId` do recibo não têm forma de uuid — ver UUID_RE. */
  | 'id_irreconhecivel'

/** Uma reserva parada que a recuperação liquidou SEM reativar a linha do cliente. */
export type ReservaBloqueada = {
  acaoId: string
  leadId: string
  motivo: MotivoDoBloqueio
}

export type PedidoDaRecuperacao = {
  /** Dono das reservas. O recorte do livro-caixa é por ele; o da base do cliente é a
   *  própria credencial. */
  tenantId: string
  /** O instante da rodada. Nomeia o carimbo de liquidação E nasce o prazo, para os dois
   *  não poderem divergir. */
  agora: Date
  /**
   * Quanto tempo uma reserva pode ficar em voo antes de ser considerada parada, em
   * milissegundos. O limiar é do CHAMADOR e não uma constante daqui, pelo mesmo motivo
   * de `listarReservasParadas`: é decisão operacional, não fato. Curto demais devolve
   * reserva que ainda ia ser enviada (e o lead recebe duas vezes); longo demais deixa o
   * lead parado. Esse número pertence a quem conhece o tempo de resposta do n8n.
   *
   * Entra como DURAÇÃO, e não como um `antesDe` pronto, porque duração mais `agora` é
   * um relógio só. Dois instantes independentes deixariam o corte do prazo e o carimbo
   * da liquidação virem de leituras diferentes do tempo — e essa divergência não daria
   * erro nenhum, daria reserva devolvida antes da hora.
   */
  prazoMs: number
}

export type ResultadoDaRecuperacao = {
  /** Reservas paradas que o livro-caixa entregou. */
  paradas: number
  /**
   * Linhas de `lead_actions` que voltaram a `ativo = true`. Pode ser MENOS que
   * `paradas - bloqueadas.length`: `devolverReservas` só conta o que ele mesmo virou, e
   * linha que outro caminho já tinha reativado não é contada duas vezes.
   */
  reativadas: number
  /** Recibos que saíram de 'reservada'. Normalmente igual a `paradas` — menos quando
   *  outra varredura liquidou algum no meio, que não é erro. */
  liquidadas: number
  /** As reservas que a guarda impediu de reativar. Vêm com id para o chamador LOGAR:
   *  `lead_com_acao_ativa` é sintoma de ack quebrado, não rotina. */
  bloqueadas: ReservaBloqueada[]
  /** O corte que foi usado (`agora - prazoMs`), para o chamador poder dizer de onde
   *  veio o número em vez de recalculá-lo. */
  antesDe: Date
}

// ─── Recuperação: SQL ─────────────────────────────────────────────────────────

/**
 * Quais destes leads já têm `lead_actions` ativa. É a guarda — ver A GUARDA no
 * cabeçalho.
 *
 * `a.ativo = true` é literal, e é a MESMA leitura de "ativo" que `SQL_RESERVAR` da
 * régua usa: linha com `ativo` NULL é invisível para a seleção, então ela não conta como
 * ação ativa aqui tampouco. Usar `IS NOT false` faria a guarda bloquear leads que a
 * campanha na prática não alcança, e a recuperação deixaria de recuperá-los.
 *
 * Os ids entram como JSON, e não como array do Postgres, pelo mesmo motivo de
 * `SQL_DEVOLVER` da régua e de lib/sdr/enroll-write: `jsonb` atravessa driver e
 * parâmetro sem depender de como cada um serializa array.
 *
 * `DISTINCT` porque a resposta é um conjunto de leads, não de linhas: um lead com três
 * ações ativas interessa uma vez.
 */
const SQL_LEADS_COM_ACAO_ATIVA = `
SELECT DISTINCT a.lead_id::text AS lead_id
  FROM lead_actions a
  JOIN jsonb_array_elements_text($1::jsonb) AS p(id) ON a.lead_id = p.id::uuid
 WHERE a.ativo = true`

// ─── Recuperação ──────────────────────────────────────────────────────────────

/**
 * Devolve as reservas que ficaram em voo tempo demais: reativa a `lead_actions` na base
 * do cliente e liquida o recibo no livro-caixa.
 *
 * Só toca o que o livro-caixa conhece, e isso é a segurança e não uma limitação — ver
 * DUAS CAPACIDADES no cabeçalho. A ordem das duas gravações, a guarda contra o lead que
 * já retomou e a borda do prazo estão todas explicadas lá; não mexa em nenhuma das três
 * sem ler o parágrafo correspondente.
 *
 * NÃO ABRE A BASE DO CLIENTE quando não há nada parado, e isso é do desenho: esta função
 * é para ser a primeira coisa de cada rodada de seleção, e no caso comum — que é "nada
 * parado" — ela custa uma consulta ao banco da app e mais nada.
 *
 * Erro da base do CLIENTE sobe como `SdrDbError` (pelo `withSdrDb` e pelo
 * `devolverReservas`); erro do banco da APP sobe cru. Nada é engolido: uma recuperação
 * "quase certa" é como se fabrica o silêncio que este trabalho veio acabar.
 */
export async function recuperarReservasParadas(
  connectionString: string,
  pedido: PedidoDaRecuperacao,
): Promise<ResultadoDaRecuperacao> {
  const { tenantId, agora, prazoMs } = pedido

  /* Prazo inválido é RECUSADO, e não aparado para um valor seguro, porque não existe
   * valor seguro nessa direção: `prazoMs` zero ou negativo põe o corte em `agora` ou no
   * futuro, e aí TODA reserva em voo parece parada — a varredura devolveria o lote que
   * o n8n está enviando neste instante e as pessoas receberiam a mensagem duas vezes.
   * `NaN` é pior ainda: viraria `Invalid Date` e viajaria até o parâmetro da consulta.
   * Um erro na chamada é barato; uma varredura que devolve tudo não é. */
  if (!Number.isFinite(prazoMs) || prazoMs <= 0) {
    throw new Error(
      `recuperarReservasParadas: prazoMs tem de ser um número finito e maior que zero ` +
        `(recebido: ${String(prazoMs)}). Zero ou negativo faria toda reserva em voo ` +
        `parecer parada, e devolver reserva em voo é como a mesma pessoa recebe a ` +
        `mesma mensagem duas vezes.`,
    )
  }

  const antesDe = new Date(agora.getTime() - prazoMs)
  const paradas = await listarReservasParadas(tenantId, antesDe)
  if (paradas.length === 0) {
    return { paradas: 0, reativadas: 0, liquidadas: 0, bloqueadas: [], antesDe }
  }

  /* Os recibos malformados saem da conta ANTES de qualquer parâmetro ir ao banco do
   * cliente — ver UUID_RE. Eles continuam sendo liquidados junto com o resto. */
  const bloqueadas: ReservaBloqueada[] = []
  const conferidas = paradas.filter(parada => {
    if (ehUuid(parada.acaoId) && ehUuid(parada.leadId)) return true
    bloqueadas.push({ acaoId: parada.acaoId, leadId: parada.leadId, motivo: 'id_irreconhecivel' })
    return false
  })

  /* A pergunta da guarda é por LEAD, não por ação: o que não pode acontecer é um lead
   * ficar com duas ações ativas. */
  const leadIds = Array.from(new Set(conferidas.map(parada => parada.leadId)))
  const comAcaoAtiva = new Set<string>()
  if (leadIds.length > 0) {
    const { rows } = await withSdrDb(connectionString, sdr =>
      sdr.query<{ lead_id: string | null }>(SQL_LEADS_COM_ACAO_ATIVA, [JSON.stringify(leadIds)]),
    )
    for (const linha of rows) if (linha.lead_id) comAcaoAtiva.add(linha.lead_id)
  }

  /* `conferidas` vem na ordem de `listarReservasParadas` — mais velha primeiro. A ordem
   * importa por causa do bloqueio `outra_reserva_do_mesmo_lead`: quando um lead tem duas
   * reservas paradas, a que volta é a que está parada há mais tempo, e a outra fica para
   * a varredura seguinte resolver (que a encontrará bloqueada por `lead_com_acao_ativa`,
   * e no mesmo estado final). Ordem qualquer daria resultado qualquer. */
  const aReativar: string[] = []
  /* Os leads que ESTA varredura já vai reativar. Conjunto à parte do que veio do banco,
   * e não o mesmo com acréscimos, para o motivo do bloqueio poder dizer a verdade: "o
   * ack te passou na frente" e "a sua irmã mais velha passou na frente" são sintomas
   * diferentes, e o primeiro é o que merece log. Os dois conjuntos são disjuntos por
   * construção — um lead que já tem ação ativa nunca entra em `aReativar`. */
  const reativadosNoLote = new Set<string>()
  for (const parada of conferidas) {
    if (comAcaoAtiva.has(parada.leadId)) {
      bloqueadas.push({ acaoId: parada.acaoId, leadId: parada.leadId, motivo: 'lead_com_acao_ativa' })
      continue
    }
    if (reativadosNoLote.has(parada.leadId)) {
      bloqueadas.push({ acaoId: parada.acaoId, leadId: parada.leadId, motivo: 'outra_reserva_do_mesmo_lead' })
      continue
    }
    aReativar.push(parada.acaoId)
    reativadosNoLote.add(parada.leadId)
  }

  // 1º O CLIENTE. Ver A ORDEM DAS DUAS GRAVAÇÕES no cabeçalho antes de trocar.
  const reativadas = aReativar.length > 0
    ? await devolverReservas(connectionString, aReativar)
    : 0

  /* 2º O LIVRO-CAIXA, e o LOTE INTEIRO: reativadas e bloqueadas. A reserva terminou nos
   * dois casos, e deixar uma bloqueada em 'reservada' a faria voltar em toda varredura
   * futura, gastando cota para sempre. Ver O PREÇO DO 'devolvida' no cabeçalho. */
  const liquidadas = await marcarDevolvidas(paradas.map(parada => parada.acaoId), agora)

  return { paradas: paradas.length, reativadas, liquidadas, bloqueadas, antesDe }
}

// ─── Relatório: contrato ──────────────────────────────────────────────────────

/**
 * Teto do tamanho da amostra. A base do cliente tem ~60 mil leads (censo de
 * 25/09/2026), e um relatório não é uma exportação: o que se lê à mão é dezena, não
 * dezena de milhar.
 *
 * Pedido acima do teto é APARADO, e não recusado — ao contrário do `prazoMs` da
 * recuperação, que é recusado. A assimetria é intencional e é a mesma de sempre: amostra
 * grande demais é só consulta pesada, e ninguém recebe mensagem por causa dela; prazo
 * errado manda mensagem duplicada. Recusa-se o que machuca pessoa, apara-se o que
 * machuca máquina.
 */
export const MAX_AMOSTRA = 500

/** Um lead parado, como o relatório o descreve. Nada aqui é nome nem telefone: o
 *  relatório sai da base do cliente com a chave dele e com o que explica o estado, e
 *  não com dado pessoal que ninguém pediu. */
export type LeadParado = {
  leadId: string
  /** Quantas `lead_actions` o lead tem. Todas inativas, por definição do filtro. */
  acoesInativas: number
  /** A `fase` da linha de agendamento mais recente — onde a campanha parou. */
  ultimaFase: string | null
  /** O `data_proxima_msg_outbound` mais recente. `null` quando nenhuma linha tem data. */
  ultimoAgendamento: Date | null
  /**
   * `leads.ativo` como está na base do cliente, sem interpretação. `null` quando a
   * coluna é NULL ou quando o `leads` do lead não existe mais (ver `temLead`).
   *
   * Viaja como PISTA, nunca como filtro — ver O QUE ACONTECE QUANDO ALGUÉM PEDE PARA
   * PARAR no cabeçalho. Não a transforme em `WHERE` sem descobrir primeiro o que o n8n
   * escreve nela.
   */
  leadAtivo: boolean | null
  /** `false` quando a `lead_actions` aponta para um `leads` que não existe mais —
   *  órfã do lado do cliente, e um motivo legítimo de o lead estar "parado". */
  temLead: boolean
}

export type RelatorioDeParados = {
  /** Quantos leads a base do cliente tem nessa situação. A conta INTEIRA, não o tamanho
   *  da amostra. */
  total: number
  /**
   * Quantos do `total` NÃO estão positivamente ativos em `leads.ativo` — `false`, NULL,
   * ou sem linha em `leads`. É o tamanho da parte do relatório que merece mais
   * desconfiança, e serve para quem lê saber de cara se está olhando sujeira de cadastro
   * ou lead de verdade preso na campanha.
   */
  comLeadInativo: number
  /** Até `limiteDaAmostra` leads, os de agendamento mais antigo primeiro. */
  amostra: LeadParado[]
  /** O teto efetivamente aplicado, já aparado por `MAX_AMOSTRA`. `total >
   *  amostra.length` diz que a amostra foi cortada. */
  limiteDaAmostra: number
}

// ─── Relatório: SQL ───────────────────────────────────────────────────────────

/**
 * Os leads sem NENHUMA `lead_actions` ativa, tendo ao menos uma linha. Conta o total e
 * devolve uma amostra, numa instrução só.
 *
 * SÓ LÊ. Nenhum `UPDATE`, nenhum `INSERT`, nenhum `DELETE`, e é o ponto inteiro desta
 * capacidade — ver DUAS CAPACIDADES no cabeçalho. O teste prende isso de duas formas:
 * comparando o retrato das tabelas do cliente antes e depois, e conferindo que nenhum
 * verbo de escrita chegou a passar pelo pool.
 *
 * `count(*) FILTER (WHERE a.ativo = true) = 0` é a invariante, e o `= true` é literal
 * pelo mesmo motivo de `SQL_RESERVAR`: em lógica de três valores, `ativo` NULL não é
 * `true`, e a régua nunca seleciona essa linha. Um lead cuja única linha tem `ativo`
 * NULL está tão parado quanto um com `ativo = false` — e está parado PELO FILTRO DA
 * PRÓPRIA RÉGUA, que é a definição que importa. Ele entra no relatório.
 *
 * `GROUP BY a.lead_id` é o que faz o lead SEM NENHUMA `lead_actions` ficar de fora sem
 * precisar de cláusula nenhuma: sem linha, não há grupo. Lead que a campanha nunca tocou
 * não está parado — está por começar, e isto não é um relatório de quem falta inscrever.
 *
 * `resumo` é a tabela da ESQUERDA, e essa é a forma que garante ao menos uma linha de
 * resposta: com amostra vazia (nada parado, ou `LIMIT 0`) volta a linha-resumo, com
 * `lead_id` NULL, e o `total` continua lá. É o mesmo desenho de `SQL_RESERVAR`, e quem
 * lê filtra num lugar só.
 *
 * A amostra é ordenada por agendamento mais ANTIGO primeiro, e desempatada por
 * `lead_id`: quem está parado há mais tempo é quem mais interessa, e o desempate é o que
 * torna a amostra estável entre duas leituras — relatório que muda de conteúdo sem a
 * base mudar não se compara com o de ontem. `NULLS LAST` para as linhas sem data não
 * ocuparem a frente da fila.
 *
 * VARRE A TABELA INTEIRA do cliente, por construção (é um `GROUP BY` sem `WHERE`), e por
 * isso o chamador usa o perfil de pool `largo` — a mesma razão da dedup de
 * lib/sdr/leads-write. Sob o teto de 10 s do perfil padrão, este relatório passaria a
 * abortar numa base grande.
 *
 * DEPENDE DE `leads.ativo` EXISTIR, e é a primeira consulta da app a ler essa coluna. Ela
 * é real em produção: lib/sdr/leads-write a ESCREVE em toda importação e
 * app/api/sdr/leads a SELECIONA na tela de leads. Numa base que não a tenha, isto sai
 * como `sdr_db_schema` — erro legível, com a mensagem "a base do SDR não tem a tabela ou
 * a coluna esperada" —, e não como silêncio. É o desfecho certo: a coluna é a única pista
 * de opt-out que existe, e um relatório que a omitisse em silêncio seria pior que um
 * relatório que não sai.
 */
const SQL_LEADS_PARADOS = `
WITH por_lead AS (
  SELECT a.lead_id,
         count(*)::int AS acoes_inativas,
         max(a.data_proxima_msg_outbound) AS ultima_data
    FROM lead_actions a
   GROUP BY a.lead_id
  HAVING count(*) FILTER (WHERE a.ativo = true) = 0
), resumo AS (
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE l.ativo IS NOT TRUE)::int AS com_lead_inativo
    FROM por_lead p
    LEFT JOIN leads l ON l.id = p.lead_id
)
SELECT r.total,
       r.com_lead_inativo,
       p.lead_id::text AS lead_id,
       p.acoes_inativas,
       p.ultima_data,
       u.fase AS ultima_fase,
       l.ativo AS lead_ativo,
       (l.id IS NOT NULL) AS tem_lead
  FROM resumo r
  LEFT JOIN LATERAL (
    SELECT pl.lead_id, pl.acoes_inativas, pl.ultima_data
      FROM por_lead pl
     ORDER BY pl.ultima_data ASC NULLS LAST, pl.lead_id ASC
     LIMIT $1::int
  ) p ON true
  LEFT JOIN leads l ON l.id = p.lead_id
  LEFT JOIN LATERAL (
    SELECT a.fase
      FROM lead_actions a
     WHERE a.lead_id = p.lead_id
     ORDER BY a.data_proxima_msg_outbound DESC NULLS LAST, a.id ASC
     LIMIT 1
  ) u ON true
 ORDER BY p.ultima_data ASC NULLS LAST, p.lead_id ASC`

/**
 * Uma linha de `SQL_LEADS_PARADOS` — que pode ser um lead ou a linha-resumo (`lead_id`
 * NULL), a que vem sozinha quando a amostra está vazia.
 *
 * Os numéricos são `number | string` porque o schema do cliente não é nosso e o `pg`
 * devolve `numeric`/`bigint` como texto. Os `count(*)::int` daqui chegam como número nos
 * dois drivers, então a leitura defensiva é cinto e não suspensório — fica porque é o
 * que já vale para `id_fase` em lib/sdr/regua, e porque uma coluna que muda de tipo não
 * deve virar `NaN` viajando pelo relatório.
 */
type LinhaDoRelatorio = {
  total: number | string | null
  com_lead_inativo: number | string | null
  lead_id: string | null
  acoes_inativas: number | string | null
  ultima_data: Date | string | null
  ultima_fase: string | null
  lead_ativo: boolean | null
  tem_lead: boolean | null
}

/** O teto pedido, aparado para um inteiro entre 0 e `MAX_AMOSTRA`. `0` é pedido
 *  legítimo: devolve só as contagens, sem amostra nenhuma. */
function tetoDaAmostra(valor: unknown): number {
  const pedido = contagemUtilizavel(valor)
  if (pedido === null) return 0
  return Math.min(pedido, MAX_AMOSTRA)
}

// ─── Relatório ────────────────────────────────────────────────────────────────

/**
 * Relata os leads parados na campanha pela INVARIANTE: nenhuma `lead_actions` ativa,
 * tendo ao menos uma inativa.
 *
 * NÃO CONSERTA NADA, e essa é a definição da função e não uma etapa que falta. Leia O
 * QUE ACONTECE QUANDO ALGUÉM PEDE PARA PARAR no cabeçalho antes de escrever qualquer
 * coisa que aja sobre o que ela devolve: o relatório não distingue "o processo morreu no
 * meio" de "a pessoa desistiu", e retomar a campanha de quem desistiu é o pior desfecho
 * que este sistema produz.
 *
 * Não recebe `tenantId`: a credencial JÁ É o recorte do tenant — nenhuma consulta na
 * base do cliente é filtrada por ele, como em lib/sdr/regua.
 *
 * FALSO POSITIVO CONHECIDO, declarado: uma reserva EM VOO deixa a linha `ativo = false`,
 * então um lead reservado há dois minutos aparece aqui como parado. O relatório não
 * consulta o livro-caixa para descontá-los, de propósito — cruzar os dois bancos
 * amarraria a invariante ao livro-caixa, e é justamente para ver o que o livro-caixa não
 * vê que ela existe. O que reduz esse ruído é a ordem de uso: rodar
 * `recuperarReservasParadas` antes, o que deixa em voo somente as reservas mais novas
 * que o prazo. É mais um motivo para não agir em lote sobre esta lista.
 *
 * Erro da base do cliente sobe como `SdrDbError`, pelo `withSdrDb`.
 */
export async function relatarLeadsParados(
  connectionString: string,
  opts: { limiteDaAmostra: number },
): Promise<RelatorioDeParados> {
  const limiteDaAmostra = tetoDaAmostra(opts?.limiteDaAmostra)

  /* Perfil `largo`: a consulta agrupa `lead_actions` inteira — ver o docblock de
   * SQL_LEADS_PARADOS. Sob o teto de 10 s do perfil padrão ela abortaria na base de
   * 60 mil leads, e um relatório que às vezes não sai é um relatório em que ninguém
   * confia. */
  const { rows } = await withSdrDb(
    connectionString,
    sdr => sdr.query<LinhaDoRelatorio>(SQL_LEADS_PARADOS, [limiteDaAmostra]),
    'largo',
  )

  /* A consulta devolve SEMPRE ao menos uma linha — o resumo é a tabela da esquerda —, e
   * as contagens vêm iguais em todas elas, então a primeira serve. Zero linhas só
   * aconteceria se a consulta mudasse de forma. */
  const primeira = rows[0]
  const total = primeira ? contagemUtilizavel(primeira.total) ?? 0 : 0
  const comLeadInativo = primeira ? contagemUtilizavel(primeira.com_lead_inativo) ?? 0 : 0

  const amostra: LeadParado[] = rows
    .filter((linha): linha is LinhaDoRelatorio & { lead_id: string } => linha.lead_id !== null)
    .map(linha => ({
      leadId: linha.lead_id,
      acoesInativas: contagemUtilizavel(linha.acoes_inativas) ?? 0,
      ultimaFase: linha.ultima_fase,
      // `toDate` de lib/date porque a coluna é do cliente: o `pg` devolve `Date`, mas um
      // `timestamp` como texto ou um ISO atravessando JSON não podem virar
      // `Invalid Date` dentro de um relatório.
      ultimoAgendamento: toDate(linha.ultima_data),
      leadAtivo: linha.lead_ativo,
      // `=== true` e não `!!`: a coluna é um booleano do Postgres, e a diferença entre
      // "não existe lead" e "o driver devolveu algo estranho" não deve virar `true`.
      temLead: linha.tem_lead === true,
    }))

  return { total, comLeadInativo, amostra, limiteDaAmostra }
}
