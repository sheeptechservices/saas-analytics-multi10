// Testes da leitura da fonte de dados do tenant (lib/sdr/conexao-tenant).
//
// O que está sob teste é a DECISÃO — qual dos três estados sai de um `config_enc`
// guardado —, que é o que três rotas usam para escolher entre 400 e 500. Por isso a
// decisão mora em `lerFonteCifrada`, sem banco: `conexaoDoTenant` é o mesmo código
// com um SELECT na frente.
//
// A pergunta que dois destes testes fazem é de segurança, não de lógica: o valor que
// volta (e o que vai para o log) não pode carregar a senha decifrada nem o texto do
// erro de decifragem.
//
// Nenhum teste aqui abre conexão com banco nenhum.

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { encrypt } from '@/lib/crypto'
import { lerFonteCifrada } from '@/lib/sdr/conexao-tenant'

// Chaves descartáveis só para os testes — nunca a do .env.local.
const CHAVE       = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const CHAVE_NOVA  = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100'
const original    = process.env.ENCRYPTION_SECRET

const TENANT = 'tenant-de-teste'
const SENHA  = 'S3nh4-do-cliente'
// Usuário próprio de propósito: `getSdrPool` guarda os pools num mapa da módulo
// indexado pelo hash da string de conexão, então dois arquivos de teste com a
// MESMA string compartilhariam o pool — e o banco — de quem rodasse primeiro.
// Hoje `node --test` dá um processo a cada arquivo e isso não acontece, mas basta
// alguém juntar as suítes num processo só para virar um bug difícil de enxergar.
const CONN   = `postgresql://postgres.conexaotenant:${SENHA}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`

// O log é parte do contrato do estado `ilegivel`: sem ele uma rotação de chave é
// invisível. Guardamos as linhas para conferir o que vai — e o que não vai — nelas.
const logs: string[] = []
const errorOriginal = console.error

before(() => {
  process.env.ENCRYPTION_SECRET = CHAVE
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
})

after(() => {
  console.error = errorOriginal
  if (original === undefined) delete process.env.ENCRYPTION_SECRET
  else process.env.ENCRYPTION_SECRET = original
})

beforeEach(() => {
  process.env.ENCRYPTION_SECRET = CHAVE
  logs.length = 0
})

// ─── Não configurada ──────────────────────────────────────────────────────────

test('tenant sem linha de fonte: nao_configurada', () => {
  assert.deepEqual(lerFonteCifrada(undefined, TENANT), { estado: 'nao_configurada' })
  assert.deepEqual(lerFonteCifrada(null, TENANT), { estado: 'nao_configurada' })
  assert.deepEqual(lerFonteCifrada('', TENANT), { estado: 'nao_configurada' })
  assert.equal(logs.length, 0, 'fonte que não existe não é incidente — nada a logar')
})

test('tenant sem fonte não precisa da chave de cifra', () => {
  // Rota de tenant não configurado não pode morrer por causa de ENCRYPTION_SECRET:
  // não há nada para decifrar.
  delete process.env.ENCRYPTION_SECRET
  assert.deepEqual(lerFonteCifrada(undefined, TENANT), { estado: 'nao_configurada' })
})

test('fonte cadastrada sem connectionString: nao_configurada, não ilegível', () => {
  // Decifrou e leu: o cadastro é que está pela metade. Mandar "salve a credencial de
  // novo" aqui seria conselho errado — falta preencher, não falta ler.
  const semConn = lerFonteCifrada(encrypt(JSON.stringify({ label: 'Supabase 300' })), TENANT)
  assert.deepEqual(semConn, { estado: 'nao_configurada' })

  // String vazia e tipo errado contam como ausente.
  assert.deepEqual(lerFonteCifrada(encrypt(JSON.stringify({ connectionString: '' })), TENANT), { estado: 'nao_configurada' })
  assert.deepEqual(lerFonteCifrada(encrypt(JSON.stringify({ connectionString: 42 })), TENANT), { estado: 'nao_configurada' })
  assert.equal(logs.length, 0)
})

