// Livro-caixa das reservas da régua de disparo — o recibo que `lead_actions` não tem.
//
// POR QUE EXISTE
// lib/sdr/regua RESERVA linhas na base do CLIENTE marcando `lead_actions.ativo = false`
// dentro da mesma instrução que as seleciona. Aquele schema é do cliente: não há como
// acrescentar uma coluna lá dizendo "esta reserva é minha, é das 14h03, e ainda não
// terminou". Sem essa marca, duas coisas verificadas quebram:
//
//   1. COTA FURADA. O desconto do limite diário conta `blast_recipients` no balde do
//      dia — e quem escreve lá é o ack, DEPOIS de o n8n enviar. Reserva em voo é
//      invisível para essa conta: duas rodadas em sequência rápida, antes de o primeiro
//      ack chegar, recebem CADA UMA a cota restante inteira, e um `limite_diario` de 10
//      manda 20 ou mais. É o defeito "limite por execução em vez de por dia" — que a
//      régua veio matar no n8n — voltando por outra porta, a nossa.
//
//   2. RESERVA ÓRFÃ. Uma linha reservada fica `ativo = false`, byte a byte o mesmo
//      estado de uma que terminou a campanha legitimamente. Não há marca de quem
//      reservou, nem quando, nem prazo. Morto o processo depois de o UPDATE confirmar,
//      aqueles ids não existem em lugar nenhum: ninguém envia, ninguém devolve, e
//      aqueles leads saem da campanha em silêncio e para sempre.
//
// Uma linha nesta tabela resolve as duas: a reserva em voo passa a ser CONTÁVEL (defeito
// 1, resolvido aqui e agora) e a reserva velha passa a ser ENCONTRÁVEL (defeito 2 —
// resolvido só em parte; ver A ORDEM, logo abaixo).
//
// A ORDEM, E O BURACO QUE ELA DEIXA — leia antes de acreditar que a órfã acabou
// São dois bancos e duas gravações, e elas NÃO confirmam juntas. Não existe transação
// que atravesse os dois: um é o Postgres do cliente, o outro é o nosso.
//
//   1º  a régua reserva na base do CLIENTE (`ativo = false`) e isso CONFIRMA;
//   2º  o chamador registra o lote aqui, no banco DA APP.
//
// Esta ordem é escolhida, não acidental. Ao contrário, registrar aqui primeiro criaria
// reserva que não existe: a linha do cliente continuaria `ativo = true`, o cron antigo
// a pegaria, e a nossa cota estaria gasta com uma mensagem que sairia por outro caminho.
// Fantasma custa mensagem duplicada; o buraco desta ordem custa, no pior caso, uma
// reserva velha — e reserva velha é recuperável, mensagem entregue duas vezes não é.
//
// O QUE ESTA ORDEM GARANTE: se `registrarReservas` LEVANTAR, o chamador sabe quais ids
// reservou e devolve na hora (`devolverReservas` da régua). Nada some.
//
// O QUE ELA NÃO GARANTE, e este módulo NÃO fecha: o processo morrer ENTRE as duas
// gravações. Aí a linha do cliente está `ativo = false` e aqui não há linha nenhuma —
// uma órfã que este livro-caixa não enxerga, porque ela nunca foi escrita nele. Nenhuma
// função daqui a encontra; `listarReservasParadas` só acha o que FOI registrado. Esse
// resto é fechado por uma recuperação baseada em INVARIANTE (varrer a base do cliente
// procurando `lead_actions` inativa que não tem linha correspondente aqui), e isso é
// outro lote. Não leia nenhum parágrafo acima como se ele já existisse.
//
// ESTE MÓDULO AINDA NÃO É CHAMADO POR NINGUÉM, pelo mesmo motivo da régua: a lógica
// entra para ser revisada e testada ANTES de mudar quantas mensagens saem. Ligar os dois
// é outro lote — e quando for, atenção à CONTA DUPLA logo abaixo.
//
// CONTA DUPLA — o erro fácil de cometer no lote que ligar isto
// `contarConsumidasHoje` tem a assinatura exata da porta `contarEnviadosHoje` da régua
// (`(tenantId, agora) => Promise<number>`), e é de propósito: ela ENTRA no lugar da
// contagem de `blast_recipients`, não ao lado dela. Somar as duas contaria a mesma
// mensagem duas vezes — toda reserva que vira 'enviada' aqui também vira uma linha de
// `blast_recipients` pelo ack. Quando este módulo for ligado, a contagem daqui é a que
// vale; a de lá continua útil só enquanto o cron antigo do n8n existir, porque o cron
// antigo não passa por reserva nenhuma (ver CONTAGEM INCOMPLETA em lib/sdr/regua).
//
// O BANCO É O NOSSO. Tudo aqui fala com o Postgres da app, pela fachada preguiçosa de
// lib/db — `lib/sdr/pg` e as credenciais do cliente NÃO entram neste arquivo. Nenhum
// valor é colado em texto de SQL: quem monta as instruções é o drizzle, parametrizado.
// Erro de banco SOBE; nada aqui é engolido. Registrar reserva "quase certo" é como se
// fabrica o silêncio que este trabalho veio acabar.
//
// NADA ACONTECE NA IMPORTAÇÃO: sem leitura de ambiente, sem conexão, sem relógio.

