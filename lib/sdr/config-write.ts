// Grava a configuração da campanha na tabela `campaign_config` da base do cliente.
//
// POR QUE EXISTE
// Até aqui o caminho era: a app salvava as settings no banco dela, mandava o JSON
// para um webhook do n8n ("Receptor Config — write-back") e ERA O N8N que traduzia
// aquele JSON para as colunas de `campaign_config`. Três consequências ruins: o
// mapa vivia fora do repositório (ninguém revisava, ninguém testava), a app só
// sabia se o HTTP voltou 200 — não se a linha entrou — e o fluxo de disparo lia uma
// tabela que a app nunca tinha visto. Este módulo traz o mapa para cá.
//
// O QUE NÃO MUDA
// O fluxo de disparo continua lendo `SELECT * FROM campaign_config ORDER BY
// updated_at DESC LIMIT 1`. Por isso aqui se INSERE uma linha nova a cada save, em
// vez de atualizar a existente: é o que mantém aquele fluxo funcionando sem
// nenhuma alteração do lado do n8n. O preço é conhecido e aceito — a tabela cresce
// uma linha por gravação, e vira histórico de quem mexeu no quê.
//
// A REGRA DO OMITIR
// Toda coluna aqui já tem DEFAULT no banco do cliente. Quando nem as settings
// novas nem a linha anterior trazem valor, a coluna fica FORA do INSERT e quem
// responde é o DEFAULT da coluna — nunca um literal escrito neste arquivo. É o que
// tira do código o número de telefone que o n8n usava como fallback de
// `remetente`: aquilo é a linha de UM cliente, e uma aplicação multi-tenant não
// pode carregar o número de um cliente como padrão de todos os outros.
//
// A REGRA DO NÃO GRAVAR (a trava que existe por causa da tela de Credenciais)
// A `/api/sdr/settings` é salva por DUAS telas. A de Parâmetros manda a campanha;
// a de Credenciais (Configurações → Integrações) manda as URLs do n8n e, junto,
// uma cópia literal das settings guardadas mais o `status` que o GET devolveu.
// Quando o tenant ainda não tem linha de `campaign_settings`, esse GET devolve
// `status: 'draft'` — e o replay chegava aqui como se alguém tivesse escolhido
// "rascunho", escrevendo `ativo = false` numa campanha que estava rodando. Salvar
// uma URL de webhook parava os disparos, com a tela dizendo "salvo".
// Daí as duas travas, independentes uma da outra:
//   1. `mudouAlgoDeCampanha` — save que não mexeu em NENHUM valor de campanha nem
//      no status não gera linha nova. Replay é no-op, não gravação.
//   2. `statusMudou` — `ativo` só é escrito a partir do status quando o status
//      mudou de verdade. Não mudou, vale o `ativo` da linha vigente do cliente.
// A trava 2 é a que segura o caso sem linha guardada, onde a 1 não ajuda: sem
// `anteriores` tudo "mudou", mas o status continua sendo o 'draft' que o GET
// inventou, e um 'draft' inventado não desliga campanha de ninguém.
//
// O QUE É RECUSADO EM VEZ DE GRAVADO
// `limiteDiario` e `intervaloDias` alimentam colunas `integer`. Antes, `' '`, `[]`
// e `false` viravam `0` pelo `Number()` — campanha que não dispara nada, com a
// tela verde — e `3.7`, `5e9` ou `1e21` chegavam ao Postgres só para ele recusar o
// INSERT inteiro como erro genérico de banco. Agora o que não é inteiro
// não-negativo dentro do teto de `integer` é recusado ANTES da conexão, com código
// próprio (`ConfigCampanhaInvalida`), que a rota devolve como 400. O mesmo vale
// para `numToques`: ele nomeia a fase do template que o fluxo de disparo procura,
// então `0`, `-3` ou `'7abc'` não são "aproveitáveis", são um nome de fase que não
// existe — e disparo nenhum casa com ele.
//
// DESVIOS DELIBERADOS DO MAPA QUE RODAVA NO N8N — todos, em um lugar só
//   1. `remetente` sem valor não cai em literal nenhum: a coluna sai do INSERT e
//      quem responde é o DEFAULT do banco do cliente (ver A REGRA DO OMITIR).
//   2. `tom`, `objetivo` e `remetente` que não são string caem no valor anterior.
//      No n8n, um número ou um objeto virava texto e era gravado; aqui não se
//      inventa conteúdo para coluna que o fluxo de disparo lê.
//   3. `numToques` inválido não vira `'Template NaN'` (nem `'Template 0'`, nem
//      `'Template 3'` vindo de `3.9`, como o `parseInt` fazia): é recusado.
//   4. `limiteDiario`/`intervaloDias` inválidos são recusados em vez de virarem
//      `0` — ver O QUE É RECUSADO EM VEZ DE GRAVADO.
//   5. `diasAtivos: []` é recusado. `[].join(',')` é `''`, e gravar `''` seria
//      dizer "nenhum dia" numa coluna cujo vazio ninguém definiu.
//   6. `ativo` só vem do status quando o status mudou (A REGRA DO NÃO GRAVAR).
//   7. Save que não muda nada de campanha não gera linha.

