// Régua de disparo do SDR: escolhe quem recebe a próxima mensagem da campanha,
// RESERVA essas linhas e devolve os destinatários prontos para o n8n só enviar.
//
// POR QUE EXISTE
// A seleção mora hoje num fluxo do n8n ("Disparo de Templates v3") que roda em cron:
// ele lê `campaign_config`, confere o interruptor, varre `lead_actions`, busca o
// template da fase e dispara — tudo do lado de lá. Três consequências ruins:
//
//   1. a app não sabe POR QUE um dia não saiu nada. "0 enviados" chega sem motivo, e
//      é exatamente esse silêncio que este trabalho existe para acabar — por isso
//      todo caminho de "nada a enviar" aqui tem um código próprio;
//   2. o `limite_diario` lá é POR EXECUÇÃO. O cron roda três vezes por dia, então um
//      limite de 10 manda até 30. Aqui ele é por DIA, descontando o que já saiu;
//   3. `horario_inicio`, `horario_fim` e `dias_ativos` são gravados pela tela de
//      Parâmetros e não são lidos por ninguém. A campanha dispara de madrugada e no
//      domingo, com a tela dizendo que não. Aqui eles passam a valer.
//
// ESTE MÓDULO AINDA NÃO É CHAMADO POR NINGUÉM, e isso é deliberado: a lógica entra no
// repositório para ser revisada e testada ANTES de mudar a mensagem que alguém recebe
// no WhatsApp. Ligar numa rota é outro lote.
//
// O QUE FICA DE FORA — quem faz o resto
// O passo 5 do fluxo antigo — avançar a fase, agendar a próxima e marcar o
// `leads.status` — é trabalho do ack, DEPOIS da confirmação de envio, e não deste
// módulo. Esse ack existe: lib/sdr/regua-ack.ts, chamado por
// app/api/sdr/dispatch/ack/route.ts. Ele cria a próxima `lead_actions` com a guarda
// `NOT EXISTS (ação ativa)` do enroll-write, agenda para as 09:00 de São Paulo somando
// o `delay_dias` da configuração, escreve o `leads.status` e liquida a reserva no
// livro-caixa. Este módulo é o que torna isso possível: cada destinatário sai com o
// `acaoId` e a `fase` que foram reservados.
//
// A ORDEM DO OUTRO LADO, que tem consequência aqui: o ack avança a fase ANTES de
// liquidar a reserva. Os dois passos são idempotentes, então uma repetição é segura de
// qualquer lado; se o processo morrer entre eles, sobra uma reserva EM VOO cuja mensagem
// JÁ SAIU. Isso não é resíduo inofensivo: quem for devolver essa reserva tem de conferir
// antes se o lead já tem ação ativa, senão reativa a linha velha ao lado da nova e o
// lead recebe de novo a fase que acabou de receber. lib/sdr/varredura.ts faz essa
// conferência; qualquer outra recuperação que venha a existir também tem de fazer.
//
// A RESERVA (e por que ela é uma instrução só)
// Enquanto este caminho for usado à mão, o cron antigo continua rodando. Se os dois
// escolherem a mesma `lead_actions`, alguém recebe a MESMA mensagem duas vezes. Então
// selecionar e reservar são o mesmo comando: o `UPDATE ... SET ativo = false` sai
// junto do SELECT, numa instrução única, e o que volta é o que o banco realmente
// reservou. Duas chamadas simultâneas não pegam a mesma linha porque não existe
// intervalo entre ler e marcar — não é uma janela pequena, é uma janela que não
// existe. O `FOR UPDATE SKIP LOCKED` é o complemento: em vez de a segunda chamada
// ESPERAR a primeira soltar a linha para então descobrir que ela já foi, ela pula
// adiante e pega outras. Ver lib/sdr/regua.test.ts.
//
// Reserva é dívida: toda linha reservada aqui sai de `enviar` OU de `descartados`, e
// quem não for enviado precisa voltar com `devolverReservas` — senão o lead some da
// campanha em silêncio, que é pior do que não ter reservado.
//
// DESCARTE GASTA A VAGA DA RODADA, e isso é do desenho. A linha descartada foi
// reservada, ocupou uma das vagas de `disponivel` e não vai gerar `blast_recipients`
// nenhum. Uma rodada cuja cabeça de fila são dez linhas com `template_ausente` reserva
// dez, manda zero e volta `todos_descartados`. Repor as vagas descartadas exigiria
// reservar mais linhas no lugar, e aí a rodada deixaria de ter teto — é para não fazer
// isso que o número de reservas é o número de vagas. O chamador recebe `reservadas`,
// `enviar` e `descartados` para poder dizer exatamente isso na tela; e rodar de novo
// depois de arrumar o cadastro é legítimo — desde que o descarte tenha DESFECHO no
// livro-caixa (lib/sdr/reservas). Ali uma reserva fica 'reservada' até alguém dizer o
// que houve com ela, e 'reservada' GASTA cota; um descarte registrado e esquecido come
// uma vaga do dia inteiro sem nunca ter virado mensagem. Devolver no cliente
// (`devolverReservas`) e marcar lá (`marcarDevolvidas`) é o par que fecha a conta.
//
// O QUE A RESERVA NÃO RESOLVE, e não tem como resolver daqui: o fluxo antigo SELECIONA
// e só desativa a linha DEPOIS de mandar. Uma linha que ele já pegou continua com
// `ativo = true` durante o envio dele — se a régua reservar nesse intervalo, os dois
// mandam. A reserva fecha a corrida entre duas chamadas DESTE módulo (prova em teste)
// e impede o fluxo antigo de pegar o que já reservamos; a janela do outro sentido é do
// desenho do fluxo antigo, e só fecha quando ele for desligado. Enquanto isso, o
// conselho operacional é não rodar os dois no mesmo horário.
//
// O QUE NÃO ESTÁ GARANTIDO HOJE — leia antes de ligar isto em qualquer rota
// Dois buracos foram escritos aqui como abertos. Um deles fechou, o outro NÃO, e a
// diferença entre os dois é onde cada um fecha:
//
//   1. RESERVA ÓRFÃ — CONTINUA ABERTA. Uma linha reservada fica `ativo = false`, byte
//      por byte o mesmo estado de uma linha que já terminou a campanha, e o schema do
//      cliente não é nosso: não dá para acrescentar lá uma marca de quem reservou.
//      lib/sdr/reservas dá essa marca do NOSSO lado, e `listarReservasParadas` acha a
//      reserva velha — mas só a que FOI registrada. São dois bancos e duas gravações
//      que não confirmam juntas: morto o processo DEPOIS de o `UPDATE` na base do
//      cliente confirmar e ANTES de o chamador registrar o lote, não existe linha em
//      lugar nenhum. Ninguém envia, ninguém devolve, aqueles leads saem da campanha em
//      silêncio e para sempre. Fechar esse resto é uma varredura por INVARIANTE —
//      procurar `lead_actions` inativa que não tem linha correspondente no livro-caixa
//      —, e ELA NÃO EXISTE. Não há timeout, não há retomada automática. Nenhum
//      parágrafo acima deve ser lido como se houvesse.
//
//   2. COTA FURADA — fechada POR CONSTRUÇÃO NO CHAMADOR, e não por este módulo. O furo
//      era a reserva EM VOO ser invisível para a conta do dia: duas chamadas em
//      sequência rápida, antes de o primeiro ack chegar, recebiam CADA UMA a cota
//      restante inteira. Quem enxerga o em voo é `contarConsumidasHoje` de
//      lib/sdr/reservas, e ela entra por `contarEnviadosHoje` — a porta que este módulo
//      tornou OBRIGATÓRIA exatamente por causa disto. Não dá para ligar por dentro:
//      lib/sdr/reservas importa `baldeDoDia` daqui, e o import de volta seria ciclo. E
//      não há default para cair, porque o default que existia era o errado. Então o
//      furo fecha NO CHAMADOR, quando ele passa o contador do livro-caixa; passar
//      qualquer outra coisa reabre, e SOMAR os dois contadores é pior que não fechar —
//      toda reserva liquidada como 'enviada' também vira uma linha de
//      `blast_recipients` pelo ack, então a soma conta duas vezes cada mensagem
//      entregue e corta a cota real pela metade.
//
// Enquanto o lote que liga a régua numa rota não existir, o modo de operação defensável
// continua sendo UMA rodada por vez, com o chamador guardando os `acaoId` antes de
// qualquer outra coisa — por causa do buraco 1, que nenhuma porta fecha.
//
// CONTAGEM INCOMPLETA — a honestidade que o limite diário exige
// O desconto do limite não é mais calculado aqui: ele chega inteiro pela porta
// `contarEnviadosHoje`, e o que a conta enxerga é o que o chamador escolheu. Com o
// contador de lib/sdr/reservas, que é para isso que ele existe, o quadro é este:
//
//   · PASSA A SER VISÍVEL a reserva EM VOO — a linha que a régua acabou de marcar
//     `ativo = false` e sobre a qual nenhum ack chegou ainda. Era essa cegueira que
//     fazia o limite DIÁRIO desabar em limite POR RODADA, que é o mesmo defeito que a
//     régua veio matar no n8n, voltando pela nossa porta.
//
//   · CONTINUA INVISÍVEL tudo o que o cron ANTIGO do n8n manda. Aquele fluxo não passa
//     por reserva nenhuma (não escreve `dispatch_claims`) e não manda ack (não escreve
//     `blast_recipients`): ele não aparece em NENHUM dos dois lugares, e não há
//     contagem nossa que o alcance.
//
// Por isso a contagem continua sendo um PISO, e não o total: pode sobrar folga que na
// prática já foi gasta. O resultado carrega `limite.incompleta` para o chamador poder
// dizer isso na tela em vez de apresentar um número que parece exato. E daí a conclusão
// que importa: o limite diário só é HONESTO depois que o fluxo antigo for DESLIGADO —
// ligar o livro-caixa conserta o furo da reserva em voo e não conserta este. É o
// desligamento do cron, e nada mais, que apaga a bandeira (e o teste que a prende).
//
// DESVIO CONHECIDO, ESPERANDO DECISÃO DO PRODUTO — `fase_final`
// O filtro é `fase <> fase_final`, igual ao do n8n: a campanha PARA NA fase final em
// vez de incluí-la. Quem configura 5 toques recebe 4 mensagens. Isso parece um erro de
// um a menos, e provavelmente é — mas consertar aqui muda quantas mensagens pessoas
// reais recebem, e essa conta é do dono do produto, não deste módulo. Fica como está,
// escrito em voz alta, até alguém decidir.
//
// LINHA COM `fase` NULL — continua fora, para de ser invisível
// A mesma lógica de três valores tem um segundo efeito, verificado rodando o SQL de
// produção contra Postgres: com `fase` NULL, `fase <> fase_final` é NULL, e a linha não
// passa o filtro. Ela nunca é selecionada, nunca é reservada, nunca aparece em
// `descartados` e fica `ativo = true` para sempre. Como lib/sdr/enroll-write SEMPRE
// grava uma fase, linha assim só pode ser legada.
//
// Trocar por `IS DISTINCT FROM` incluiria esses leads na campanha — com fase vazia e
// template nenhum —, ou seja, mudaria quem recebe mensagem: é a mesma conta do dono do
// produto do parágrafo acima. Então a linha continua fora, e o que muda é que ela deixa
// de ser invisível: o lote volta com `devidosSemFase`, quantas linhas ativas e já
// vencidas estão paradas desse jeito.
//
// Por que um número à parte, e não um `MotivoDescarte` nem um `MotivoDoLote`: descarte
// pressupõe reserva (é dívida a devolver, e aqui nada foi reservado), e motivo é um só
// — uma rodada pode mandar dez mensagens E ter linhas paradas ao mesmo tempo. O número
// sai na MESMA instrução da reserva, e não numa segunda consulta, por dois motivos: não
// custar outra ida à base do cliente a cada rodada, e não poder falhar DEPOIS de a
// reserva estar confirmada (falha depois do commit é exatamente como se fabrica reserva
// órfã). O preço está documentado em SQL_RESERVAR: quando nada é reservado, a consulta
// devolve uma linha-resumo, com `acao_id` NULL.
//
// REGRA DO TELEFONE — mora em lib/sdr/telefone.ts, num lugar só
// `toE164`, `ensureBr9`, `renderMessage` e `unresolvedPlaceholders` nasceram privados
// na rota de blast e por um tempo existiram repetidos aqui. Não existem mais: os dois
// chamadores importam o mesmo módulo. Duas versões de "como um telefone brasileiro
// vira E.164" é como um lead passa a receber mensagem num número e o histórico ir
// para outro — e o módulo documenta, numerados, os nove defeitos que essa regra tem
// hoje e que foram preservados de propósito. As regras de pular lead sem telefone e
// sem nome continuam aqui, porque a régua descarta um destinatário onde o blast
// recusa o pedido inteiro.
//
// REGRA DO PROJETO: este é um dos poucos arquivos que ESCREVE na base do cliente — e
// escreve só `lead_actions.ativo`. A string de conexão chega pronta de quem chamou
// (lib/sdr/conexao-tenant) e nunca entra em log nem em mensagem de erro.
//
// E O BANCO DA APP NÃO É MAIS FALADO DAQUI. Com a contagem virando porta obrigatória, o
// único `select` que este módulo fazia no nosso Postgres (`blast_recipients` no balde do
// dia) saiu, e com ele os imports de lib/db e do schema. Sobrou UM banco só, o do
// cliente, e um caminho só até ele, lib/sdr/pg. Quem for ressuscitar uma consulta ao
// nosso banco aqui está trazendo de volta o ciclo com lib/sdr/reservas e o default
// errado junto com ele — é para isso que este parágrafo existe.