import { randomUUID } from 'crypto'
import { and, asc, count, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dispatchClaims } from '@/lib/db/schema'
import { baldeDoDia } from './regua'

// ─── Vocabulário de status ────────────────────────────────────────────────────

/**
 * Como uma reserva pode estar. Quatro valores, porque quatro perguntas diferentes
 * precisam de resposta — e as duas colunas que a tentação sugeria (um booleano "em voo"
 * mais um desfecho) podem se contradizer entre si.
 *
 *   · `reservada` — EM VOO. A linha do cliente está `ativo = false` e ninguém disse
 *     ainda o que aconteceu. É o estado que a cota precisa enxergar e que hoje não
 *     existe em lugar nenhum.
 *   · `enviada`   — o n8n confirmou o envio; o `ycloudMessageId` está preenchido. É o
 *     'enviado' de `blast_recipients`, no feminino porque aqui o sujeito é a reserva.
 *   · `falhou`    — a tentativa ACONTECEU e deu errado. Verbo, e não adjetivo, pelo
 *     mesmo motivo de `blast_recipients.status`.
 *   · `devolvida` — a reserva voltou para a fila (`ativo = true` de novo na base do
 *     cliente). O lead será selecionado outra vez.
 *
 * Os três últimos são TERMINAIS: nenhuma função daqui tira uma reserva de um deles. Uma
 * ação devolvida que for reservada de novo amanhã ganha uma LINHA NOVA, com id novo —
 * é por isso que o índice único é parcial (ver lib/db/schema).
 */
export type StatusDaReserva = 'reservada' | 'enviada' | 'falhou' | 'devolvida'

/**
 * Os status que GASTAM a cota do dia.
 *
 * `reservada` entra porque é o motivo de toda esta tabela existir: uma reserva em voo já
 * comprometeu uma vaga, mesmo que o ack ainda não tenha chegado.
 *
 * `devolvida` fica de fora sem discussão: a linha voltou para a fila e o lead será
 * selecionado de novo. Contá-la seria cobrar duas vezes pela mesma mensagem.
 *
 * `falhou` FICA DE FORA, e esta é a única escolha aqui que tem dois lados de verdade:
 *
 *   CONTANDO a falha, a cota vira teto de TENTATIVAS: um template recusado ou meia hora
 *   de YCloud fora às 9h come a permissão do dia inteiro, e a campanha fica muda até
 *   amanhã mesmo depois de tudo voltar. Pior: o motivo que o operador leria seria
 *   `limite_diario_atingido`, que seria FALSO — o limite não foi alcançado por
 *   mensagem nenhuma. Frase falsa num módulo cujo trabalho é explicar o zero é pior que
 *   zero sem explicação.
 *
 *   NÃO CONTANDO, a cota vira teto de ENVIOS, que é o que a tela de Parâmetros promete
 *   ("quantas pessoas recebem mensagem hoje"). O preço é real e não se esconde: uma
 *   configuração que falha SEMPRE deixa cada rodada tentar a cota inteira de novo, e
 *   três rodadas de cron por dia gastam três vezes o limite em tentativas de YCloud.
 *
 * Decidido pelo que o número CONFIGURADO significa: `limite_diario` é um limite de
 * mensagens entregues a pessoas, e uma falha não chegou a pessoa nenhuma. O risco do
 * outro lado — tentativa em loop — é real mas é de outra ferramenta: quem para um
 * disparo que só falha é um disjuntor (N falhas seguidas, desliga), não a cota diária.
 * O disjuntor não existe ainda; o que existe, e é o que torna ele possível depois, é
 * que a falha FICA REGISTRADA aqui em vez de sumir.
 */
