// O outro lado da régua de disparo: o que acontece DEPOIS de a mensagem sair.
//
// POR QUE EXISTE
// lib/sdr/regua escolhe a `lead_actions` devida e a RESERVA marcando `ativo = false`
// na base do cliente; lib/sdr/reservas guarda o recibo dessa reserva no banco da app.
// Faltava o fecho, e a falta estava escrita em voz alta no cabeçalho da régua: o ack
// (app/api/sdr/dispatch/ack) gravava o `messageId` em `blast_recipients` e parava aí —
// não abria `lead_actions`, não avançava fase, não agendava a próxima mensagem, não
// escrevia `leads.status`. Um lead reservado e enviado por aquele caminho ficaria com
// `ativo = false` na MESMA fase, para sempre: fora da campanha, sem erro em lugar
// nenhum. Este módulo é esse fecho.
//
// O QUE MUDA DE LUGAR, e o que não muda
// O fluxo antigo do n8n fazia três coisas depois de cada envio: criava a `lead_actions`
// da fase seguinte, DESATIVAVA a linha atual e escrevia `leads.status`. A desativação
// já aconteceu — é a própria reserva da régua, feita na mesma instrução que selecionou
// a linha. Então o que vem para cá são as outras duas: criar a próxima e marcar o lead.
//
// AS DUAS GUARDAS DE IDEMPOTÊNCIA, e por que são duas
// O n8n repete a chamada HTTP quando a resposta demora ou some. Um segundo ack que
// criasse uma segunda linha da fase seguinte DOBRARIA a campanha daquele lead em
// silêncio — duas ações ativas, duas mensagens por rodada. As duas guardas são
// independentes e valem as duas:
//
//   1. O AVANÇO é idempotente no SQL: a linha nova só nasce quando o lead NÃO tem
//      `lead_actions` ativa nenhuma — o mesmo `NOT EXISTS` de lib/sdr/enroll-write,
//      letra por letra e pelo mesmo motivo. Como o próprio avanço deixa uma ativa, o
//      segundo ack encontra a porta fechada e não grava nada.
//   2. A LIQUIDAÇÃO do livro-caixa é idempotente pelo `AND status = 'reservada'` de
//      lib/sdr/reservas, e o número de linhas que ela muda é a resposta para "este ack
//      é o primeiro?" — 1 no primeiro, 0 em todos os seguintes.
//
// O QUE A GUARDA 1 NÃO FECHA, e não dá para fechar daqui: dois acks SIMULTÂNEOS para o
// mesmo lead. Cada um enxerga a tabela como ela estava antes do INSERT do outro, os
// dois passam pelo `NOT EXISTS` e os dois gravam. É o mesmo buraco que lib/sdr/enroll-write
// documenta, aberto pelo mesmo motivo: fechar de verdade pede um índice único NA BASE
// DO CLIENTE (`UNIQUE (lead_id) WHERE ativo`), que não é nosso para criar. O que a
// guarda fecha é a repetição EM SEQUÊNCIA, que é a forma que a repetição tem quando
// quem repete é o retry de uma chamada HTTP.
//
// A ORDEM — avança a fase PRIMEIRO, liquida o livro-caixa DEPOIS
// As duas etapas são idempotentes, então uma repetição é segura vindo de qualquer
// lado; o que a ordem decide é o que sobra quando o processo morre NO MEIO. Morrendo
// entre uma e outra, fica uma fase avançada com a reserva ainda em voo — e a reserva em
// voo é visível (`listarReservasParadas` acha, a cota conta, o retry do n8n termina o
// serviço). Na ordem contrária sobraria uma reserva LIQUIDADA cuja fase nunca avançou: o
// livro-caixa diria "enviada, assunto encerrado" sobre um lead que ficou sem ação ativa
// nenhuma — exatamente o lead perdido em silêncio que este trabalho veio abolir, e sem
// ninguém para notar. Entre sobrar barulho e sobrar silêncio, sobra barulho.
//
// O BARULHO NÃO É INÓCUO, e quem escrever a recuperação precisa saber disso: a reserva
// que sobra em voo é de uma mensagem que JÁ SAIU. Uma varredura que pegue
// `listarReservasParadas` e chame `devolverReservas` sem olhar mais nada reanimaria a
// linha antiga (`ativo = true`) ao lado da linha nova que este módulo criou — duas ações
// ativas, e o lead recebendo de novo a fase que já recebeu. A devolução de reserva velha
// tem de conferir antes se aquele lead já tem ação ativa — é o mesmo `NOT EXISTS` da
// guarda 1, aplicado do outro lado, e é o que lib/sdr/varredura faz em A GUARDA. Quem
// escrever outra recuperação precisa da mesma conferência: a janela é curta (morrer
// entre duas chamadas consecutivas, e o retry não chegar antes do limiar da varredura),
// mas o preço dela é mensagem repetida.
//
// O NÚMERO DA PRÓXIMA FASE SAI DE `id_fase`, NÃO DO NOME
// O fluxo antigo fazia `parseInt(fase.split(" ")[1]) + 1` — o número vinha de dentro do
// texto. Uma fase chamada "Follow-up 2 (curto)" ou "Template" viraria `NaN + 1`, e o
// lead seguiria para a fase `"Template NaN"`, que template nenhum atende. Aqui o número
// é a coluna `id_fase`, lida com a MESMA tolerância que a régua aplica a número que vem
// de coluna do cliente: o schema não é nosso, e o `pg` devolve `numeric`/`bigint`/`text`
// como STRING. Sem `id_fase` utilizável o avanço NÃO acontece e diz por quê — inventar
// um número seria mandar o lead para uma fase que não existe.
//
// `data_proxima_msg_outbound` É 09:00 EM SÃO PAULO
// O fluxo antigo somava `delay_dias` e fixava 09:00 no fuso da INSTÂNCIA do n8n, que
// pode ser UTC: 09:00 UTC é 06:00 em Brasília, e a campanha acordava o lead às seis da
// manhã. É um dos defeitos que este lote conserta. O fuso é o da régua (`FUSO_SP`,
// `horaLocalSp`) e não uma segunda mecânica: duas noções de "que dia é hoje em São
// Paulo" no mesmo produto é como o balde do dia e o agendamento passam a discordar.
//
// DESVIO CONHECIDO — `leads.status` ATRASA UMA FASE
// O status gravado é a fase que ACABOU de ser enviada, não a que o lead passa a esperar.
// Quem recebeu o Template 3 fica com `status = 'Template 3'` enquanto a ação ativa já
// é o Template 4. É o que o fluxo do n8n fazia, e continua assim de propósito: a coluna
// é lida por tela e por relatório fora deste repositório, e trocar o significado dela
// mexe em número que alguém acompanha. Fica escrito, esperando decisão do produto.
//
// DESVIO CONHECIDO — A FASE FINAL É CRIADA, E ISSO ESTÁ CERTO AQUI
// Este módulo não conhece `fase_final` e não filtra por ela: quem terminou o Template 5
// ganha a linha do Template 6 mesmo que a fase final seja 5. Quem filtra é a SELEÇÃO
// (`a.fase <> fase_final`, em lib/sdr/regua), e é lá que o assunto mora — a linha
// existe, vencida e ativa, e simplesmente nunca é escolhida. Repetir o filtro aqui
// mudaria quantas mensagens pessoas reais recebem e ainda deixaria a campanha sem o
// registro de onde cada lead parou. Ver DESVIO CONHECIDO no cabeçalho da régua.
//
// REGRA DO PROJETO: este é um dos poucos arquivos que ESCREVE na base do cliente — aqui
// são duas colunas, a `lead_actions` nova e `leads.status`. A string de conexão chega
// pronta de quem chamou (lib/sdr/conexao-tenant) e nunca entra em log nem em mensagem
// de erro. NADA ACONTECE NA IMPORTAÇÃO: sem ambiente, sem conexão, sem relógio.

