// Testes da gravação da configuração de campanha (lib/sdr/config-write).
//
// Postgres de verdade, dentro do processo: o PGlite de test-support/pglite entra no
// lugar do pool do `pg` pela fábrica que lib/sdr/pg expõe para teste
// (`setSdrPoolFactory`). Ou seja, o SQL testado é o SQL que o módulo manda — nada
// de imitação de driver — e quem preenche as colunas ausentes é um Postgres de
// verdade, aplicando os DEFAULT de verdade. É exatamente a pergunta que importa
// aqui: "o que fica gravado quando o nosso código NÃO escreve a coluna?".
//
// A tabela é criada à mão porque `campaign_config` mora na base do CLIENTE, não no
// schema da app: o DDL abaixo é o da tabela conferida em produção.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import { bancoDeTeste } from '@/test-support/pglite'
import { closeAllSdrPools, setSdrPoolFactory, type SdrPool } from '@/lib/sdr/pg'
import {
  COLUNAS,
  ConfigCampanhaInvalida,
  gravarConfigCampanha,
  type CodigoConfigInvalida,
  type ConfigCampanha,
} from '@/lib/sdr/config-write'

// DDL conferido contra a base do cliente, coluna por coluna, inclusive os DEFAULT —
// é deles que os testes de omissão dependem.
//
// Uma única diferença: lá o DEFAULT de `remetente` é o telefone daquele cliente, e
// copiá-lo para cá seria trazer de volta para o repositório o número que este
// módulo existe para tirar dele. Nenhum teste depende do VALOR desse default —
// só de ele existir e de ser o banco, e não a app, quem o aplica.
const DDL = `CREATE TABLE campaign_config (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  remetente      text        NOT NULL DEFAULT '+550000000000',
  limite_diario  integer     NOT NULL DEFAULT 100,
  delay_dias     integer     NOT NULL DEFAULT 3,
  fase_final     text        NOT NULL DEFAULT 'Template 10',
  horario_inicio text        DEFAULT '09:00',
  horario_fim    text        DEFAULT '18:00',
  dias_ativos    text        DEFAULT '1,2,3,4,5',
  tom            text,
  objetivo       text,
  ativo          boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
)`

type Linha = {
  remetente:      string
  limite_diario:  number
  delay_dias:     number
  fase_final:     string
  horario_inicio: string | null
  horario_fim:    string | null
  dias_ativos:    string | null
  tom:            string | null
  objetivo:       string | null
  ativo:          boolean
}

let banco: Awaited<ReturnType<typeof bancoDeTeste>>
let pg: PGlite

/* A string de conexão muda a cada teste, e o cache de pools é esvaziado antes de
 * cada um. Motivo: `getSdrPool` guarda um pool por CREDENCIAL num mapa de módulo
 * (lib/sdr/pg), então duas suítes que usem a mesma string dividiriam o mesmo pool
 * — e, com a fábrica falsa, o mesmo PGlite. Hoje o `node --test` roda cada arquivo
 * num processo próprio (conferido: dois arquivos, dois PIDs, estado de módulo não
 * compartilhado), mas isso é detalhe do executor, não garantia deste teste. Com
 * credencial por teste, a independência é do teste. */
let CONN = ''
let nConexao = 0

/** Tudo que o módulo mandou ao banco, na ordem. */
const consultas: Array<{ texto: string; valores: unknown[] }> = []

before(async () => {
  banco = await bancoDeTeste({ comSchema: false })
  pg = banco.pg

  setSdrPoolFactory((): SdrPool => ({
    async query<R extends QueryResultRow = QueryResultRow>(
      texto: string,
      valores?: unknown[],
    ): Promise<QueryResult<R>> {
      consultas.push({ texto, valores: valores ?? [] })
      const rs = await pg.query<R>(texto, valores as unknown[])
      return { rows: rs.rows, rowCount: rs.rows.length, command: '', oid: 0, fields: [] }
    },
    async end() {},
    on() { return undefined },
  }))
})