export const STATUS_QUE_CONSOMEM: readonly StatusDaReserva[] = ['reservada', 'enviada']

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Uma reserva recém-feita pela régua. Os quatro campos são exatamente os que
 * `Destinatario` e `Descartado` de lib/sdr/regua carregam — de propósito: o chamador
 * repassa o que recebeu, sem remontar nada.
 */
export type NovaReserva = {
  /** A `lead_actions.id` que ficou `ativo = false` na base do cliente. */
  acaoId: string
  leadId: string
  fase: string
  /** `null` quando a base do cliente não tem o número da fase — a régua já normaliza. */
  idFase: number | null
}

/** Uma reserva em voo que passou do prazo. É o que a recuperação lê para devolver. */
export type ReservaParada = {
  /** A chave desta LINHA. Não confundir com `acaoId`, que é a chave lá no cliente. */
  id: string
  tenantId: string
  acaoId: string
  leadId: string
  fase: string
  idFase: number | null
  balde: string
  reservadaEm: Date
}

// ─── Registrar ────────────────────────────────────────────────────────────────

/**
 * Registra um lote de reservas recém-feitas. Chamado LOGO DEPOIS de a régua reservar na
 * base do cliente — ver A ORDEM no cabeçalho.
 *
 * Uma instrução só para o lote inteiro (o drizzle monta um INSERT multi-linha), e não
 * um INSERT por reserva, por dois motivos que são o mesmo: um lote parcialmente gravado
 * é a pior saída possível — metade das reservas contável e metade invisível — e é
 * exatamente isso que um laço de INSERTs produz quando o quinto falha.
 *
 * O instante entra como parâmetro em vez de `new Date()` aqui dentro porque ele nomeia
 * o BALDE: a reserva tem de cair no mesmo dia em que a régua conferiu a cota, e não no
 * dia em que este INSERT por acaso rodou. Balde e carimbo saem do mesmo `agora`.
 *
 * `acaoId` repetido no mesmo lote NÃO é desduplicado, e isso é escolha: a régua não tem
 * como devolver a mesma `lead_actions` duas vezes (é chave primária lá), então repetição
 * é defeito de quem chamou. O índice único parcial recusa, a instrução inteira cai, e o
 * chamador devolve o lote — que é o desfecho certo. Desduplicar em silêncio registraria
 * menos reservas do que existem no cliente, ou seja, fabricaria órfã para esconder um bug.
 *
 * Devolve quantas linhas foram gravadas. Lote vazio não abre conexão.
 */
export async function registrarReservas(
  tenantId: string,
  agora: Date,
  reservas: NovaReserva[],
): Promise<number> {
  if (!Array.isArray(reservas) || reservas.length === 0) return 0

  /* O balde vem de `baldeDoDia` da régua, e nunca de uma fórmula remontada aqui. Ele
   * tem de ser byte a byte o mesmo que `dayBucketId` de app/api/sdr/dispatch/ack
   * produz: divergir não daria erro nenhum — daria uma contagem eternamente zero, ou
   * seja, limite diário nenhum. Uma cópia da fórmula é como essa divergência nasce. */
  const balde = baldeDoDia(tenantId, agora)

  const linhas = reservas.map(reserva => ({
    id: randomUUID(),
    tenantId,
    leadActionId: reserva.acaoId,
    leadId: reserva.leadId,
    phase: reserva.fase,
    phaseNumber: reserva.idFase,
    dayBucket: balde,
    status: 'reservada' as const,
    ycloudMessageId: null,
    claimedAt: agora,
    settledAt: null,
  }))

  /* `returning` e não a contagem de linhas afetadas do driver: é o que funciona igual
   * no `pg` de produção e no PGlite do teste — o mesmo motivo de `devolverReservas` em
   * lib/sdr/regua. O que volta é o que o banco realmente gravou. */
  const gravadas = await db.insert(dispatchClaims).values(linhas).returning({ id: dispatchClaims.id })
  return gravadas.length
}

// ─── Contar a cota ────────────────────────────────────────────────────────────