import { contagemUtilizavel, devolverReservas, horaLocalSp } from './regua'
import { liquidarComoEnviada, liquidarComoFalha } from './reservas'
import { withSdrDb } from './pg'

// ─── Números que vêm de coluna que não é nossa ────────────────────────────────

/* `contagemUtilizavel` é o `inteiroDoBanco` da régua com a exigência de não ser
 * negativo, e é exatamente a régua que `id_fase` e `delay_dias` precisam: inteiro,
 * aceito também como o texto que o driver devolve, recusando `''`, `'  '`, `'3 dias'`,
 * `3.7`, `NaN` e booleano — tudo o que um `Number()` solto transformaria em 0 ou 1.
 *
 * O nome fala de contagem porque foi para contar que ela nasceu, e mesmo assim ela é
 * reaproveitada em vez de copiada: uma segunda versão de "como um número da base do
 * cliente é lido" é como duas partes do produto passam a discordar sobre o mesmo valor
 * — a dívida que a régua já declara em CÓPIA DECLARADA. Se um dia o nome incomodar, o
 * conserto é renomear lá, não duplicar aqui. */
const inteiroDoCliente = contagemUtilizavel

// ─── Agendamento ──────────────────────────────────────────────────────────────

/**
 * A hora do próximo disparo, em São Paulo. Era 09:00 no fluxo do n8n e continua 09:00:
 * mudar isto muda a que horas pessoas reais recebem mensagem.
 */