import { withSdrDb } from './pg'

/**
 * As colunas de `campaign_config` que esta aplicação escreve — `id` e `updated_at`
 * ficam de fora de propósito, são do banco.
 *
 * Chave ausente não é "escreve NULL": é "não entra no INSERT". Ver A REGRA DO
 * OMITIR, acima.
 */
export type ConfigCampanha = {
  remetente?:      string
  limite_diario?:  number
  delay_dias?:     number
  fase_final?:     string
  horario_inicio?: string
  horario_fim?:    string
  dias_ativos?:    string
  tom?:            string
  objetivo?:       string
  ativo?:          boolean
}

/** Ordem fixa das colunas no INSERT. É a ÚNICA fonte de nome de coluna que chega
 *  ao texto SQL — nada vindo das settings do cliente é interpolado. Exportada para
 *  o teste poder prender essa invariante. */
export const COLUNAS = [
  'remetente', 'limite_diario', 'delay_dias', 'fase_final',
  'horario_inicio', 'horario_fim', 'dias_ativos', 'tom', 'objetivo', 'ativo',
] as const satisfies readonly (keyof ConfigCampanha)[]

/** A linha anterior, como ela volta do banco do cliente. */
type LinhaConfig = {
  remetente:      string | null
  limite_diario:  number | null
  delay_dias:     number | null
  fase_final:     string | null
  horario_inicio: string | null
  horario_fim:    string | null
  dias_ativos:    string | null
  tom:            string | null
  objetivo:       string | null
  ativo:          boolean | null
}

/** Um save, do ponto de vista da campanha: o que passa a valer, o que valia antes
 *  e os dois status. É a partir do "antes" que as duas travas decidem. */
export type SaveDeCampanha = {
  /** As settings que passam a valer — já mescladas pela rota. */
  settings: Record<string, unknown>
  /** As settings guardadas ANTES deste save; `null` quando o tenant não tinha linha. */
  anteriores: Record<string, unknown> | null
  /** O status deste save: 'draft', 'active' ou 'paused'. */
  status: string
  /** O status guardado antes; `null` quando o tenant não tinha linha. */
  statusAnterior: string | null
}

export type ResultadoGravacao =
  | { gravado: true;  config: ConfigCampanha }
  | { gravado: false; motivo: 'sem_mudanca' }

// O mesmo SELECT que o fluxo de disparo usa para escolher a configuração vigente:
// se ele lê esta linha, é dela que o merge tem de partir.
const SQL_ANTERIOR = 'SELECT * FROM campaign_config ORDER BY updated_at DESC LIMIT 1'

// ─── Recusa ───────────────────────────────────────────────────────────────────

export type CodigoConfigInvalida =
  | 'limite_diario_invalido'
  | 'intervalo_dias_invalido'
  | 'num_toques_invalido'
  | 'dias_ativos_vazio'

/**
 * Settings que não podem virar linha de `campaign_config`. Não é erro de banco —
 * nem chega a abrir conexão —, então NÃO passa por `mapSdrDbError`: a mensagem já
 * é a do usuário, e o `code` é o que a rota devolve como erro de 400.
 */
export class ConfigCampanhaInvalida extends Error {
  readonly code: CodigoConfigInvalida