beforeEach(async () => {
  await closeAllSdrPools()
  CONN = `postgresql://usuario:senha@t${++nConexao}.exemplo.supabase.co:5432/postgres`
  await pg.exec('DROP TABLE IF EXISTS campaign_config')
  await pg.exec(DDL)
  consultas.length = 0
})

after(async () => {
  await closeAllSdrPools()
  setSdrPoolFactory(null)
  await banco.fechar()
})

// ─── Auxiliares ───────────────────────────────────────────────────────────────

/** O que estava guardado ANTES do save — é o que as duas travas do módulo leem.
 *  O padrão (`null`/`null`) é o primeiro save de um tenant. */
type Antes = {
  anteriores?:     Record<string, unknown> | null
  statusAnterior?: string | null
}

/**
 * Um save. Antes de cada gravação as linhas existentes recuam um segundo: o
 * `now()` do PGlite anda de milissegundo em milissegundo e dois saves seguidos
 * poderiam empatar em `updated_at`, que é justamente a coluna por onde o módulo
 * (e o fluxo de disparo) escolhe a linha vigente. O recuo tira o empate da
 * jogada sem mexer em nada do que está sendo testado.
 */
async function gravar(settings: Record<string, unknown>, status: string, antes: Antes = {}) {
  await pg.exec("UPDATE campaign_config SET updated_at = updated_at - interval '1 second'")
  return gravarConfigCampanha(CONN, {
    settings,
    anteriores:     antes.anteriores     ?? null,
    statusAnterior: antes.statusAnterior ?? null,
    status,
  })
}

/** Um save que TEM de gravar uma linha; devolve as colunas que o módulo montou. */
async function gravarLinha(
  settings: Record<string, unknown>,
  status: string,
  antes: Antes = {},
): Promise<ConfigCampanha> {
  const r = await gravar(settings, status, antes)
  assert.ok(r.gravado, 'esperava que este save gravasse uma linha')
  return r.config
}

/** Um save que TEM de ser recusado; devolve o código da recusa. */
async function recusa(
  settings: Record<string, unknown>,
  status = 'active',
): Promise<CodigoConfigInvalida> {
  const erro: unknown = await gravar(settings, status).then(() => null, (e: unknown) => e)
  assert.ok(
    erro instanceof ConfigCampanhaInvalida,
    `esperava recusa de ${JSON.stringify(settings)}, veio ${String(erro)}`,
  )
  assert.equal(consultas.length, 0, 'a recusa não pode nem ter chegado ao banco')
  return erro.code
}

/** A linha que o fluxo de disparo leria agora — mesmo SELECT dele. */
async function vigente(): Promise<Linha> {
  const rs = await pg.query<Linha>(
    'SELECT * FROM campaign_config ORDER BY updated_at DESC LIMIT 1',
  )
  assert.ok(rs.rows[0], 'esperava ao menos uma linha em campaign_config')
  return rs.rows[0]
}

async function totalDeLinhas(): Promise<number> {
  const rs = await pg.query<{ n: number | string }>('SELECT count(*) AS n FROM campaign_config')
  return Number(rs.rows[0].n)
}

/** O último INSERT que o módulo montou. */
function ultimoInsert(): { texto: string; valores: unknown[] } {
  const insert = [...consultas].reverse().find(c => c.texto.startsWith('INSERT'))
  assert.ok(insert, 'esperava um INSERT')
  return insert
}

/** Os nomes de coluna que o último INSERT levou ao texto do SQL. */
function colunasDoInsert(): string[] {
  const lista = ultimoInsert().texto.match(/^INSERT INTO campaign_config \(([^)]*)\)/)
  return lista ? lista[1].split(', ') : []
}

// ─── Primeira gravação ────────────────────────────────────────────────────────

test('tabela vazia: o que veio da tela entra, o resto é DEFAULT do banco', async () => {
  const config = await gravarLinha(
    { remetente: '+5511999990000', limiteDiario: 40, tom: 'consultivo' },
    'active',
  )

  assert.equal(config.remetente, '+5511999990000')

  const linha = await vigente()
  assert.equal(linha.remetente, '+5511999990000')
  assert.equal(linha.limite_diario, 40)
  assert.equal(linha.tom, 'consultivo')
  assert.equal(linha.ativo, true)
  // Ninguém mandou: quem respondeu foi a coluna.
  assert.equal(linha.delay_dias, 3)
  assert.equal(linha.fase_final, 'Template 10')
  assert.equal(linha.horario_inicio, '09:00')
  assert.equal(linha.horario_fim, '18:00')
  assert.equal(linha.dias_ativos, '1,2,3,4,5')
  assert.equal(linha.objetivo, null)
})