export const HORA_DO_PROXIMO_DISPARO = 9

/**
 * `delay_dias` quando a base do cliente não tem resposta utilizável.
 *
 * É o mesmo 3 que o DEFAULT da coluna `campaign_config.delay_dias` aplica e o mesmo que
 * a tela de Parâmetros assume (`intervaloDias: 3` em app/api/sdr/settings). Cair aqui
 * NÃO é rotina: significa `campaign_config` sem linha nenhuma, ou com um `delay_dias`
 * que não é inteiro. O resultado carrega `delayPadrao` para o chamador poder dizer que
 * o número não veio do cadastro — agendar em silêncio por um palpite é o tipo de coisa
 * que só aparece três dias depois, quando a mensagem sai no dia errado.
 */
export const DELAY_DIAS_PADRAO = 3

/** Ano, mês e dia do calendário de São Paulo no instante dado. */
function dataLocalSp(instante: Date): { ano: number; mes: number; dia: number } {
  const { aaaammdd } = horaLocalSp(instante)
  return {
    ano: Number(aaaammdd.slice(0, 4)),
    mes: Number(aaaammdd.slice(4, 6)),
    dia: Number(aaaammdd.slice(6, 8)),
  }
}

/**
 * Quanto o relógio de São Paulo está adiantado em relação ao UTC NAQUELE instante, em
 * milissegundos (hoje sempre −3 h, mas o número é medido e não fixado: o Brasil já teve
 * horário de verão e pode ter de novo, e uma constante `-3` seria um erro de uma hora
 * que ninguém percebe até dezembro).
 *
 * O instante recebido tem de cair em minuto cheio: `horaLocalSp` formata até o minuto,
 * então segundos no meio virariam deslocamento com sobra. Os dois chamadores abaixo só
 * passam instantes construídos em minuto cheio.
 */
function deslocamentoSp(instante: Date): number {
  const { ano, mes, dia } = dataLocalSp(instante)
  const local = horaLocalSp(instante)
  return Date.UTC(ano, mes - 1, dia) + local.minutos * 60_000 - instante.getTime()
}

/**
 * O instante UTC em que o relógio de São Paulo marca a data e a hora pedidas. Dia fora
 * da faixa é normalizado pelo próprio `Date.UTC` (31 + 3 vira o dia 3 do mês seguinte),
 * que é o que faz a soma de `delay_dias` atravessar mês e ano sem aritmética própria.
 *
 * DUAS PASSADAS, e a segunda não é zelo: o deslocamento tem de ser medido no instante
 * CERTO, e o instante certo é o que se quer descobrir. A primeira passada usa o
 * deslocamento de um palpite (a hora local lida como se fosse UTC) e a segunda o corrige
 * com o deslocamento do resultado. Com fuso fixo as duas dão o mesmo número; numa
 * virada de horário de verão é a segunda que evita errar a hora.
 */
function instanteEmSp(ano: number, mes: number, dia: number, hora: number): Date {
  const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia, hora)
  const primeira = comoSeFosseUtc - deslocamentoSp(new Date(comoSeFosseUtc))
  return new Date(comoSeFosseUtc - deslocamentoSp(new Date(primeira)))
}