  constructor(code: CodigoConfigInvalida, mensagem: string) {
    super(mensagem)
    this.name = 'ConfigCampanhaInvalida'
    this.code = code
  }
}

/** Teto da coluna `integer` do Postgres. Passar disso é INSERT recusado pelo banco. */
const MAX_INTEIRO = 2_147_483_647

/** Quantidade máxima de toques — é a faixa que a tela de Parâmetros oferece (1–20)
 *  e cada um deles é uma fase `Template N` que precisa existir do outro lado. */
const MAX_TOQUES = 20

// ─── Coerções ─────────────────────────────────────────────────────────────────

/** `null` do banco e "não veio" viram a mesma coisa para o merge. */
function semNulo<T>(valor: T | null | undefined): T | undefined {
  return valor ?? undefined
}

/** "Não informado": mantém o que já estava gravado, sem recusa. `''` entra aqui
 *  porque é o que um campo numérico vazio na tela manda — é ausência, não lixo. */
function naoInformado(valor: unknown): boolean {
  return valor === undefined || valor === null || valor === ''
}

/** Texto que conta como preenchido (semântica do `||` do mapa antigo: `''` não
 *  conta e deixa passar para o próximo fallback). */
function textoCheio(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor !== '' ? valor : undefined
}

/** Texto que conta como informado (semântica do `??`: `''` é um valor, e apaga o
 *  que estava lá). Usado onde a coluna aceita NULL e o vazio é intencional. */
function textoInformado(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined
}

/**
 * Inteiro que a coluna aceita, entre `min` e `MAX_INTEIRO`. Devolve `undefined`
 * para tudo o mais — inclusive `3.7`, `-1`, `5e9`, `' '`, `[]` e `false`, que o
 * `Number()` de antes transformava em `0` ou empurrava para o Postgres recusar.
 *
 * String só passa se for de dígitos: settings guardadas por versões antigas podem
 * trazer `'40'`, e recusá-las quebraria um save que nunca teve nada de errado.
 */
function inteiro(valor: unknown, min: number, max = MAX_INTEIRO): number | undefined {
  const n = typeof valor === 'number' ? valor
    : typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor.trim())
    : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

// ─── Validação ────────────────────────────────────────────────────────────────

/**
 * Confere as settings de campanha antes de qualquer gravação. Devolve o erro —
 * não lança — para a rota poder responder 400 sem ter tocado em banco nenhum.
 *
 * Só olha o que vira coluna: o resto das settings (URLs, segredos, templates) não
 * é assunto deste módulo.
 */
export function validarConfigCampanha(
  settings: Record<string, unknown>,
): ConfigCampanhaInvalida | null {
  if (!naoInformado(settings.limiteDiario) && inteiro(settings.limiteDiario, 0) === undefined) {
    return new ConfigCampanhaInvalida(
      'limite_diario_invalido',
      `limiteDiario inválido: use um número inteiro entre 0 e ${MAX_INTEIRO}.`,
    )
  }

  if (!naoInformado(settings.intervaloDias) && inteiro(settings.intervaloDias, 0) === undefined) {
    return new ConfigCampanhaInvalida(
      'intervalo_dias_invalido',
      `intervaloDias inválido: use um número inteiro entre 0 e ${MAX_INTEIRO}.`,
    )
  }

  if (!naoInformado(settings.numToques) && inteiro(settings.numToques, 1, MAX_TOQUES) === undefined) {
    return new ConfigCampanhaInvalida(
      'num_toques_invalido',
      `numToques inválido: use um número inteiro entre 1 e ${MAX_TOQUES} — ele nomeia a fase ("Template N") que o fluxo de disparo procura.`,
    )
  }

  if (Array.isArray(settings.diasAtivos) && settings.diasAtivos.length === 0) {
    return new ConfigCampanhaInvalida(
      'dias_ativos_vazio',
      'diasAtivos vazio: escolha ao menos um dia da semana. Para não disparar, pause a campanha.',
    )
  }

  return null
}

// ─── As duas travas ───────────────────────────────────────────────────────────

/** As chaves que o mapa abaixo lê. Mudança fora desta lista não muda nada em
 *  `campaign_config` — e por isso não justifica linha nova. */