import { withSdrDb } from './pg'
import { toE164, ensureBr9, renderMessage, unresolvedPlaceholders, POSICIONAL_RE } from './telefone'

// ─── Fuso ─────────────────────────────────────────────────────────────────────
//
// Um só, e é o mesmo do balde do dia do ack. O servidor roda em UTC: às 23h30 de
// Brasília já é o DIA SEGUINTE em UTC, e às 00h30 de Brasília ainda são 21h30 do dia
// anterior em UTC. Ler a hora com `getHours()` faria a janela de trabalho abrir e
// fechar três horas fora do lugar e o limite diário virar em hora errada.
export const FUSO_SP = 'America/Sao_Paulo'

/* Construído na primeira chamada, não na importação: `Intl.DateTimeFormat` com fuso
 * nomeado lança `RangeError` num Node sem ICU completo, e nada neste módulo pode
 * falhar quando ele é apenas importado. */
let relogio: Intl.DateTimeFormat | null = null

function formatadorSp(): Intl.DateTimeFormat {
  return (relogio ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_SP,
    year: 'numeric', month: '2-digit', day: '2-digit',
    /* `hourCycle: 'h23'` e NÃO `hour12: false`: com o segundo, meia-noite saía como
     * "24" em parte das versões antigas de ICU, e 24*60 cairia fora de qualquer janela.
     *
     * NENHUM TESTE DEFENDE ESTA ESCOLHA, e é melhor dizer do que deixar parecendo
     * defendida: no ICU deste runtime (78.2) as duas grafias são indistinguíveis —
     * imprimem "00:00" e `resolvedOptions().hourCycle` devolve 'h23' nas duas. O teste
     * de meia-noite prende o RESULTADO (00:00 e zero minuto), que é o que quebraria se
     * alguém trocasse este formatador por `getHours()`; ele não consegue distinguir a
     * opção. Fica por precaução, para ICU velho e para build de Node sem ICU completo. */
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }))
}