// ─── Ilegível ─────────────────────────────────────────────────────────────────

test('chave de cifra trocada: ilegivel, e NÃO nao_configurada', () => {
  const guardado = encrypt(JSON.stringify({ connectionString: CONN }))

  // Rotação de ENCRYPTION_SECRET: o valor guardado continua lá e deixa de abrir.
  process.env.ENCRYPTION_SECRET = CHAVE_NOVA
  const fonte = lerFonteCifrada(guardado, TENANT)

  assert.deepEqual(fonte, { estado: 'ilegivel' })
  // O ponto da correção: os dois casos de recusa são distinguíveis por quem chama.
  assert.notEqual(fonte.estado, 'nao_configurada')
})

test('conteúdo decifrado que não é JSON: ilegivel', () => {
  const fonte = lerFonteCifrada(encrypt(CONN), TENANT)
  assert.deepEqual(fonte, { estado: 'ilegivel' })
})

test('a credencial ilegível é registrada UMA vez, com o tenant e sem o segredo', () => {
  // Texto decifrado que não é JSON: o `SyntaxError` do JSON.parse cita um trecho do
  // conteúdo — que aqui é a própria string de conexão. É o pior caso para o log.
  lerFonteCifrada(encrypt(CONN), TENANT)

  assert.equal(logs.length, 1, 'uma linha por leitura, não uma por call site')
  const linha = logs[0]
  assert.ok(linha.includes(TENANT), 'sem o tenant o operador não sabe de quem é')
  assert.ok(/ileg[íi]vel/i.test(linha), 'a linha tem de dizer que a credencial não abriu')
  assert.ok(!linha.includes(SENHA), 'senha do cliente não pode ir para o log')
  assert.ok(!linha.includes(CONN), 'string de conexão não pode ir para o log')
  assert.ok(!/unable to authenticate|unexpected token|JSON/i.test(linha), 'texto do erro não vai para o log')
})

test('o que volta no caso ilegível não carrega segredo nem texto de erro', () => {
  // Isto é o que a rota transforma em resposta HTTP: se um pedaço do valor decifrado
  // ou da mensagem do driver estivesse aqui, ele sairia pela API.
  const daCifra = (() => {
    const guardado = encrypt(JSON.stringify({ connectionString: CONN }))
    process.env.ENCRYPTION_SECRET = CHAVE_NOVA
    return lerFonteCifrada(guardado, TENANT)
  })()
  const doJson = lerFonteCifrada(encrypt(CONN), TENANT)

  for (const fonte of [daCifra, doJson]) {
    // O objeto inteiro tem uma chave só: não há onde um detalhe se esconder.
    assert.deepEqual(Object.keys(fonte), ['estado'])
    const serializado = JSON.stringify(fonte)
    assert.ok(!serializado.includes(SENHA))
    assert.ok(!serializado.includes(CONN))
    assert.ok(!/unable to authenticate|unexpected token|postgres/i.test(serializado))
  }
})

// ─── Caminho feliz ────────────────────────────────────────────────────────────

test('fonte cadastrada e legível devolve a connectionString', () => {
  const fonte = lerFonteCifrada(encrypt(JSON.stringify({ connectionString: CONN })), TENANT)

  assert.equal(fonte.estado, 'ok')
  // A `connectionString` só existe no ramo `ok` — é o estreitamento que o compilador
  // cobra de todo call site.
  assert.equal(fonte.estado === 'ok' ? fonte.connectionString : null, CONN)
  assert.equal(logs.length, 0)
})

test('valor legado em texto puro (não cifrado) continua sendo lido', () => {
  // `decrypt` devolve a entrada intacta quando ela não tem os três campos do formato
  // cifrado. Linha antiga de data_sources não pode virar "ilegível" da noite para o dia.
  const fonte = lerFonteCifrada(JSON.stringify({ connectionString: CONN }), TENANT)
  assert.deepEqual(fonte, { estado: 'ok', connectionString: CONN })
})