const CHAVES_DE_CAMPANHA = [
  'remetente', 'limiteDiario', 'intervaloDias', 'numToques',
  'horario', 'diasAtivos', 'tom', 'objetivo',
] as const

/** Comparação estrutural: `horario` é objeto e `diasAtivos` é array, e trocar a
 *  ordem das chaves de um objeto não é mudança de configuração. */
function iguais(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length
      && a.every((item, i) => iguais(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ca = a as Record<string, unknown>
    const cb = b as Record<string, unknown>
    const chaves = new Set([...Object.keys(ca), ...Object.keys(cb)])
    return [...chaves].every(chave => iguais(ca[chave], cb[chave]))
  }
  return false
}

/** O status que valia antes. Sem linha guardada, o GET da rota entrega 'draft' a
 *  todas as telas — então 'draft' é o que "estava valendo", e um 'draft' de volta
 *  não é escolha de ninguém. */
function statusAnterior(save: SaveDeCampanha): string {
  return save.statusAnterior ?? 'draft'
}

function statusMudou(save: SaveDeCampanha): boolean {
  return save.status !== statusAnterior(save)
}

/** Trava 1: este save mexeu em alguma coisa que a `campaign_config` enxerga? */
function mudouAlgoDeCampanha(save: SaveDeCampanha): boolean {
  if (statusMudou(save)) return true
  const antes = save.anteriores ?? {}
  return CHAVES_DE_CAMPANHA.some(chave => !iguais(antes[chave], save.settings[chave]))
}

// ─── Mapa settings → colunas ──────────────────────────────────────────────────

/**
 * Traduz as settings da app para as colunas de `campaign_config`, usando `prev`
 * — a linha vigente NA BASE DO CLIENTE — como base: o que o save omite continua
 * valendo o que já estava lá.
 *
 * Os desvios em relação ao mapa que rodava no n8n estão listados no cabeçalho do
 * arquivo, em DESVIOS DELIBERADOS.
 */
function mapear(prev: LinhaConfig | undefined, save: SaveDeCampanha): ConfigCampanha {
  const { settings } = save
  const config: ConfigCampanha = {}
  const por = <K extends keyof ConfigCampanha>(chave: K, valor: ConfigCampanha[K] | undefined) => {
    if (valor !== undefined) config[chave] = valor
  }

  const horario = (typeof settings.horario === 'object' && settings.horario !== null
    ? settings.horario
    : {}) as Record<string, unknown>

  // Inválido já foi recusado antes de chegar aqui; o que sobra é "não informado",
  // e aí quem responde é a fase anterior.
  const toques = inteiro(settings.numToques, 1, MAX_TOQUES)

  // Lista vazia também já foi recusada: só array COM dia entra.
  const dias = Array.isArray(settings.diasAtivos) && settings.diasAtivos.length > 0
    ? settings.diasAtivos.join(',')
    : undefined

  por('remetente',      textoCheio(settings.remetente)      ?? textoCheio(prev?.remetente))
  por('limite_diario',  inteiro(settings.limiteDiario, 0)   ?? semNulo(prev?.limite_diario))
  por('delay_dias',     inteiro(settings.intervaloDias, 0)  ?? semNulo(prev?.delay_dias))
  por('fase_final',     toques !== undefined ? `Template ${toques}` : semNulo(prev?.fase_final))
  por('horario_inicio', textoCheio(horario.inicio)          ?? textoCheio(prev?.horario_inicio))
  por('horario_fim',    textoCheio(horario.fim)             ?? textoCheio(prev?.horario_fim))
  por('dias_ativos',    dias                                ?? semNulo(prev?.dias_ativos))
  por('tom',            textoInformado(settings.tom)        ?? semNulo(prev?.tom))
  por('objetivo',       textoInformado(settings.objetivo)   ?? semNulo(prev?.objetivo))
  // Trava 2: status que não mudou não encosta no interruptor. Ver A REGRA DO NÃO
  // GRAVAR — é isto que impede a tela de Credenciais de pausar a campanha.
  por('ativo',          statusMudou(save) ? save.status === 'active' : semNulo(prev?.ativo))

  return config
}

// ─── INSERT ───────────────────────────────────────────────────────────────────

/**
 * Monta o INSERT só com as colunas que têm valor. Nenhum VALOR entra no texto: os
 * nomes de coluna saem de `COLUNAS` (literais deste arquivo) e o resto são
 * placeholders `$n`.
 *
 * Sem coluna nenhuma sobra `DEFAULT VALUES`, que é a linha inteira de defaults do
 * banco. Continua sendo uma linha nova, então o fluxo de disparo continua achando
 * o que ler. O caso existe: base do cliente vazia, status igual ao anterior e um
 * save cuja única mudança é um valor que o mapa não aproveita (um `remetente`
 * apagado, por exemplo) — passa pela trava 1 e não produz coluna nenhuma.
 */
function insertDe(config: ConfigCampanha): { texto: string; valores: unknown[] } {
  const colunas = COLUNAS.filter(c => config[c] !== undefined)
  if (colunas.length === 0) {
    return { texto: 'INSERT INTO campaign_config DEFAULT VALUES', valores: [] }
  }

  const placeholders = colunas.map((_, i) => `$${i + 1}`).join(', ')
  return {
    texto:   `INSERT INTO campaign_config (${colunas.join(', ')}) VALUES (${placeholders})`,
    valores: colunas.map(c => config[c]),
  }
}

/**
 * Lê a configuração vigente do cliente, funde com o que veio da tela e grava uma
 * linha nova em `campaign_config` — quando há o que gravar.
 *
 * Duas consultas, e não uma: para deixar uma coluna FORA do INSERT é preciso saber
 * antes se a linha anterior tinha valor para ela, e não existe forma de dizer
 * "use o DEFAULT da coluna" dentro de um `INSERT ... SELECT`. Um COALESCE com
 * literal resolveria em uma consulta só — ao custo de trazer de volta para o
 * código exatamente os literais que A REGRA DO OMITIR tira daqui.
 *
 * CONCORRÊNCIA — o que está garantido e o que não está
 * Sem transação, de propósito: `SdrPool` não expõe `connect()` (ver o cabeçalho de
 * pg.ts). A trava otimista de `version` da rota serializa a maioria dos saves, mas
 * não todos: se o segundo pedido lê o `version` DEPOIS de o primeiro ter gravado a
 * linha da app e ANTES de o primeiro inserir em `campaign_config`, os dois partem
 * da mesma linha anterior e nenhum dos dois leva 409. Aí a ordem dos INSERTs é a
 * ordem em que as duas conexões chegarem ao banco do cliente — e o último
 * `updated_at`, que é o que o fluxo de disparo lê, pode ser o da configuração MAIS
 * VELHA. O resultado é o fluxo de disparo rodando com uma configuração diferente
 * da que a tela mostra, e assim ficando até o save seguinte. Não é "o último
 * vence": é uma corrida que esta camada não resolve. Fechar isso exige a
 * transação que `SdrPool` não oferece, ou o INSERT junto do UPDATE da app — e os
 * dois bancos são diferentes.
 *
 * Erro de banco nenhum é engolido: sai como `SdrDbError` pelo `withSdrDb`. Settings
 * impossíveis saem antes, como `ConfigCampanhaInvalida`, sem abrir conexão.
 */
export async function gravarConfigCampanha(
  connectionString: string,
  save: SaveDeCampanha,
): Promise<ResultadoGravacao> {
  // Trava 1: replay da tela de Credenciais (ou qualquer save que não mexeu na
  // campanha) não vira linha nova. Nem conexão com a base do cliente.
  //
  // Vem ANTES da recusa de propósito: save que não escreve nada não tem por que
  // reclamar de um valor guardado por outra tela, em outro dia. A rota já recusa o
  // que chega inválido no corpo do pedido, com 400; aqui a pergunta é só se o que
  // está para ser ESCRITO presta.
  if (!mudouAlgoDeCampanha(save)) return { gravado: false, motivo: 'sem_mudanca' }

  const invalida = validarConfigCampanha(save.settings)
  if (invalida) throw invalida

  return withSdrDb(connectionString, async sdr => {
    const { rows } = await sdr.query<LinhaConfig>(SQL_ANTERIOR)
    const config = mapear(rows[0], save)

    const { texto, valores } = insertDe(config)
    await sdr.query(texto, valores)

    return { gravado: true, config }
  })
}