test('as colunas sem valor ficam FORA do INSERT — não vão como NULL nem como literal', async () => {
  await gravar({ limiteDiario: 40 }, 'draft')

  const { texto } = ultimoInsert()
  assert.ok(texto.includes('limite_diario'), 'a coluna com valor tem de entrar')
  assert.ok(!texto.includes('fase_final'), 'coluna sem valor não entra no INSERT')
  assert.ok(!texto.includes('horario_inicio'), 'coluna sem valor não entra no INSERT')
  assert.ok(!texto.includes('dias_ativos'), 'coluna sem valor não entra no INSERT')
})

test('nenhum valor é interpolado no texto do SQL: só placeholders', async () => {
  await gravar({ remetente: "+5511999990000'); DROP TABLE campaign_config; --" }, 'active')

  const { texto, valores } = ultimoInsert()
  assert.match(texto, /VALUES \(\$1(, \$\d+)*\)$/)
  assert.ok(!texto.includes('DROP TABLE'))
  assert.ok(valores.includes("+5511999990000'); DROP TABLE campaign_config; --"))
  assert.equal(await totalDeLinhas(), 1, 'a tabela continua de pé')
})

test('nome de coluna só sai de COLUNAS: chave hostil nas settings não vira coluna', async () => {
  // O outro teste de injeção usa um VALOR hostil, que os placeholders resolvem.
  // Este usa uma CHAVE hostil — o caminho que placeholder nenhum protege, porque
  // nome de coluna não tem como ser parametrizado.
  await gravar({
    'limite_diario = 0, ativo':            false,
    "x'); DROP TABLE campaign_config; --": 'lixo',
    limiteDiario:                          7,
  }, 'active')

  const colunas = colunasDoInsert()
  assert.ok(colunas.length > 0, 'esperava colunas no INSERT')
  for (const coluna of colunas) {
    assert.ok(
      (COLUNAS as readonly string[]).includes(coluna),
      `coluna fora da lista fixa chegou ao SQL: ${coluna}`,
    )
  }
  assert.ok(!ultimoInsert().texto.includes('DROP TABLE'))
  assert.equal(await totalDeLinhas(), 1, 'a tabela continua de pé')
  assert.equal((await vigente()).limite_diario, 7)
})

// ─── Merge com a linha anterior ───────────────────────────────────────────────

test('save que omite um campo mantém o valor da linha anterior', async () => {
  await gravar(
    { remetente: '+5511999990000', limiteDiario: 40, objetivo: 'agendar reunião' },
    'active',
  )
  await gravar({ limiteDiario: 55 }, 'active')

  const linha = await vigente()
  assert.equal(linha.limite_diario, 55, 'o valor novo entra')
  assert.equal(linha.remetente, '+5511999990000', 'o omitido vem da linha anterior')
  assert.equal(linha.objetivo, 'agendar reunião')
})

test('cada save acrescenta uma linha — o fluxo de disparo lê a mais nova', async () => {
  await gravar({ limiteDiario: 10 }, 'draft')
  await gravar({ limiteDiario: 20 }, 'draft')
  await gravar({ limiteDiario: 30 }, 'draft')

  assert.equal(await totalDeLinhas(), 3)
  assert.equal((await vigente()).limite_diario, 30)
})

// ─── A trava 1: save que não mudou nada de campanha não grava ─────────────────