/**
 * Quanto da cota de hoje este tenant já comprometeu: reservas EM VOO mais reservas já
 * enviadas, no balde do dia. Ver STATUS_QUE_CONSOMEM para por que a falha fica de fora.
 *
 * É esta função que fecha a COTA FURADA do cabeçalho, e o "em voo" é o ponto inteiro: a
 * contagem de `blast_recipients` só enxerga o que o ack já escreveu, e por isso duas
 * rodadas seguidas recebem cada uma a cota inteira. Aqui a primeira rodada já aparece.
 *
 * A assinatura é a da porta `contarEnviadosHoje` da régua, para entrar NO LUGAR dela —
 * ver CONTA DUPLA no cabeçalho antes de somar as duas.
 */
export async function contarConsumidasHoje(tenantId: string, agora: Date): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(dispatchClaims)
    .where(and(
      eq(dispatchClaims.tenantId, tenantId),
      eq(dispatchClaims.dayBucket, baldeDoDia(tenantId, agora)),
      // `inArray` e não dois `eq` com `or`: é a forma que o índice
      // (tenant_id, day_bucket, status) atende direto.
      inArray(dispatchClaims.status, [...STATUS_QUE_CONSOMEM]),
    ))

  return linha?.total ?? 0
}

// ─── Liquidar ─────────────────────────────────────────────────────────────────

/**
 * Tira UMA reserva de voo. Privada: quem chama de fora usa `liquidarComoEnviada` ou
 * `liquidarComoFalha`, que dizem no nome o que aconteceu.
 *
 * A chave é o `acaoId` e não o `id` da linha, porque é o `acaoId` que o chamador tem em
 * mãos (é o que a régua devolve em cada `Destinatario`) e é ele que o n8n pode carregar
 * de volta no ack. O `AND status = 'reservada'` faz duas coisas ao mesmo tempo: torna a
 * instrução idempotente — liquidar duas vezes não reescreve o desfecho nem o carimbo —
 * e, junto com o índice único parcial, garante que ela atinge UMA linha, sem desempate.
 * Um ack repetido ou atrasado não desfaz uma devolução.
 *
 * Devolve quantas linhas mudaram: 1 quando liquidou, 0 quando não havia reserva viva
 * para aquela ação. Zero NÃO é erro — é informação, e quem chama decide o que fazer com
 * ela (ack duplicado é rotina; ack de reserva que ninguém registrou é sintoma).
 */
async function liquidar(
  acaoId: string,
  status: Exclude<StatusDaReserva, 'reservada'>,
  agora: Date,
  ycloudMessageId: string | null,
): Promise<number> {
  const mudadas = await db
    .update(dispatchClaims)
    .set({ status, settledAt: agora, ...(ycloudMessageId === null ? null : { ycloudMessageId }) })
    .where(and(
      eq(dispatchClaims.leadActionId, acaoId),
      eq(dispatchClaims.status, 'reservada'),
    ))
    .returning({ id: dispatchClaims.id })

  return mudadas.length
}

/**
 * A mensagem saiu: grava o `messageId` do YCloud e fecha a reserva como enviada.
 *
 * O `messageId` é o que liga esta linha à de `blast_recipients` que o ack cria — sem ele
 * a reserva fica sem prova de que virou mensagem, e é a mesma pergunta ("esta reserva
 * chegou a alguém?") que o livro-caixa existe para responder.
 */
export function liquidarComoEnviada(
  acaoId: string,
  ycloudMessageId: string,
  agora: Date,
): Promise<number> {
  return liquidar(acaoId, 'enviada', agora, ycloudMessageId)
}

/**
 * A tentativa aconteceu e falhou. A reserva fecha como `falhou` e NÃO gasta a cota do
 * dia (ver STATUS_QUE_CONSOMEM).
 *
 * Atenção ao que isto NÃO faz: a linha na base do cliente continua `ativo = false`. Se o
 * lead deve voltar para a fila, quem chama tem de devolver lá (`devolverReservas` da
 * régua) e marcar aqui com `marcarDevolvidas` — são desfechos diferentes de propósito.
 * `falhou` é "tentou e não deu, não tente de novo por ora"; `devolvida` é "volta para a
 * fila". Fundir os dois apagaria a única pista de que um template está quebrado.
 */
export function liquidarComoFalha(acaoId: string, agora: Date): Promise<number> {
  return liquidar(acaoId, 'falhou', agora, null)
}

// ─── Devolver ─────────────────────────────────────────────────────────────────