/** O relógio de parede de São Paulo no instante dado. */
export type HoraLocal = {
  /** 'HH:MM' local. */
  hhmm: string
  /** Minutos desde a meia-noite local — é nisso que a janela é comparada. */
  minutos: number
  /** Dia da semana ISO: 1 = segunda … 7 = domingo. */
  diaIso: number
  /** 'YYYYMMDD' local; é o que nomeia o balde do dia. */
  aaaammdd: string
}

export function horaLocalSp(agora: Date): HoraLocal {
  const partes: Record<string, string> = {}
  for (const parte of formatadorSp().formatToParts(agora)) partes[parte.type] = parte.value

  const ano = Number(partes.year)
  const mes = Number(partes.month)
  const dia = Number(partes.day)
  const hora = Number(partes.hour)
  const minuto = Number(partes.minute)

  /* O dia da semana sai da DATA LOCAL remontada em UTC, não de `agora.getUTCDay()`:
   * às 22h de domingo em Brasília já é segunda em UTC, e o filtro de dias ativos
   * responderia pelo dia errado exatamente nas horas em que mais dói. */
  const jsDay = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() // 0 = domingo
  return {
    hhmm: `${partes.hour}:${partes.minute}`,
    minutos: hora * 60 + minuto,
    diaIso: jsDay === 0 ? 7 : jsDay,
    aaaammdd: `${partes.year}${partes.month}${partes.day}`,
  }
}

/**
 * Id do balde do dia: o recorte diário que `blast_campaigns`/`blast_recipients` (do ack)
 * e `dispatch_claims` (do livro-caixa de lib/sdr/reservas) usam — os três com o MESMO
 * id, porque os três falam da mesma cota.
 *
 * Tem de ser byte a byte o mesmo que `dayBucketId` de app/api/sdr/dispatch/ack: é o ack
 * que ESCREVE as linhas do blast, e é por este id que a cota do dia é recortada em
 * qualquer contagem. Divergir aqui não daria erro nenhum — daria uma contagem
 * eternamente zero, ou seja, limite diário nenhum. É por isso que lib/sdr/reservas chama
 * esta função em vez de remontar a fórmula do seu lado.
 */
export function baldeDoDia(tenantId: string, agora: Date): string {
  return `${tenantId}:drip:${horaLocalSp(agora).aaaammdd}`
}

// ─── Janela de trabalho ───────────────────────────────────────────────────────

/* 'HH:MM' é o que a tela grava. 'HH:MM:SS' entra junto porque uma base do cliente
 * pode ter a coluna como `time`, e aí o driver devolve com segundos. */
const RELOGIO_RE = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

/** 'HH:MM' → minutos desde a meia-noite. `null` para qualquer coisa que não seja
 *  uma hora de relógio válida — inclusive '25:00' e '10:71'. */
export function minutosDoRelogio(valor: unknown): number | null {
  if (typeof valor !== 'string') return null
  const achado = RELOGIO_RE.exec(valor.trim())
  if (!achado) return null

  const horas = Number(achado[1])
  const minutos = Number(achado[2])
  if (horas > 23 || minutos > 59) return null
  return horas * 60 + minutos
}

/**
 * '1,2,3,4,5' → dias ISO (1 = segunda … 7 = domingo).
 *
 * ATENÇÃO AO DOMINGO: a tela de Parâmetros usa a convenção do JavaScript e grava
 * domingo como **0**, não como 7 (ver `DIAS` em sdr-ia/parametros/CampaignConfig).
 * Segunda a sábado batem nas duas convenções; só o domingo diverge. Por isso 0 e 7
 * são aceitos como o mesmo dia — recusar um dos dois faria a campanha ignorar o
 * domingo de todo mundo que já marcou o botão, ou disparar no domingo de quem não
 * marcou, dependendo de qual lado fosse escolhido.
 *
 * Qualquer pedaço ilegível invalida a lista INTEIRA (`null`), em vez de virar uma
 * lista menor: "2,x,5" com o `x` descartado em silêncio é uma campanha que para de
 * disparar num dia sem ninguém saber por quê.
 */
export function diasAtivosDe(valor: unknown): number[] | null {
  if (typeof valor !== 'string') return null

  const dias: number[] = []
  for (const parte of valor.split(',')) {
    const texto = parte.trim()
    if (!/^\d{1,2}$/.test(texto)) return null
    const dia = Number(texto)
    if (dia > 7) return null
    dias.push(dia === 0 ? 7 : dia)
  }
  return dias.length > 0 ? dias : null
}

/** "Não foi informado" — `undefined`, `null` e texto em branco são a mesma coisa. */
function ausente(valor: unknown): boolean {
  return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')
}

/** O que a régua leu do relógio, e o que dela chegou a ser aplicado. */
export type EstadoDaJanela = {
  /** Hora local em São Paulo, para a mensagem do operador não falar em UTC. */
  horaLocal: string
  /** Dia da semana ISO (1 = segunda … 7 = domingo) no fuso de São Paulo. */
  diaIso: number
  /** `false` quando a config não tem horário nenhum: NADA foi restringido por hora. */
  horarioAplicado: boolean
  /** `false` quando a config não tem dias: NADA foi restringido por dia da semana. */
  diasAplicados: boolean
}

export type ResultadoJanela =
  | { aberta: true; janela: EstadoDaJanela }
  | { aberta: false; motivo: MotivoDoLote; janela: EstadoDaJanela }

/**
 * A campanha pode disparar NESTE instante?
 *
 * Pura de propósito — sem banco, sem `Date.now()` —, porque é a parte em que um erro
 * de três horas não aparece em teste nenhum a menos que o teste possa escolher o
 * instante.
 *
 * AS DECISÕES, todas discutíveis e por isso escritas:
 *
 *   · A janela é INCLUSIVA nas duas pontas. "das 09:00 às 18:00" com o 18:00 de fora
 *     é o tipo de sutileza que ninguém lê na tela; incluir é o que o operador espera.
 *   · Config SEM horário (as duas pontas vazias) não restringe nada, e a bandeira
 *     `horarioAplicado: false` diz isso ao chamador. Bases antigas nunca tiveram
 *     esses valores — recusá-las pararia campanha que hoje funciona.
 *   · METADE da janela preenchida é recusa (`horario_invalido`), não meia liberdade:
 *     "a partir das 09:00" sem fim é um cadastro pela metade, e tratar como "o dia
 *     todo" seria inventar a intenção de quem preencheu.
 *   · Início DEPOIS do fim (22:00–06:00) é recusado (`horario_invertido`) em vez de
 *     virar janela que atravessa a meia-noite. Atravessar autorizaria disparo de
 *     madrugada, que é justamente o que este trabalho veio impedir; e uma comparação
 *     simples diria "nunca", que é um zero sem explicação.
 */