test('replay das settings guardadas não gera linha nova — e não encosta no interruptor', async () => {
  // O caso da tela de Credenciais: ela devolve as settings guardadas tal e qual,
  // junto com o status que o GET entregou. Nada de campanha mudou.
  const guardadas = {
    remetente: '+5511999990000', limiteDiario: 40, intervaloDias: 3, numToques: 10,
    horario: { inicio: '08:00', fim: '18:00' }, diasAtivos: [1, 2, 3, 4, 5],
    tom: 'consultivo', objetivo: 'agendar reunião',
  }
  await pg.exec("INSERT INTO campaign_config (remetente, limite_diario, ativo) VALUES ('+5511999990000', 40, true)")

  const r = await gravar(
    // A URL do webhook mudou; a campanha, não.
    { ...guardadas, n8nWebhookUrl: 'https://n8n.exemplo.com/webhook/novo' },
    'draft',
    { anteriores: guardadas, statusAnterior: 'draft' },
  )

  assert.equal(r.gravado, false)
  assert.equal(await totalDeLinhas(), 1, 'nenhuma linha nova')
  assert.equal((await vigente()).ativo, true, 'a campanha continua ligada')
  assert.equal(consultas.length, 0, 'sem mudança, o módulo nem vai ao banco do cliente')
})

test('a ordem das chaves de `horario` não é mudança de configuração', async () => {
  const antes = { horario: { inicio: '08:00', fim: '18:00' }, diasAtivos: [1, 2] }
  const agora = { horario: { fim: '18:00', inicio: '08:00' }, diasAtivos: [1, 2] }

  const r = await gravar(agora, 'active', { anteriores: antes, statusAnterior: 'active' })
  assert.equal(r.gravado, false)
})

test('mudou um valor de campanha: grava, mesmo com o status igual', async () => {
  const antes = { limiteDiario: 40 }
  await gravarLinha({ limiteDiario: 55 }, 'active', { anteriores: antes, statusAnterior: 'active' })

  assert.equal((await vigente()).limite_diario, 55)
})

// ─── A trava 2: `ativo` só muda quando o status muda ──────────────────────────

test('status repetido não desliga campanha ligada, mesmo sem settings guardadas', async () => {
  // Tenant sem linha de `campaign_settings`: o GET entrega 'draft' a todas as
  // telas, e era esse 'draft' inventado que chegava aqui como `ativo = false`.
  // Sem `anteriores` a trava 1 não segura nada — quem segura é esta.
  await pg.exec('ALTER TABLE campaign_config ALTER COLUMN ativo SET DEFAULT false')
  await pg.exec("INSERT INTO campaign_config (remetente, ativo) VALUES ('+5511999990000', true)")

  await gravarLinha({ remetente: '+5511999990000', limiteDiario: 40 }, 'draft')

  const linha = await vigente()
  assert.equal(linha.ativo, true, 'o interruptor do cliente é que vale')
  assert.equal(linha.limite_diario, 40, 'o resto do save entrou normalmente')
  // Veio da linha anterior, e não do DEFAULT da coluna (que aqui é `false`).
  assert.ok(ultimoInsert().valores.includes(true))
})

test('pausar de verdade continua desligando a campanha', async () => {
  await pg.exec("INSERT INTO campaign_config (remetente, ativo) VALUES ('+5511999990000', true)")

  await gravarLinha({ limiteDiario: 40 }, 'paused', { statusAnterior: 'active' })
  assert.equal((await vigente()).ativo, false)
})

test('ativar de verdade continua ligando a campanha', async () => {
  await pg.exec('ALTER TABLE campaign_config ALTER COLUMN ativo SET DEFAULT false')
  await pg.exec("INSERT INTO campaign_config (remetente, ativo) VALUES ('+5511999990000', false)")

  await gravarLinha({ limiteDiario: 40 }, 'active', { statusAnterior: 'draft' })
  assert.equal((await vigente()).ativo, true)
})

test('primeiro save de um tenant com status "active" liga a campanha', async () => {
  await gravarLinha({ limiteDiario: 40 }, 'active')
  assert.equal((await vigente()).ativo, true)
})

test('status: só "active" liga; "draft" e "paused" desligam quando são mudança', async () => {
  await gravarLinha({ limiteDiario: 10 }, 'active', { statusAnterior: 'draft' })
  assert.equal((await vigente()).ativo, true)

  await gravarLinha({ limiteDiario: 10 }, 'paused', { statusAnterior: 'active' })
  assert.equal((await vigente()).ativo, false)

  await gravarLinha({ limiteDiario: 10 }, 'draft', { statusAnterior: 'active' })
  assert.equal((await vigente()).ativo, false)
})