/**
 * Marca reservas como devolvidas — o espelho, no livro-caixa, do `devolverReservas` da
 * régua. A partir daqui elas param de gastar a cota, porque os leads voltaram para a
 * fila e serão selecionados de novo.
 *
 * É em LOTE porque a devolução do outro lado é em lote: devolver dez linhas no cliente e
 * marcar uma aqui deixaria nove reservas contando cota que ninguém vai usar. Uma
 * instrução só, pelo mesmo motivo do registro.
 *
 * A ORDEM ao devolver é a inversa do registro, e também é escolhida: devolve-se PRIMEIRO
 * na base do cliente (`ativo = true`) e só então marca-se aqui. Falhar no meio deixa uma
 * linha 'reservada' para um lead que já voltou à fila — ou seja, cota gasta a mais por um
 * dia, que é conservador. A ordem contrária deixaria o lead fora da campanha com a cota
 * liberada, que é justamente o lead perdido em silêncio.
 *
 * Só atinge o que está EM VOO: uma reserva já enviada não é desfeita por uma devolução
 * atrasada. Devolve quantas linhas mudaram, que pode ser menos que o pedido.
 */
export async function marcarDevolvidas(acaoIds: string[], agora: Date): Promise<number> {
  /* Mesmo filtro de `devolverReservas` em lib/sdr/regua: texto com conteúdo, sem
   * repetição. Aqui a desduplicação não muda o resultado (é um UPDATE, não um INSERT),
   * mas mantém o parâmetro do mesmo tamanho dos dois lados da devolução. */
  const ids = Array.from(new Set(
    (Array.isArray(acaoIds) ? acaoIds : [])
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .map(id => id.trim()),
  ))
  if (ids.length === 0) return 0

  const mudadas = await db
    .update(dispatchClaims)
    .set({ status: 'devolvida', settledAt: agora })
    .where(and(
      inArray(dispatchClaims.leadActionId, ids),
      eq(dispatchClaims.status, 'reservada'),
    ))
    .returning({ id: dispatchClaims.id })

  return mudadas.length
}

// ─── Varredura ────────────────────────────────────────────────────────────────

/**
 * As reservas em voo mais velhas que `antesDe` — o que a recuperação lê para devolver.
 *
 * "Parada" é uma reserva que ficou `reservada` tempo demais: o n8n não respondeu, o
 * processo caiu, o ack se perdeu. O limiar é do CHAMADOR e não uma constante daqui
 * porque ele é uma decisão operacional, não um fato: curto demais devolve reserva que
 * ainda ia ser enviada (e o lead recebe duas vezes), longo demais deixa o lead parado.
 * Esse número pertence a quem conhece o tempo de resposta do n8n.
 *
 * Por tenant porque a recuperação é por tenant: devolver a reserva exige abrir a base
 * DAQUELE cliente, com a credencial dele. Uma varredura de todos os tenants é um laço de
 * quem já tem a lista de credenciais — não é este módulo que a monta.
 *
 * O QUE ELA NÃO ACHA, e é o buraco do cabeçalho: reserva que nunca foi registrada aqui.
 * Um processo morto ENTRE a reserva no cliente e o `registrarReservas` não deixa linha
 * nenhuma para esta consulta encontrar. Isso é da recuperação por invariante, outro lote.
 *
 * Mais velha primeiro: quem está parado há mais tempo é quem mais precisa voltar.
 */
export async function listarReservasParadas(
  tenantId: string,
  antesDe: Date,
): Promise<ReservaParada[]> {
  const linhas = await db
    .select({
      id: dispatchClaims.id,
      tenantId: dispatchClaims.tenantId,
      acaoId: dispatchClaims.leadActionId,
      leadId: dispatchClaims.leadId,
      fase: dispatchClaims.phase,
      idFase: dispatchClaims.phaseNumber,
      balde: dispatchClaims.dayBucket,
      reservadaEm: dispatchClaims.claimedAt,
    })
    .from(dispatchClaims)
    .where(and(
      eq(dispatchClaims.tenantId, tenantId),
      eq(dispatchClaims.status, 'reservada'),
      /* Estritamente MENOR: uma reserva exatamente na idade do limiar ainda não passou
       * dele. Na borda, a escolha conservadora é deixar em voo — devolver cedo demais é
       * o caminho para a mesma pessoa receber a mensagem duas vezes. */
      lt(dispatchClaims.claimedAt, antesDe),
    ))
    .orderBy(asc(dispatchClaims.claimedAt))

  return linhas
}