export function janelaDeEnvio(config: ConfigDaRegua, agora: Date): ResultadoJanela {
  const hora = horaLocalSp(agora)

  const temDias = !ausente(config.dias_ativos)
  const temInicio = !ausente(config.horario_inicio)
  const temFim = !ausente(config.horario_fim)

  const janela: EstadoDaJanela = {
    horaLocal: hora.hhmm,
    diaIso: hora.diaIso,
    horarioAplicado: temInicio || temFim,
    diasAplicados: temDias,
  }
  const fechada = (motivo: MotivoDoLote): ResultadoJanela => ({ aberta: false, motivo, janela })

  // Dia antes de hora: mensagem no domingo incomoda mais que mensagem às 08h55, e o
  // motivo que o operador recebe deve ser o mais grave dos dois.
  if (temDias) {
    const dias = diasAtivosDe(config.dias_ativos)
    if (dias === null) return fechada('dias_ativos_invalido')
    if (!dias.includes(hora.diaIso)) return fechada('dia_inativo')
  }

  if (temInicio || temFim) {
    if (!temInicio || !temFim) return fechada('horario_invalido')

    const inicio = minutosDoRelogio(config.horario_inicio)
    const fim = minutosDoRelogio(config.horario_fim)
    if (inicio === null || fim === null) return fechada('horario_invalido')
    if (inicio > fim) return fechada('horario_invertido')
    if (hora.minutos < inicio || hora.minutos > fim) return fechada('fora_do_horario')
  }

  return { aberta: true, janela }
}

// ─── Número que vem de coluna que não é nossa ─────────────────────────────────
//
// O `pg` (node-postgres) devolve `numeric`, `bigint` e `text` como STRING. E o schema
// de `campaign_config` não é nosso: a coluna que num cliente é `integer` pode ser
// `numeric` no outro, ou `text` numa base que o n8n criou às pressas. Um
// `limite_diario` que chega como `'100'` e é recusado por não ser `number` vira
// campanha parada com a tela de Parâmetros mostrando 100 — zero sem motivo, que é o
// silêncio que este módulo existe para acabar.
//
// A tolerância já existia para o relógio (`minutosDoRelogio` aceita `'18:30:00'`,
// porque a coluna do cliente pode ser `time`); aqui ela existe para o número, pelo
// mesmo motivo e com a mesma disciplina.
//
// O que NÃO se tolera continua sendo o que viraria zero por acidente: `Number('')` e
// `Number(' ')` são 0, `Number([])` é 0 e `Number(true)` é 1. Por isso a conversão
// passa por uma regex, e não por um `Number()` solto — a defesa de leitura que
// lib/sdr/config-write faz na gravação.
const NUMERO_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

/** Número que veio de uma coluna do cliente, como `number` ou como o texto que o
 *  driver devolve. `null` para o resto: `''`, `'  '`, `'10 leads'`, `'1e3'`, `NaN`,
 *  `Infinity`, booleano, array, objeto. */
function numeroDoBanco(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string') return null
  if (!NUMERO_RE.test(valor.trim())) return null
  const numero = Number(valor.trim())
  return Number.isFinite(numero) ? numero : null
}

/** O mesmo, exigindo inteiro. `'3.7'` e `3.7` são `null`: fracionário numa coluna que
 *  conta mensagens é cadastro errado, não valor a arredondar. */
function inteiroDoBanco(valor: unknown): number | null {
  const numero = numeroDoBanco(valor)
  return numero !== null && Number.isInteger(numero) ? numero : null
}

// ─── Limite diário ────────────────────────────────────────────────────────────

/** Teto da coluna `integer` do Postgres — acima disso o valor não veio de lá. */
const MAX_INTEIRO = 2_147_483_647

/**
 * As três respostas possíveis para "dá para usar este `limite_diario`?".
 *
 * São TRÊS e não duas porque duas delas mandam o operador a lugares diferentes:
 * "ausente" pede que ele CONFIGURE, "invalido" pede que ele ARRUME o que já está
 * configurado. Responder `-1` como "não configurado" manda quem for arrumar procurar
 * um campo vazio que está preenchido.
 */
export type LeituraDoLimite =
  | { estado: 'ok'; limite: number }
  | { estado: 'ausente' }
  | { estado: 'invalido' }

/**
 * Lê o `limite_diario` guardado na base do cliente. Aceita o texto que o driver pode
 * devolver (ver acima); recusa fracionário, negativo e o que passa do teto de um
 * `integer` — o mesmo que lib/sdr/config-write recusa na GRAVAÇÃO. Aqui a defesa é da
 * leitura, para base escrita antes daquela recusa existir.
 */
export function lerLimiteDiario(valor: unknown): LeituraDoLimite {
  if (ausente(valor)) return { estado: 'ausente' }

  const limite = inteiroDoBanco(valor)
  if (limite === null || limite < 0 || limite > MAX_INTEIRO) return { estado: 'invalido' }
  return { estado: 'ok', limite }
}

/** O limite quando dá para usar, e `null` quando não dá — sem distinguir ausente de
 *  inválido. Quem precisa dessa distinção (e a régua precisa, para escolher o motivo)
 *  usa `lerLimiteDiario`. */
export function limiteUtilizavel(valor: unknown): number | null {
  const leitura = lerLimiteDiario(valor)
  return leitura.estado === 'ok' ? leitura.limite : null
}

/**
 * A contagem do dia como ela pode entrar numa subtração: inteiro não-negativo, aceito
 * também como texto (um `SELECT count(*)` pelo `pg` chega como string).
 *
 * `null` para tudo o mais, e as duas recusas que mais importam são opostas: `NaN`
 * atravessaria a subtração inteira (`10 - NaN` é `NaN`, e `NaN` chegando ao
 * `LIMIT $3::int` é o Postgres recusando a instrução — a base do CLIENTE levando a
 * culpa por uma conta nossa), enquanto `null` ou `undefined` num `?? 0` faria o
 * limite diário simplesmente DESLIGAR. Fechar as duas é o motivo desta função existir.
 */
export function contagemUtilizavel(valor: unknown): number | null {
  const contagem = inteiroDoBanco(valor)
  return contagem !== null && contagem >= 0 ? contagem : null
}

/** Vagas que sobram hoje. `null` quando o limite OU a contagem não são utilizáveis —
 *  nunca `NaN`, nunca o limite inteiro por acidente. */
export function vagasDoDia(limiteDiario: unknown, enviadosHoje: unknown): number | null {
  const limite = limiteUtilizavel(limiteDiario)
  const enviados = contagemUtilizavel(enviadosHoje)
  if (limite === null || enviados === null) return null
  return Math.max(0, limite - enviados)
}