// ─── Campo a campo ────────────────────────────────────────────────────────────

test('diasAtivos: array vira lista separada por vírgula; ausente mantém a anterior', async () => {
  await gravar({ diasAtivos: [1, 2, 3, 4, 5, 6] }, 'active')
  assert.equal((await vigente()).dias_ativos, '1,2,3,4,5,6')

  await gravar({ limiteDiario: 12 }, 'active')
  assert.equal((await vigente()).dias_ativos, '1,2,3,4,5,6', 'o save seguinte não apaga os dias')
})

test('diasAtivos vazio é recusado — nunca vira string vazia na coluna', async () => {
  // `[].join(',')` é `''`, e gravar `''` seria inventar um significado para uma
  // coluna cujo vazio ninguém definiu. Campanha sem dia nenhum se desliga pelo
  // status, que é o interruptor de verdade.
  assert.equal(await recusa({ diasAtivos: [] }), 'dias_ativos_vazio')
  assert.equal(await totalDeLinhas(), 0)
})

test('numToques vira a fase final do template', async () => {
  await gravar({ numToques: 7 }, 'active')
  assert.equal((await vigente()).fase_final, 'Template 7')
})

test('numToques que não nomeia fase nenhuma é recusado', async () => {
  // `fase_final` é o nome que o fluxo de disparo procura. `parseInt` salvava o
  // número da frente e escrevia 'Template 7' para '7abc' e 'Template 3' para 3.9;
  // 0 e -3 passavam inteiros. Fase que não existe é disparo que nunca casa.
  for (const valor of ['abc', '7abc', 3.9, 0, -3, 21, true, [], {}]) {
    assert.equal(await recusa({ numToques: valor }), 'num_toques_invalido', `numToques: ${String(valor)}`)
  }
  assert.equal(await totalDeLinhas(), 0)
})

test('numToques ausente ou vazio mantém a fase anterior', async () => {
  await gravar({ numToques: 7 }, 'active')
  await gravar({ numToques: '' }, 'active')
  assert.equal((await vigente()).fase_final, 'Template 7')

  await gravar({ limiteDiario: 3 }, 'active')
  assert.equal((await vigente()).fase_final, 'Template 7')
})

test('horário: vazio não apaga o que estava gravado', async () => {
  await gravar({ horario: { inicio: '07:30', fim: '19:00' } }, 'active')
  let linha = await vigente()
  assert.equal(linha.horario_inicio, '07:30')
  assert.equal(linha.horario_fim, '19:00')

  await gravar({ horario: { inicio: '', fim: '' } }, 'active')
  linha = await vigente()
  assert.equal(linha.horario_inicio, '07:30')
  assert.equal(linha.horario_fim, '19:00')
})

test('tom e objetivo que não são texto caem no valor anterior', async () => {
  // Desvio documentado no cabeçalho do módulo: o n8n escreveria o valor
  // convertido em texto; aqui não se inventa conteúdo para a coluna.
  await gravar({ tom: 'consultivo', objetivo: 'agendar reunião' }, 'active')
  await gravar({ tom: 42, objetivo: ['x'] }, 'active')

  const linha = await vigente()
  assert.equal(linha.tom, 'consultivo')
  assert.equal(linha.objetivo, 'agendar reunião')
})

// ─── Números que não são números ──────────────────────────────────────────────

test('limiteDiario vazio cai no valor anterior, não em lixo', async () => {
  await gravar({ limiteDiario: 40, intervaloDias: 5 }, 'active')

  await gravar({ limiteDiario: '' }, 'active')
  const linha = await vigente()
  assert.equal(linha.limite_diario, 40, 'string vazia não zera o limite')
  assert.equal(linha.delay_dias, 5, 'intervaloDias omitido também se mantém')
})