/**
 * Quando a próxima mensagem deve sair: `delayDias` depois do DIA do envio, às 09:00 em
 * São Paulo.
 *
 * A conta é de CALENDÁRIO e não de 24 horas vezes N — somar milissegundos ao instante do
 * envio faria o horário escorregar junto com a hora em que o disparo do dia calhou de
 * acontecer, e ainda erraria uma hora na virada de horário de verão.
 *
 * `delayDias` zero é legítimo (lib/sdr/config-write aceita 0) e agenda para as 09:00 de
 * HOJE, que a esta altura já passou: a linha nasce vencida e a próxima rodada da régua a
 * pega. É o que "sem intervalo" significa, e não um caso a defender.
 */
export function proximoDisparoSp(agora: Date, delayDias: number): Date {
  const { ano, mes, dia } = dataLocalSp(agora)
  return instanteEmSp(ano, mes, dia + delayDias, HORA_DO_PROXIMO_DISPARO)
}

/** O nome da fase a partir do número dela — `"Template " + N`, como o fluxo do n8n
 *  montava e como `meta_templates_whatsapp.fase_envio` guarda. */
export function nomeDaFase(idFase: number): string {
  return `Template ${idFase}`
}

// ─── Corpo do ack ─────────────────────────────────────────────────────────────

/**
 * O ack já lido e normalizado. É o contrato ANTIGO mais o que o disparador novo manda —
 * os dois convivem enquanto o cron do n8n não for desligado, e por isso nada que o
 * corpo antigo não tem pode virar obrigatório.
 */
type CamposDoAck = {
  tenantId: string
  leadId: string
  /** A `lead_actions` reservada pela régua. `null` é o caminho LEGADO: sem ela, este
   *  ack só registra o envio, porque quem avança a fase é o fluxo antigo. */
  acaoId: string | null
  phone: string
  firstName: string
  template: string | null
  messageBody: string
  /** O que o disparador contou sobre a falha; vai para `blast_recipients.error_message`. */
  erroDoEnvio: string | null
}

/**
 * O ack já lido. O `status` é o discriminante e ele CARREGA a regra do `messageId`: no
 * sucesso é `string`, na falha pode ser nulo. Não é enfeite de tipo — é o que faz o
 * compilador cobrar a garantia no call site, em vez de a rota precisar de um cast ou de
 * uma segunda checagem para provar o que esta função já provou.
 */
export type CorpoDoAck = CamposDoAck & (
  | { status: 'enviado'; messageId: string }
  | { status: 'falhou'; messageId: string | null }
)

export type LeituraDoCorpo =
  | { ok: true; ack: CorpoDoAck }
  /** A frase de 400, em português, pronta para a resposta. */
  | { ok: false; erro: string }

/** Texto com conteúdo, já aparado; `null` para o resto. */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpo = valor.trim()
  return limpo === '' ? null : limpo
}

/* Teto para o texto de erro que o disparador manda. A coluna é `text` e aguenta
 * qualquer tamanho — o teto existe para um stack trace inteiro do n8n não virar linha
 * de banco e tela ilegível. */
const MAX_ERRO = 500

/**
 * Lê o corpo do POST. Fica aqui, e não na rota, porque `npm test` roda `lib/**` e nada
 * de `app/**`: regra de aceitação que mora na rota é regra sem teste.
 *
 * AS DECISÕES, todas discutíveis e por isso escritas:
 *
 *   · `status` AUSENTE é `'enviado'`. O fluxo antigo não manda status nenhum e só
 *     chama quando deu certo; recusar o corpo dele pararia a campanha que hoje roda.
 *     Qualquer outro valor é recusado em vez de virar 'enviado' por descuido — um
 *     'failed' em inglês silenciosamente contado como sucesso é o pior desfecho.
 *   · `messageId` deixa de ser obrigatório SEMPRE e passa a ser obrigatório no
 *     SUCESSO. Ele é a prova de que a mensagem existe no YCloud e é a chave de
 *     idempotência do registro; uma falha não tem o que provar nem o que repetir.
 *   · `campanha`, `campaignId`, `sessionId` e `fase` são ACEITOS E IGNORADOS, de
 *     propósito. Os três primeiros não têm coluna que os receba, e `fase` tem dono: a
 *     fase que vale é a da `lead_actions` reservada, lida do banco do cliente na hora
 *     do avanço. Um retry atrasado carregando a fase de ontem escreveria em `leads` um
 *     status que não é mais verdade — o corpo não pode mandar no que o banco já sabe.
 */