/** O que a app sabe sobre o consumo de hoje. Ver CONTAGEM INCOMPLETA no cabeçalho. */
export type ContagemDoDia = {
  /** Como veio de `campaign_config` (texto numérico é aceito); `null` quando não é um
   *  inteiro utilizável — ausente e inválido caem os dois aqui, e quem separa os dois
   *  é o `motivo` do lote. */
  limiteDiario: number | null
  /** `null` quando a régua parou antes de precisar contar (campanha desligada, por
   *  exemplo) — é diferente de ter contado e achado zero. */
  enviadosHoje: number | null
  /** Quantas ainda cabem hoje; `null` pelo mesmo motivo acima. */
  disponivel: number | null
  /** O balde consultado, para o chamador poder dizer de onde veio o número. */
  balde: string
  /** Enquanto o cron antigo do n8n rodar, `enviadosHoje` é um PISO, não o total. */
  incompleta: boolean
  /**
   * Só existe quando o motivo é `contagem_indisponivel`: o erro CRU que a porta de
   * contagem levantou, para o chamador LOGAR.
   *
   * Não é um `SdrDbError` e não pode virar um: quem falhou foi a porta, que fala com o
   * banco DA APP, e a mensagem de `SdrDbError` diz "não foi possível falar com a base de
   * dados do SDR" — acusaria a base do cliente pela nossa indisponibilidade. Também não
   * vai para a tela: pode carregar texto de driver.
   */
  falha?: unknown
}

/**
 * Enquanto o fluxo antigo existir, a contagem da app é sempre parcial — qualquer que
 * seja a porta que o chamador passe. É constante de propósito e não um palpite por
 * tenant: não há como a app saber o que o n8n mandou, porque o cron antigo não escreve
 * nem em `dispatch_claims` (não reserva) nem em `blast_recipients` (não manda ack).
 * Apagar o cron antigo é o commit que troca isto por `false` — e o teste que prende
 * esta bandeira é o lembrete de que a troca existe.
 */
export const CONTAGEM_INCOMPLETA = true

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * A linha vigente de `campaign_config` na base do cliente, como o `SELECT * ... ORDER
 * BY updated_at DESC LIMIT 1` a devolve. As colunas que a régua não usa (`tom`,
 * `objetivo`, `delay_dias`) ficam de fora: `delay_dias` é do ack, que agenda a fase
 * seguinte, e os outros dois são da IA.
 */
export type ConfigDaRegua = {
  ativo?: boolean | null
  remetente?: string | null
  /** `number` na base que conhecemos. `string` está aqui porque o schema NÃO é nosso e
   *  o `pg` devolve `numeric`/`bigint`/`text` como texto — declarar só `number` não
   *  impediria o texto de chegar, só esconderia que ele chega. */
  limite_diario?: number | string | null
  fase_final?: string | null
  horario_inicio?: string | null
  horario_fim?: string | null
  dias_ativos?: string | null
}

export type PedidoDaRegua = {
  /** Dono da campanha. Só serve para nomear o balde do dia — nenhuma consulta na base
   *  do cliente é filtrada por ele; a credencial já É o recorte do tenant. */
  tenantId: string
  /** A configuração vigente, lida por quem chamou. */
  config: ConfigDaRegua
  /** O instante da rodada. Entra como parâmetro (em vez de `new Date()` aqui dentro)
   *  porque é o que deixa a janela e o fuso testáveis sem relógio falso. */
  agora: Date
  /**
   * De onde sai o quanto da cota de hoje JÁ foi comprometido. OBRIGATÓRIA — e o fato de
   * não haver default é a decisão de desenho deste campo, não um esquecimento.
   *
   * HAVIA um default: contar `blast_recipients` no balde do dia, no banco da app. Ele
   * era errado de um jeito que não dava erro em lugar nenhum — aquelas linhas são
   * escritas pelo ack, DEPOIS de o n8n enviar, então a reserva em voo não entrava na
   * conta e o limite do DIA virava limite POR RODADA. Quem enxerga o em voo é
   * `contarConsumidasHoje` de lib/sdr/reservas, e ela tem de ENTRAR NO LUGAR da contagem
   * antiga, nunca ao lado dela: somar as duas conta duas vezes toda mensagem entregue
   * (a reserva liquidada como 'enviada' também vira `blast_recipients` pelo ack) e corta
   * a cota real pela metade.
   *
   * Três coisas impediam consertar isso por dentro, e juntas dão a resposta. Este módulo
   * não pode importar aquela função — lib/sdr/reservas importa `baldeDoDia` daqui, e o
   * import de volta é ciclo. Não pode manter o default antigo — default errado é pior
   * que default nenhum, porque funciona. E não pode confiar num comentário de aviso —
   * quem esquece de trocar o default não estava lendo o comentário. Então o campo é
   * obrigatório e quem chama escolhe em voz alta: não existe jeito de errar por omissão.
   *
   * O que ela devolve é CONFERIDO antes de virar subtração (`contagemUtilizavel`), e o
   * que ela levanta vira `contagem_indisponivel` em vez de escapar: porta pública que
   * decide quantas mensagens saem não entra na conta sem passar pela portaria. Não
   * passá-la é erro de compilação e, quando o compilador não estiver no caminho, o
   * motivo `contagem_nao_fornecida`.
   */
  contarEnviadosHoje: (tenantId: string, agora: Date) => Promise<number>
}

/** Por que este lote saiu do tamanho que saiu. `'ok'` é o único com destinatários. */
export type MotivoDoLote =
  | 'ok'
  /** `campaign_config.ativo` não é true — o interruptor da tela. */
  | 'campanha_inativa'
  /** Sem `remetente` não há de quem a mensagem sai (mesma recusa da rota de blast). */
  | 'remetente_nao_configurado'
  /** Sem `fase_final`, `fase <> NULL` não seleciona NADA. Zero com nome, não mistério. */
  | 'fase_final_nao_configurada'
  | 'dias_ativos_invalido'
  | 'dia_inativo'
  | 'horario_invalido'
  | 'horario_invertido'
  | 'fora_do_horario'
  /** `limite_diario` não foi informado: NULL, ausente ou em branco. Falta configurar. */
  | 'limite_diario_nao_configurado'
  /** `limite_diario` está lá e não serve: `-1`, `3.7`, `'dez'`, acima do teto de um
   *  `integer`. Não é "não configurado" — está configurado errado, e o operador tem de
   *  ser mandado para o valor que existe, não para um campo vazio. */
  | 'limite_diario_invalido'
  /** `limite_diario` é ZERO. Nada foi atingido: foi configurado para não disparar.
   *  lib/sdr/config-write aceita 0 como válido, então isto vem do produto, não de
   *  base corrompida. */
  | 'limite_diario_zero'
  /** A cota de hoje acabou de verdade: o limite é maior que zero e já foi gasto. Os
   *  números estão em `limite`. */
  | 'limite_diario_atingido'
  /** A porta de contagem NÃO FOI PASSADA. Não é estado da campanha nenhum: é defeito de
   *  quem chamou, e o compilador já o recusa. Este motivo existe para quando o
   *  compilador não está no caminho — pedido montado a partir de JSON, um `any` no meio,
   *  chamada vinda de JavaScript — e os chamadores deste módulo são rotas, que neste
   *  repositório não têm teste. Sem saber quanto da cota já foi gasto, nada é reservado;
   *  ver `contarEnviadosHoje` em `PedidoDaRegua` para por que não há default. */
  | 'contagem_nao_fornecida'
  /** A porta de contagem falhou. FECHADO: nada foi reservado — mas a culpa é NOSSA (a
   *  porta fala com o banco da APP, não com o do cliente), e por isso não é
   *  `SdrDbError`. O erro cru vem em `limite.falha`, para o chamador logar. */
  | 'contagem_indisponivel'
  /** A porta de contagem respondeu o que não dá para subtrair (`NaN`, `null`, `-1`,
   *  `1.5`). Também fechado, e também nosso: `contarEnviadosHoje` é API pública, e o
   *  que ela devolve decide quantas mensagens saem. */
  | 'contagem_invalida'
  /** A janela estava aberta e havia cota: simplesmente não havia lead vencido. */
  | 'nada_devido'
  /** Havia leads vencidos e TODOS foram descartados — ver `descartados`. */
  | 'todos_descartados'