test('limiteDiario que não é inteiro não-negativo é recusado, nunca vira 0', async () => {
  // Cada um destes virava `0` pelo `Number()` — campanha que não dispara nada com
  // a tela verde — ou chegava ao Postgres para ele recusar o INSERT inteiro.
  for (const valor of [' ', [], false, 'muitos', 3.7, -1, 5e9, 1e21, '3.7', '-1']) {
    assert.equal(
      await recusa({ limiteDiario: valor }),
      'limite_diario_invalido',
      `limiteDiario: ${JSON.stringify(valor)}`,
    )
  }
  assert.equal(await totalDeLinhas(), 0, 'nada foi gravado')
})

test('intervaloDias segue a mesma régua do limiteDiario', async () => {
  for (const valor of [' ', [], false, 3.7, -1, 5e9, 1e21]) {
    assert.equal(
      await recusa({ intervaloDias: valor }),
      'intervalo_dias_invalido',
      `intervaloDias: ${JSON.stringify(valor)}`,
    )
  }
})

test('0 explícito é aceito — é escolha, não coerção de lixo', async () => {
  await gravarLinha({ limiteDiario: 0, intervaloDias: 0 }, 'active')

  const linha = await vigente()
  assert.equal(linha.limite_diario, 0)
  assert.equal(linha.delay_dias, 0)
})

test('número guardado como string de dígitos continua valendo', async () => {
  // Settings escritas por versões antigas podem trazer '40'; recusá-las quebraria
  // um save que nunca teve nada de errado.
  await gravarLinha({ limiteDiario: '40' }, 'active')
  assert.equal((await vigente()).limite_diario, 40)
})

test('limiteDiario vazio com a tabela vazia: sobra o DEFAULT da coluna', async () => {
  await gravar({ limiteDiario: '', tom: 'consultivo' }, 'active')

  assert.equal((await vigente()).limite_diario, 100)
  assert.ok(!ultimoInsert().texto.includes('limite_diario'))
})

// ─── Remetente: o telefone de um cliente não é padrão de ninguém ──────────────

test('sem remetente em lugar nenhum, quem responde é o DEFAULT da coluna', async () => {
  // O DEFAULT passa a ser um valor sentinela: se a linha sair com ele, o número
  // veio do banco do cliente — não de um literal escrito por nós.
  await pg.exec("ALTER TABLE campaign_config ALTER COLUMN remetente SET DEFAULT '+551234567890'")

  const config = await gravarLinha({ limiteDiario: 20 }, 'active')

  assert.equal((await vigente()).remetente, '+551234567890')
  assert.equal(config.remetente, undefined, 'a app não inventou remetente nenhum')
  assert.ok(!ultimoInsert().texto.includes('remetente'), 'a coluna não entra no INSERT')
})

test('sem nada aproveitável, o INSERT é DEFAULT VALUES — a app não inventa coluna alguma', async () => {
  /* Vale por dois. Primeiro, é a prova de que nenhuma coluna tem literal de
   * reserva escondido no módulo: apagar o remetente é mudança de verdade (passa
   * pela trava 1), mas `''` não é valor para a coluna e não há linha anterior de
   * onde tirar um — e o que sai é uma linha inteira de DEFAULT do banco, não um
   * valor nosso. (O teste que isto substitui varria o código atrás de um telefone
   * literal: lia um arquivo só, escapava por concatenação e nunca tinha reprovado
   * — proteção que não reprova é pior do que nenhuma, porque parece proteção.)
   * Segundo, é o único caminho que chega ao ramo `DEFAULT VALUES`. */
  const config = await gravarLinha({ remetente: '' }, 'draft', {
    anteriores:     { remetente: '+5511999990000' },
    statusAnterior: 'draft',
  })

  assert.deepEqual(config, {}, 'nenhuma coluna montada')
  assert.equal(ultimoInsert().texto, 'INSERT INTO campaign_config DEFAULT VALUES')
  assert.equal(await totalDeLinhas(), 1, 'ainda assim entra uma linha: o fluxo de disparo precisa achar o que ler')

  const linha = await vigente()
  assert.equal(linha.remetente, '+550000000000', 'o DEFAULT do banco do cliente')
  assert.equal(linha.fase_final, 'Template 10')
  assert.equal(linha.ativo, true)
})