export function lerCorpoDoAck(corpo: unknown): LeituraDoCorpo {
  const body = (corpo ?? {}) as Record<string, unknown>

  const tenantId = texto(body.tenantId)
  const leadId = texto(body.leadId)
  if (!tenantId || !leadId) {
    return { ok: false, erro: 'tenantId e leadId são obrigatórios' }
  }

  const bruto = texto(body.status)
  if (bruto !== null && bruto !== 'enviado' && bruto !== 'falhou') {
    return { ok: false, erro: "status deve ser 'enviado' ou 'falhou'" }
  }
  const messageId = texto(body.messageId)

  const campos: CamposDoAck = {
    tenantId,
    leadId,
    acaoId: texto(body.leadActionId),
    // As três colunas de `blast_recipients` são NOT NULL e sempre foram preenchidas com
    // '' quando o corpo não trazia o valor. Continua assim: mudar para NULL aqui
    // quebraria o INSERT para o fluxo antigo, que é quem mais chama esta rota hoje.
    phone: texto(body.phone) ?? '',
    firstName: texto(body.firstName) ?? '',
    messageBody: texto(body.messageBody) ?? '',
    template: texto(body.template),
    erroDoEnvio: texto(body.erro)?.slice(0, MAX_ERRO) ?? null,
  }

  if (bruto !== 'falhou') {
    if (!messageId) {
      return { ok: false, erro: 'messageId é obrigatório quando o envio deu certo' }
    }
    return { ok: true, ack: { ...campos, status: 'enviado', messageId } }
  }

  return { ok: true, ack: { ...campos, status: 'falhou', messageId } }
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

/**
 * A linha reservada, mais o `delay_dias` vigente numa consulta só.
 *
 * O `ORDER BY updated_at DESC LIMIT 1` é o mesmo SELECT que lib/sdr/config-write chama
 * de configuração vigente e o mesmo que o fluxo de disparo usa: a tela INSERE uma linha
 * nova a cada save, então "a config" é sempre a última.
 *
 * LER O `delay_dias` AQUI, e não carregá-lo no corpo do ack, é uma escolha com preço.
 * O preço: uma consulta a mais por mensagem enviada na base do CLIENTE, e uma janela em
 * que o operador salva um intervalo novo entre a seleção e o ack — o lote sai com o
 * intervalo velho e é agendado com o novo. O que se compra: o corpo do ack não precisa
 * mudar (o disparador antigo não manda `delay_dias` nenhum e não vai passar a mandar), e
 * o valor não atravessa n8n, onde ele viraria mais um campo para alguém digitar errado.
 * A janela vale no máximo um lote; um campo a mais no contrato vale para sempre.
 */
const SQL_LER_ACAO = `
SELECT a.lead_id, a.fase, a.id_fase,
       (SELECT c.delay_dias
          FROM campaign_config c
         ORDER BY c.updated_at DESC
         LIMIT 1) AS delay_dias
  FROM lead_actions a
 WHERE a.id = $1`

/**
 * Cria a `lead_actions` da fase seguinte e marca o lead — numa instrução só.
 *
 * O `NOT EXISTS (... ativo = true)` é a GUARDA 1 do cabeçalho, copiada de
 * lib/sdr/enroll-write de propósito: as duas são a mesma pergunta ("este lead já tem
 * ação viva?") e duas respostas diferentes para ela seria um lead com duas ações ativas.
 * Ele cobre dois casos de uma vez — o ack repetido (a linha que o primeiro criou está
 * ativa) e o lead que foi inscrito à mão no intervalo. Nos dois, a resposta certa é não
 * criar a segunda.
 *
 * `leads.status` viaja na MESMA instrução, e amarrado ao `EXISTS (SELECT 1 FROM proxima)`:
 * o ack repetido não deve reescrever o status, e o lead reinscrito em outra fase no
 * intervalo não pode receber o status de uma campanha que já não é a dele. Uma gravação
 * só, uma decisão só. O `$5 IS NOT NULL` deixa de fora a linha legada com `fase` NULL —
 * gravar NULL ou '' em `status` apagaria o que a coluna tinha por nada.
 *
 * OS PARÂMETROS DO INSERT NÃO LEVAM CAST, e isso é escolha: sem `::int` e sem
 * `::timestamptz`, o Postgres deduz o tipo de cada um da COLUNA de destino. Numa base em
 * que `id_fase` é `numeric` ou `text` — e o schema é do cliente, não nosso — um `$3::int`
 * derrubaria o INSERT inteiro com erro de tipo. A mesma dedução vale para `$1`
 * (comparado com `a.lead_id` nas duas pontas) e para `$4`, que chega como texto ISO 8601
 * em UTC.
 *
 * `$5` é a ÚNICA exceção, e é o Postgres que obriga: `$5 IS NOT NULL` não resolve tipo
 * nenhum, e o parâmetro que aparece só ali e num `SET` fica indeterminado — a instrução
 * inteira morre no parse com 42P08 ("could not determine data type of parameter"), com
 * ou sem valor nulo. O cast é `::text` porque é o que `leads.status` é.
 */
const SQL_AVANCAR = `
WITH proxima AS (
  INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
  SELECT $1, $2, $3, true, $4
   WHERE NOT EXISTS (
     SELECT 1 FROM lead_actions a WHERE a.lead_id = $1 AND a.ativo = true
   )
  RETURNING id
), marcado AS (
  UPDATE leads
     SET status = $5::text
   WHERE id = $1
     AND $5::text IS NOT NULL
     AND EXISTS (SELECT 1 FROM proxima)
  RETURNING id
)
SELECT (SELECT count(*) FROM proxima)::int AS criadas,
       (SELECT count(*) FROM marcado)::int AS marcados`

/** A linha reservada como ela volta da base do cliente. Os numéricos entram como
 *  `number | string` porque o schema não é nosso e o `pg` devolve `numeric`/`bigint`
 *  como texto; quem lê passa por `inteiroDoCliente`. */
type LinhaDaAcao = {
  lead_id: string | null
  fase: string | null
  id_fase: number | string | null
  delay_dias: number | string | null
}

// ─── Avanço de fase ───────────────────────────────────────────────────────────

/** Por que o avanço terminou como terminou. */
export type MotivoDoAvanco =
  /** A linha da fase seguinte foi criada nesta chamada. */
  | 'criada'
  /** O lead JÁ tinha ação ativa: ou este ack é repetido (o caminho normal do retry),
   *  ou alguém o inscreveu de novo no intervalo. Nos dois casos o lead está na
   *  campanha, e criar a segunda linha é que seria o defeito. */
  | 'ja_tem_ativa'
  /** `lead_actions` não tem a linha reservada. Só acontece se alguém a apagou entre a
   *  reserva e o ack — e então não há de onde tirar a fase. */
  | 'acao_ausente'
  /** A linha existe com `lead_id` vazio. A coluna é NOT NULL na base que conhecemos,
   *  mas o schema não é nosso, e sem o lead não há para quem criar a próxima. */
  | 'sem_lead'
  /** `id_fase` não é um inteiro utilizável. O avanço PARA aqui em vez de derivar o
   *  número do nome da fase: ver O NÚMERO DA PRÓXIMA FASE no cabeçalho. */
  | 'sem_id_fase'

/** Os desfechos em que o lead segue na campanha. Os outros três deixam o lead SEM ação
 *  ativa — reservado, enviado e parado —, que é o estado que este módulo existe para
 *  não produzir em silêncio. */
const AVANCOS_COMPLETOS: readonly MotivoDoAvanco[] = ['criada', 'ja_tem_ativa']

export type ResultadoDoAvanco = {
  motivo: MotivoDoAvanco
  /** A fase que acabou de ser enviada — a que foi gravada em `leads.status`. */
  faseEnviada: string | null
  /** Os três `null` quando não houve o que criar. */
  proximaFase: string | null
  proximoIdFase: number | null
  proximaEm: Date | null
  /** O intervalo aplicado, e se ele veio do cadastro ou do padrão. */
  delayDias: number
  delayPadrao: boolean
  /** `leads.status` foi realmente escrito. `false` sem ser erro: o lead pode ter sido
   *  apagado, ou a fase enviada pode ser a linha legada sem nome. */
  statusGravado: boolean
}

/**
 * Cria a `lead_actions` da fase seguinte e marca `leads.status` com a fase recém-enviada.
 *
 * Duas idas à base do cliente, e não uma: a primeira traz `id_fase` e `delay_dias`, que
 * precisam passar pela leitura tolerante de número e pela conta de fuso em JavaScript
 * antes de virarem parâmetro da segunda. Fazer tudo em SQL custaria o `AT TIME ZONE` na
 * base do cliente — uma segunda mecânica de "que dia é hoje em São Paulo", com o preço
 * já conhecido de duas noções discordando.
 *
 * Erro de banco SOBE como `SdrDbError` (quem traduz é o `withSdrDb`); nada é engolido.
 * "Não deu para avançar" com a base respondendo é MOTIVO, não erro.
 */
export async function avancarFase(
  connectionString: string,
  pedido: { acaoId: string; agora: Date },
): Promise<ResultadoDoAvanco> {
  const { acaoId, agora } = pedido

  const { rows } = await withSdrDb(connectionString, sdr =>
    sdr.query<LinhaDaAcao>(SQL_LER_ACAO, [acaoId]),
  )

  const lido = inteiroDoCliente(rows[0]?.delay_dias)
  const delayDias = lido ?? DELAY_DIAS_PADRAO
  const parado = (motivo: MotivoDoAvanco): ResultadoDoAvanco => ({
    motivo,
    faseEnviada: rows[0]?.fase ?? null,
    proximaFase: null,
    proximoIdFase: null,
    proximaEm: null,
    delayDias,
    delayPadrao: lido === null,
    statusGravado: false,
  })

  const linha = rows[0]
  if (!linha) return parado('acao_ausente')

  const leadId = texto(linha.lead_id)
  if (!leadId) return parado('sem_lead')

  const idFase = inteiroDoCliente(linha.id_fase)
  if (idFase === null) return parado('sem_id_fase')

  const proximoIdFase = idFase + 1
  const proximaFase = nomeDaFase(proximoIdFase)
  const proximaEm = proximoDisparoSp(agora, delayDias)
  // A fase gravada no lead é a que ACABOU de sair, não a próxima. Ver DESVIO CONHECIDO
  // no cabeçalho antes de "consertar" isto.
  const faseEnviada = texto(linha.fase)

  const escrita = await withSdrDb(connectionString, sdr =>
    sdr.query<{ criadas: number; marcados: number }>(SQL_AVANCAR, [
      leadId,
      proximaFase,
      proximoIdFase,
      proximaEm.toISOString(),
      faseEnviada,
    ]),
  )

  const criadas = escrita.rows[0]?.criadas ?? 0
  return {
    motivo: criadas > 0 ? 'criada' : 'ja_tem_ativa',
    faseEnviada,
    proximaFase: criadas > 0 ? proximaFase : null,
    proximoIdFase: criadas > 0 ? proximoIdFase : null,
    proximaEm: criadas > 0 ? proximaEm : null,
    delayDias,
    delayPadrao: lido === null,
    statusGravado: (escrita.rows[0]?.marcados ?? 0) > 0,
  }
}

// ─── Conclusão do ack ─────────────────────────────────────────────────────────

/**
 * O que o ack tem a fazer depois de o envio já estar registrado em `blast_recipients`.
 *
 * O union não é enfeite: um ack de SUCESSO sem `messageId` não existe — ele é a prova de
 * que a mensagem saiu e a chave que amarra a reserva à linha de `blast_recipients`. O
 * compilador cobra, em vez de a chamada descobrir isso no banco.
 */
export type PedidoDeConclusao =
  | { acaoId: string; status: 'enviado'; messageId: string; agora: Date }
  | { acaoId: string; status: 'falhou'; agora: Date }

export type ResultadoDoAck = {
  /** Tudo o que este ack tinha a fazer foi feito (ou já estava feito). */
  ok: boolean
  /** Em qual etapa o banco falhou; ausente quando nenhuma falhou. */
  etapa?: 'avanco' | 'devolucao' | 'liquidacao'
  /** O erro CRU da etapa que falhou, para o chamador LOGAR — nunca para a resposta:
   *  `SdrDbError` traz o original em `cause`, e ali pode haver texto de driver. */
  falha?: unknown
  /** Só no sucesso: como terminou o avanço de fase. */
  avanco: ResultadoDoAvanco | null
  /** Só na falha: quantas `lead_actions` voltaram para `ativo = true`. */
  devolvidas: number | null
  /** Linhas do livro-caixa que saíram de voo nesta chamada. */
  liquidadas: number
  /** GUARDA 2: `liquidadas > 0` é a resposta do banco para "este ack é o primeiro?".
   *  `false` também cobre o envio que nunca passou por reserva (o fluxo antigo), e por
   *  isso ele sozinho não é sintoma de nada. */
  primeiroAck: boolean
}

/**
 * Fecha um ack que veio com `leadActionId`: avança a fase (ou devolve a reserva, quando
 * o envio falhou) e liquida o livro-caixa.
 *
 * A ORDEM está no cabeçalho e é a razão de esta função existir em vez de a rota chamar
 * as três peças na mão — ordem que mora em call site é ordem que a próxima rota inverte.
 *
 * NADA SOBE DAQUI: cada etapa é embrulhada para o resultado poder dizer QUAL falhou. É
 * a única exceção ao "erro de banco sobe" do resto do SDR, e ela é o ponto: neste
 * caminho o envio JÁ foi registrado, e uma exceção solta faria a rota responder 500 sem
 * conseguir contar que a mensagem saiu e só o resto ficou pela metade. O erro não é
 * engolido — viaja em `falha` para o log, como `limite.falha` da régua.
 */
export async function concluirAck(
  connectionString: string,
  pedido: PedidoDeConclusao,
): Promise<ResultadoDoAck> {
  const { acaoId, agora } = pedido

  const base: ResultadoDoAck = {
    ok: false,
    avanco: null,
    devolvidas: null,
    liquidadas: 0,
    primeiroAck: false,
  }

  if (pedido.status === 'enviado') {
    let avanco: ResultadoDoAvanco
    try {
      avanco = await avancarFase(connectionString, { acaoId, agora })
    } catch (erro) {
      return { ...base, etapa: 'avanco', falha: erro }
    }

    let liquidadas: number
    try {
      liquidadas = await liquidarComoEnviada(acaoId, pedido.messageId, agora)
    } catch (erro) {
      return { ...base, etapa: 'liquidacao', falha: erro, avanco }
    }

    return {
      ...base,
      ok: AVANCOS_COMPLETOS.includes(avanco.motivo),
      avanco,
      liquidadas,
      primeiroAck: liquidadas > 0,
    }
  }

  /* Falha: são DUAS coisas diferentes, e fundi-las apagaria uma delas. Na base do
   * cliente a linha volta para `ativo = true` — o lead volta para a fila e será tentado
   * de novo, em vez de sair da campanha porque o YCloud esteve fora meia hora. No
   * livro-caixa a reserva fecha como `falhou`, que registra que a tentativa ACONTECEU e
   * deliberadamente NÃO gasta a cota do dia (ver STATUS_QUE_CONSOMEM em lib/sdr/reservas:
   * `limite_diario` é teto de mensagens entregues a pessoas, e esta não chegou a ninguém).
   *
   * A ordem é a de `marcarDevolvidas`: cliente primeiro, livro-caixa depois. Falhar no
   * meio deixa uma reserva contando cota por um dia para um lead que já voltou à fila —
   * conservador. A ordem contrária deixaria o lead fora da campanha com a cota liberada,
   * que é o lead perdido em silêncio. */
  let devolvidas: number
  try {
    devolvidas = await devolverReservas(connectionString, [acaoId])
  } catch (erro) {
    return { ...base, etapa: 'devolucao', falha: erro }
  }

  let liquidadas: number
  try {
    liquidadas = await liquidarComoFalha(acaoId, agora)
  } catch (erro) {
    return { ...base, etapa: 'liquidacao', falha: erro, devolvidas }
  }

  return { ...base, ok: true, devolvidas, liquidadas, primeiroAck: liquidadas > 0 }
}