/** Por que uma linha reservada não virou mensagem. */
export type MotivoDescarte =
  /** `lead_actions` apontando para um `leads` que não existe mais. */
  | 'lead_ausente'
  /** Nenhum `meta_templates_whatsapp` com `fase_envio` igual à fase da linha. */
  | 'template_ausente'
  | 'sem_telefone'
  /** O template usa o nome e o lead não tem nome. Não existe saudação de reserva. */
  | 'sem_nome'
  /** Sobrou `{{n}}` depois do render — a mensagem chegaria com a chave literal. */
  | 'variavel_sem_valor'

/**
 * Um destinatário pronto. Os cinco primeiros campos são exatamente a forma que a rota
 * de blast já manda ao n8n; os outros são o recibo da reserva, que o ack usa para
 * avançar a fase.
 */
export type Destinatario = {
  leadId: string
  phone: string
  first_name: string
  message: string
  session_id: string
  /** A `lead_actions` reservada — a chave para avançar a fase ou devolver a reserva. */
  acaoId: string
  /** A fase em que o lead ESTAVA. A próxima é derivada dela pelo ack. */
  fase: string
  idFase: number | null
  /** `meta_templates_whatsapp.nome_template` da fase — o que o YCloud precisa. */
  template: string
}

/** Uma reserva que não vai virar envio. A reserva CONTINUA de pé: quem recebe isto
 *  decide entre devolvê-la (`devolverReservas`) ou tratá-la como encerrada. */
export type Descartado = {
  acaoId: string
  leadId: string
  fase: string
  motivo: MotivoDescarte
}

export type LoteDaRegua = {
  motivo: MotivoDoLote
  enviar: Destinatario[]
  descartados: Descartado[]
  /** Linhas de `lead_actions` marcadas `ativo = false` nesta chamada.
   *  Sempre `enviar.length + descartados.length`. */
  reservadas: number
  /**
   * Linhas ativas e já vencidas que a régua NÃO consegue enxergar porque a `fase` é
   * NULL — paradas na campanha para sempre, sem aparecer em `enviar` nem em
   * `descartados`. Ver LINHA COM `fase` NULL no cabeçalho.
   *
   * `null` quando a rodada parou antes de consultar a base do cliente (campanha
   * desligada, fora do horário, cota esgotada): é diferente de ter olhado e achado
   * zero. Convive com qualquer motivo, inclusive `'ok'` — mostrar isto é do chamador.
   */
  devidosSemFase: number | null
  limite: ContagemDoDia
  janela: EstadoDaJanela
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

/**
 * Seleciona, reserva e enriquece — numa instrução só. É a instrução única que fecha a
 * corrida com o cron antigo; ver A RESERVA no cabeçalho.
 *
 * `a.fase <> $2::text` é o filtro do n8n, LETRA POR LETRA, com a consequência que ele
 * sempre teve: em lógica de três valores, fase NULL faz a comparação virar NULL e a
 * linha fica de fora. Trocar por `IS DISTINCT FROM` incluiria leads que a campanha
 * nunca tocou. Ver DESVIO CONHECIDO no cabeçalho.
 *
 * `a.ativo = true` também é literal: linha com `ativo` NULL é invisível aqui, como já
 * era lá (e como lib/sdr/enroll-write documenta do outro lado). O `AND a.ativo = true`
 * repetido no UPDATE é a segunda tranca da mesma porta: dentro de uma instrução só ele
 * é redundante — o que a CTE selecionou é o que o UPDATE vê —, e passa a ser a única
 * defesa no instante em que alguém afrouxar o filtro da CTE. Não sai.
 *
 * `sem_fase` é diagnóstico, não seleção: conta as linhas devidas que a lógica de três
 * valores deixa de fora e NÃO reserva nenhuma delas (ver LINHA COM `fase` NULL no
 * cabeçalho). Ela viaja aqui, e não numa segunda consulta, para não custar outra ida à
 * base do cliente nem poder falhar depois de a reserva estar confirmada. O preço é a
 * forma do `FROM`: o resumo é a tabela da esquerda, então quando NADA é reservado a
 * consulta devolve UMA linha com `acao_id` NULL — a linha-resumo. Quem lê filtra num
 * lugar só, em `selecionarDevidos`; a contagem vem igual em todas as linhas.
 *
 * `ORDER BY data_proxima_msg_outbound` é acréscimo nosso: quando a cota é menor que a
 * fila, quem está esperando há mais tempo passa na frente. O fluxo antigo pegava o que
 * o banco devolvesse.
 *
 * O `LEFT JOIN` em `leads` e o `LEFT JOIN LATERAL` no template são o que transforma
 * "sumiu" em motivo em vez de linha a menos: reservamos, então temos de dizer o que
 * aconteceu com cada reserva.
 */
const SQL_RESERVAR = `
WITH devidos AS (
  SELECT a.id
    FROM lead_actions a
   WHERE a.ativo = true
     AND a.data_proxima_msg_outbound <= $1::timestamptz
     AND a.fase <> $2::text
   ORDER BY a.data_proxima_msg_outbound ASC, a.id ASC
   LIMIT $3::int
     FOR UPDATE SKIP LOCKED
), reservadas AS (
  UPDATE lead_actions a
     SET ativo = false
    FROM devidos d
   WHERE a.id = d.id AND a.ativo = true
  RETURNING a.id, a.lead_id, a.fase, a.id_fase, a.data_proxima_msg_outbound
), sem_fase AS (
  SELECT count(*)::int AS total
    FROM lead_actions a
   WHERE a.ativo = true
     AND a.data_proxima_msg_outbound <= $1::timestamptz
     AND a.fase IS NULL
)
SELECT r.id AS acao_id, r.lead_id, r.fase, r.id_fase,
       s.total AS devidos_sem_fase,
       (l.id IS NOT NULL) AS tem_lead,
       l.name, l.phone, l.phone_adjusted,
       t.nome_template, t.mensagem_template
  FROM sem_fase s
  LEFT JOIN reservadas r ON true
  LEFT JOIN leads l ON l.id = r.lead_id
  LEFT JOIN LATERAL (
    SELECT m.nome_template, m.mensagem_template
      FROM meta_templates_whatsapp m
     WHERE m.fase_envio = r.fase
       AND m.nome_template IS NOT NULL
       AND COALESCE(m.mensagem_template, '') <> ''
     ORDER BY m.rank_disparo NULLS LAST, m.nome_template
     LIMIT 1
  ) t ON true
 ORDER BY r.data_proxima_msg_outbound ASC, r.id ASC`

/** Devolve a reserva: `ativo = false` volta a ser `true`. O `AND ativo = false` evita
 *  reanimar linha que outro caminho já reativou.
 *
 *  Os ids entram como JSON e não como array do Postgres, pelo mesmo motivo de
 *  lib/sdr/enroll-write: `jsonb` atravessa driver e parâmetro sem depender de como
 *  cada um serializa array. */
const SQL_DEVOLVER = `
UPDATE lead_actions a
   SET ativo = true
  FROM jsonb_array_elements_text($1::jsonb) AS p(id)
 WHERE a.id = p.id::uuid
   AND a.ativo = false
RETURNING a.id`

/**
 * Uma linha do resultado de `SQL_RESERVAR` — que pode ser uma RESERVA ou a linha-resumo
 * (`acao_id` NULL), a que vem sozinha quando nada foi reservado.
 *
 * Os numéricos entram como `number | string` porque o schema do cliente não é nosso e o
 * `pg` devolve `numeric`/`bigint` como texto; quem lê passa por `inteiroDoBanco`.
 */
type LinhaDoLote = {
  acao_id: string | null
  lead_id: string | null
  fase: string | null
  id_fase: number | string | null
  devidos_sem_fase: number | string | null
  tem_lead: boolean | null
  name: string | null
  phone: string | null
  phone_adjusted: string | null
  nome_template: string | null
  mensagem_template: string | null
}

/** Uma linha que É uma reserva. `lead_id` continua podendo ser NULL de propósito: a
 *  coluna é NOT NULL na base que conhecemos, mas o schema não é nosso, e uma linha
 *  reservada que a gente descartasse por tipo viraria reserva órfã — sai como
 *  `lead_ausente`, com dívida declarada. */
type LinhaReservada = LinhaDoLote & { acao_id: string }

// ─── Régua ────────────────────────────────────────────────────────────────────

/**
 * Escolhe e RESERVA o lote devido agora.
 *
 * A ordem das recusas é escolhida, não acidental: primeiro o defeito de quem chamou (a
 * porta de contagem), depois o que é configuração (interruptor, remetente, fase final),
 * depois o relógio, depois a cota, e só então o banco do cliente. Nenhuma linha é
 * reservada antes de todas essas respostas serem "pode" — reservar para depois descobrir
 * que não podia é exatamente o buraco em que um lead some da campanha.
 *
 * Erro da base do CLIENTE sobe como `SdrDbError` pelo `withSdrDb`; nada é engolido.
 * "Nada a enviar" NUNCA é erro: é um lote vazio com motivo.
 *
 * A única exceção — e ela é deliberada — é a porta de contagem, que não é deste módulo e
 * fala com o banco DA APP: falhar ali vira o motivo `contagem_indisponivel`, com o erro
 * original em `limite.falha`. Deixar subir cru faria o chamador que traduz `SdrDbError`
 * em "a base do SDR está fora" acusar a base do cliente por uma queda nossa; e deixar sem
 * motivo seria o único caminho de "nada a enviar" sem código próprio, que é justamente o
 * que este módulo veio abolir. Pela mesma régua, a porta AUSENTE sai com motivo próprio
 * (`contagem_nao_fornecida`) em vez de um `TypeError` sem nome.
 */
export async function selecionarDevidos(
  connectionString: string,
  pedido: PedidoDaRegua,
): Promise<LoteDaRegua> {
  const { tenantId, config, agora } = pedido

  const balde = baldeDoDia(tenantId, agora)
  const leituraDoLimite = lerLimiteDiario(config.limite_diario)
  const limiteDiario = leituraDoLimite.estado === 'ok' ? leituraDoLimite.limite : null

  const vazio = (
    motivo: MotivoDoLote,
    janela: EstadoDaJanela,
    contagem?: { enviadosHoje: number | null; disponivel: number | null; falha?: unknown },
  ): LoteDaRegua => ({
    motivo,
    enviar: [],
    descartados: [],
    reservadas: 0,
    // Nenhum lote vazio chega a consultar a base do cliente, então ninguém OLHOU para
    // as linhas sem fase: `null` é "não contei", e não "não tem".
    devidosSemFase: null,
    limite: {
      limiteDiario,
      enviadosHoje: contagem?.enviadosHoje ?? null,
      disponivel: contagem?.disponivel ?? null,
      balde,
      incompleta: CONTAGEM_INCOMPLETA,
      // A chave só existe quando há falha: um `falha: undefined` em todo lote faria
      // `'falha' in limite` mentir para quem testar assim.
      ...(contagem?.falha === undefined ? null : { falha: contagem.falha }),
    },
    janela,
  })

  // A janela é calculada antes de tudo porque ela entra no resultado mesmo quando a
  // recusa é outra: o operador que vê "campanha inativa" ainda quer saber que horas a
  // régua achou que eram.
  const resultadoJanela = janelaDeEnvio(config, agora)
  const janela = resultadoJanela.janela

  /* A porta de contagem é conferida ANTES de qualquer pergunta sobre a campanha, e a
   * ordem é escolhida. Todas as outras recusas descrevem um ESTADO da campanha —
   * desligada, fora do horário, sem cota —; esta descreve um DEFEITO DE QUEM CHAMOU, e
   * defeito não espera a sua vez. Posta depois das outras, ela só apareceria na primeira
   * rodada que chegasse até a contagem, ou seja, na primeira rodada em que mensagens
   * sairiam de verdade — o pior instante possível para descobrir que a cota não seria
   * conferida.
   *
   * O tipo já recusa quem esquecer, e este `if` parece redundante por causa disso. Não é:
   * os chamadores deste módulo são rotas, e rota neste repositório não tem teste; o
   * pedido delas pode ser montado a partir de JSON, atravessar um `any` ou vir de
   * JavaScript, e aí o compilador não está no caminho. Sem o `if`, o que acontece é um
   * `TypeError` cru subindo do meio da função — o zero sem nome que este módulo inteiro
   * existe para abolir. Com ele, é um motivo. */
  if (typeof pedido.contarEnviadosHoje !== 'function') {
    return vazio('contagem_nao_fornecida', janela)
  }

  if (config.ativo !== true) return vazio('campanha_inativa', janela)

  // Mesma recusa da rota de blast: sem remetente não há de quem a mensagem sai, e
  // descobrir isso depois de reservar as linhas custaria uma devolução.
  if (ausente(config.remetente)) return vazio('remetente_nao_configurado', janela)

  // `fase <> NULL` é NULL para toda linha: a consulta voltaria vazia e pareceria "não
  // tem ninguém na fila". Ver DESVIO CONHECIDO no cabeçalho.
  if (ausente(config.fase_final)) return vazio('fase_final_nao_configurada', janela)

  if (!resultadoJanela.aberta) return vazio(resultadoJanela.motivo, janela)

  /* Três leituras do limite, três motivos — porque cada um manda o operador a um lugar
   * diferente: configurar, arrumar o que está configurado, ou entender que ele mesmo
   * pediu zero. Um "limite atingido" com zero enviado é uma frase falsa, e frase falsa
   * num módulo cujo trabalho é explicar o zero é pior do que zero sem explicação. */
  if (leituraDoLimite.estado === 'ausente') return vazio('limite_diario_nao_configurado', janela)
  if (leituraDoLimite.estado === 'invalido') return vazio('limite_diario_invalido', janela)
  /* Zero não precisa de contagem para ser respondido: nenhuma contagem muda a resposta,
   * e contar custaria uma consulta ao banco da app. `disponivel: 0` sai preenchido
   * porque é fato; `enviadosHoje: null` porque de fato ninguém contou. */
  if (leituraDoLimite.limite === 0) {
    return vazio('limite_diario_zero', janela, { enviadosHoje: null, disponivel: 0 })
  }

  let contagemBruta: unknown
  try {
    contagemBruta = await pedido.contarEnviadosHoje(tenantId, agora)
  } catch (erro) {
    /* FECHADO: sem saber o que já saiu hoje, não se reserva nada — a alternativa seria
     * mandar em cima de um limite que ninguém conferiu. Mas isto NÃO sobe como erro
     * cru nem vira `SdrDbError`: quem caiu foi a porta, que fala com o banco da APP, e
     * `SdrDbError` diria ao operador que a base do CLIENTE está fora — culpando o
     * cliente pela nossa queda.
     * Motivo próprio, e o erro original viaja em `limite.falha` para o log. */
    return vazio('contagem_indisponivel', janela, {
      enviadosHoje: null, disponivel: null, falha: erro,
    })
  }

  /* `contarEnviadosHoje` é porta pública: o que ela devolve decide quantas mensagens
   * saem. `NaN` atravessaria a subtração e chegaria ao `LIMIT $3::int`, onde o Postgres
   * recusa a instrução inteira — e o operador leria "não foi possível falar com a base
   * do SDR" por causa de uma conta nossa. `null` faria a subtração devolver o limite
   * inteiro, ou seja, desligaria o limite diário em silêncio. Nenhuma das duas. */
  const enviadosHoje = contagemUtilizavel(contagemBruta)
  if (enviadosHoje === null) return vazio('contagem_invalida', janela)

  const disponivel = vagasDoDia(leituraDoLimite.limite, enviadosHoje)
  /* Inalcançável hoje: limite e contagem já passaram pelas duas validações acima. O
   * `if` é o que garante que continue inalcançável — se um dia deixar de ser verdade, o
   * operador recebe um motivo em vez de um `NaN` viajando até o banco do cliente. */
  if (disponivel === null) {
    return vazio('contagem_invalida', janela, { enviadosHoje, disponivel: null })
  }

  const contagem = { enviadosHoje, disponivel }

  // Aqui o limite é maior que zero (o caso zero já saiu com o seu motivo), então
  // `disponivel === 0` significa mesmo "a cota de hoje acabou".
  if (disponivel === 0) return vazio('limite_diario_atingido', janela, contagem)

  const { rows } = await withSdrDb(connectionString, sdr =>
    sdr.query<LinhaDoLote>(SQL_RESERVAR, [
      agora.toISOString(),
      config.fase_final,
      disponivel,
    ]),
  )

  /* A consulta devolve SEMPRE pelo menos uma linha: quando nada foi reservado, vem só a
   * linha-resumo, com `acao_id` NULL (ver SQL_RESERVAR). O filtro é aqui, uma vez, e
   * daqui para baixo `linhas` são reservas de verdade — ninguém mais precisa lembrar
   * disso. A contagem das sem-fase vem igual em todas as linhas, então a primeira
   * serve; `null` só se não vier linha nenhuma, o que seria a consulta mudando de forma. */
  const devidosSemFase = rows.length > 0 ? contagemUtilizavel(rows[0].devidos_sem_fase) : null
  const linhas = rows.filter((linha): linha is LinhaReservada => linha.acao_id !== null)

  const enviar: Destinatario[] = []
  const descartados: Descartado[] = []

  for (const linha of linhas) {
    // A fase da linha reservada é o que amarra o destinatário ao template e ao avanço
    // do ack; sem ela não há como seguir, e a linha vira descarte com a fase em branco.
    const fase = linha.fase ?? ''
    // `lead_id` NULL não deveria existir (a coluna é NOT NULL na base que conhecemos),
    // mas o schema não é nosso: a linha JÁ FOI reservada, e sumir com ela aqui seria
    // fabricar reserva órfã. Sai como `lead_ausente`, com a dívida declarada.
    const leadId = linha.lead_id ?? ''
    const descartar = (motivo: MotivoDescarte) =>
      descartados.push({ acaoId: linha.acao_id, leadId, fase, motivo })

    if (!linha.tem_lead) { descartar('lead_ausente'); continue }

    /* Template antes de telefone de propósito: template faltando é problema de
     * CONFIGURAÇÃO e atinge a fase inteira, enquanto telefone é de um lead só. Hoje
     * essa falta chega ao YCloud como erro e é registrada como falha de TELEFONE, o
     * que manda quem for depurar para o lugar errado. */
    const corpo = linha.mensagem_template ?? ''
    if (!linha.nome_template || !corpo) { descartar('template_ausente'); continue }

    const phone = ensureBr9(toE164(linha.phone, linha.phone_adjusted) ?? '')
    if (!phone) { descartar('sem_telefone'); continue }

    const first_name = String(linha.name ?? '').trim().split(/\s+/)[0] ?? ''
    // Regra da rota de blast: lead sem nome não recebe template que usa nome. Não
    // existe saudação de reserva — inventar nome faz a mensagem mentir para o lead.
    if (!first_name && POSICIONAL_RE.test(corpo)) { descartar('sem_nome'); continue }

    const message = renderMessage(corpo, [first_name])
    /* A rota de blast derruba o PEDIDO INTEIRO quando sobra placeholder, porque lá
     * todo mundo recebe o mesmo template. Aqui cada fase tem o seu, então a recusa é
     * por destinatário: um template mal cadastrado não pode calar os outros. O que
     * não muda é que a mensagem com `{{...}}` literal não sai. */
    if (unresolvedPlaceholders(message).length > 0) { descartar('variavel_sem_valor'); continue }

    const rawSession = (linha.phone_adjusted ?? linha.phone ?? '').replace(/\D/g, '')
    enviar.push({
      leadId,
      phone,
      first_name,
      message,
      session_id: rawSession || phone.replace(/\D/g, ''),
      acaoId: linha.acao_id,
      fase,
      // `integer` na base que conhecemos — mas o schema não é nosso, e num `numeric` o
      // driver devolveria texto. `idFase: number | null` só é verdade porque passa aqui.
      idFase: inteiroDoBanco(linha.id_fase),
      template: linha.nome_template,
    })
  }

  const motivo: MotivoDoLote = enviar.length > 0
    ? 'ok'
    : linhas.length > 0 ? 'todos_descartados' : 'nada_devido'

  return {
    motivo,
    enviar,
    descartados,
    reservadas: linhas.length,
    devidosSemFase,
    limite: {
      limiteDiario,
      enviadosHoje,
      disponivel,
      balde,
      incompleta: CONTAGEM_INCOMPLETA,
    },
    janela,
  }
}

/**
 * Devolve reservas que não viraram envio: `ativo` volta a `true` e o lead volta para a
 * fila, na mesma fase e no mesmo agendamento.
 *
 * Existe porque a reserva é uma dívida (ver A RESERVA no cabeçalho). Sem isto, um lote
 * em que o n8n não respondeu deixaria todo mundo com `ativo = false` — leads fora da
 * campanha para sempre, sem erro em lugar nenhum.
 *
 * Devolve quantas linhas VOLTARAM, que pode ser menos do que o pedido: linha que já
 * estava ativa não é contada duas vezes.
 */
export async function devolverReservas(
  connectionString: string,
  acaoIds: string[],
): Promise<number> {
  const ids = Array.from(new Set(
    (Array.isArray(acaoIds) ? acaoIds : [])
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .map(id => id.trim()),
  ))
  if (ids.length === 0) return 0

  const { rows } = await withSdrDb(connectionString, sdr =>
    sdr.query<{ id: string }>(SQL_DEVOLVER, [JSON.stringify(ids)]),
  )
  return rows.length
}
