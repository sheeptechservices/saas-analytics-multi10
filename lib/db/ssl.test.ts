import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from 'pg'
import { opcoesDeSsl } from '@/lib/db'

/* TLS é decisão de segurança, e decisão de segurança sem teste é palpite.
 *
 * Nada aqui abre conexão. `opcoesDeSsl` é função pura sobre a URL e o ambiente; e
 * `new Client(...)` do `pg` só monta os parâmetros — não toca a rede até
 * `connect()`. Isso permite a coisa mais importante deste arquivo: conferir o TLS
 * RESOLVIDO, isto é, o que o driver de fato usaria depois de misturar o que
 * passamos, o `sslmode` da URL e a variável PGSSLMODE. Foi justamente nessa
 * mistura que o defeito da primeira passada morava. */

const INTERNA   = 'postgres://u:s@postgres.railway.internal:5432/railway'
const PUBLICA   = 'postgres://u:s@sao.proxy.rlwy.net:41234/railway'
// Segunda região da Railway: a regra tem de valer para todas, não só a testada.
const PUBLICA_US = 'postgres://u:s@us-east.proxy.rlwy.net:52000/railway'
// Host de terceiro sob o MESMO TLD do proxy: alargar `.rlwy.net` para `.net`
// entregaria a ele criptografia sem autenticação.
const VIZINHO   = 'postgres://u:s@db.exemplo.net:5432/app'
const TERCEIRO  = 'postgres://u:s@db.fornecedor-qualquer.com:5432/app'

const env = process.env
const salvos = { PGSSLMODE: env.PGSSLMODE, DATABASE_CA_CERT: env.DATABASE_CA_CERT }

beforeEach(() => {
  delete env.PGSSLMODE
  delete env.DATABASE_CA_CERT
})

after(() => {
  for (const [k, v] of Object.entries(salvos)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
})

/** O ssl que o `pg` REALMENTE usaria — depois de aplicar a URL e o ambiente. */
function sslResolvido(url: string): unknown {
  const cliente = new Client({ connectionString: url, ssl: opcoesDeSsl(url) })
  return (cliente as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl
}

// ─── Por host ────────────────────────────────────────────────────────────────

test('rede privada da Railway: sem TLS — o tráfego não sai do projeto', () => {
  assert.equal(opcoesDeSsl(INTERNA), false)
  assert.equal(opcoesDeSsl('postgres://u:s@meu-banco.railway.internal:5432/x'), false)
})

test('localhost também dispensa TLS', () => {
  assert.equal(opcoesDeSsl('postgres://u:s@localhost:5432/x'), false)
  assert.equal(opcoesDeSsl('postgres://u:s@127.0.0.1:5432/x'), false)
})

/* Duas regiões, porque a exceção é da Railway inteira — estreitar a regra para um
 * host exato quebraria toda região que não fosse a testada, com falha dura de TLS. */
test('proxy público da Railway: TLS ligado, sem verificar a cadeia — em QUALQUER região', () => {
  assert.deepEqual(opcoesDeSsl(PUBLICA),    { rejectUnauthorized: false })
  assert.deepEqual(opcoesDeSsl(PUBLICA_US), { rejectUnauthorized: false })
})

/* E alargar a regra para `.net` entregaria "criptografado mas não autenticado" a
 * qualquer host sob o mesmo TLD — que é um ataque de intermediário sem barreira. */
test('host de terceiro: TLS COM verificação — a folga é só do proxy da Railway', () => {
  assert.deepEqual(opcoesDeSsl(VIZINHO),  { rejectUnauthorized: true })
  assert.deepEqual(opcoesDeSsl(TERCEIRO), { rejectUnauthorized: true })
})

test('o sufixo tem de ser o domínio inteiro, não o fim do texto', () => {
  // Nenhum destes é a Railway, por mais que o texto termine parecido.
  assert.deepEqual(opcoesDeSsl('postgres://u:s@evil-rlwy.net:5432/x'),        { rejectUnauthorized: true })
  assert.deepEqual(opcoesDeSsl('postgres://u:s@rlwy.net.exemplo.com:5432/x'), { rejectUnauthorized: true })
  // E o domínio nu, sem subdomínio, também não é o proxy.
  assert.deepEqual(opcoesDeSsl('postgres://u:s@rlwy.net:5432/x'),             { rejectUnauthorized: true })
})

/* O irmão do teste acima, e o mais perigoso dos dois. O ramo da rede privada não
 * devolve "TLS sem verificar": devolve TLS NENHUM. Alargá-lo por acidente — um
 * `.internal` solto, um `includes('railway')` — mandaria senha de banco em texto
 * puro pela internet, que é pior do que qualquer folga de certificado. O ramo do
 * `.rlwy.net` já tinha armadilha de sufixo; este não tinha nenhuma. */
test('rede privada: o sufixo tem de ser o domínio inteiro, senão vira texto puro', () => {
  const semTls = ['postgres://u:s@postgres.railway.internal:5432/x',
                  'postgres://u:s@meu-banco.railway.internal:5432/x']
  for (const url of semTls) {
    assert.equal(opcoesDeSsl(url), false, `${url} é rede privada da Railway: sem TLS, por desenho`)
  }

  // Nenhum destes está na rede privada do projeto, por mais que o texto engane.
  const comTls = [
    'postgres://u:s@railway.internal:5432/x',            // domínio nu, sem subdomínio
    'postgres://u:s@evil-railway.internal:5432/x',       // sufixo no meio do rótulo
    'postgres://u:s@db.corp.internal:5432/x',            // outro `.internal` qualquer
    'postgres://u:s@railway.exemplo.com:5432/x',         // "railway" no texto, domínio alheio
    'postgres://u:s@railway.internal.exemplo.com:5432/x', // prefixo, não sufixo
  ]
  for (const url of comTls) {
    assert.deepEqual(opcoesDeSsl(url), { rejectUnauthorized: true },
      `${url} não é a rede privada — TLS com verificação, nunca texto puro`)
  }
})

test('DATABASE_CA_CERT devolve a verificação completa, inclusive no proxy', () => {
  env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'
  assert.deepEqual(opcoesDeSsl(PUBLICA), { ca: env.DATABASE_CA_CERT, rejectUnauthorized: true })
})

// ─── Delegação ao `pg` ───────────────────────────────────────────────────────

test('sslmode na URL manda: devolvemos undefined e o `pg` decide', () => {
  // O `pg` monta a config com Object.assign(config, parse(connectionString)),
  // então o sslmode da URL sobrescreveria o nosso de qualquer jeito.
  assert.equal(opcoesDeSsl(`${PUBLICA}?sslmode=no-verify`), undefined)
  assert.equal(opcoesDeSsl(`${PUBLICA}?foo=1&sslmode=disable`), undefined)
})

test('PGSSLMODE reconhecido também manda', () => {
  for (const modo of ['disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify']) {
    env.PGSSLMODE = modo
    assert.equal(opcoesDeSsl(PUBLICA), undefined, modo)
  }
})

/* O defeito: o `pg` compara PGSSLMODE por igualdade exata e minúscula; qualquer
 * outra coisa cai no `defaults.ssl`, que é `false`. Devolver `undefined` para um
 * valor não reconhecido entregaria a conexão em claro pela internet, calada. */
test('PGSSLMODE não reconhecido ESTOURA em vez de virar conexão em claro', () => {
  for (const ruim of ['Require', 'REQUIRE', 'allow', 'require ', ' no-verify', 'sim', 'verify']) {
    env.PGSSLMODE = ruim
    assert.throws(
      () => opcoesDeSsl(PUBLICA),
      (e: unknown) => {
        const msg = (e as Error).message
        assert.match(msg, /PGSSLMODE/)
        assert.match(msg, /SEM CRIPTOGRAFIA/)
        return true
      },
      `PGSSLMODE=${JSON.stringify(ruim)} tinha de ser recusado`,
    )
  }
})

test('PGSSLMODE vazio ou só espaço é ignorado, não é erro', () => {
  env.PGSSLMODE = ''
  assert.deepEqual(opcoesDeSsl(PUBLICA), { rejectUnauthorized: false })
  env.PGSSLMODE = '   '
  assert.deepEqual(opcoesDeSsl(PUBLICA), { rejectUnauthorized: false })
})

// ─── O invariante, sobre o TLS RESOLVIDO ─────────────────────────────────────

/* A premissa do teste abaixo: sem a nossa recusa, PGSSLMODE inválido resolveria
 * mesmo para texto claro no `pg`. É o defeito reproduzido no driver de verdade. */
test('premissa: o `pg` sozinho resolve PGSSLMODE inválido para texto claro', () => {
  env.PGSSLMODE = 'Require'
  const cliente = new Client({ connectionString: PUBLICA }) // sem o nosso `ssl`
  const resolvido = (cliente as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl
  assert.equal(resolvido, false, 'é exatamente isto que opcoesDeSsl impede')
})

/* O invariante: só a rede privada, ou uma escolha EXPLÍCITA do operador
 * (sslmode=disable), pode resultar em conexão sem criptografia. Varre as duas
 * formas de configurar — variável de ambiente E `?sslmode=` dentro da URL. */
test('nenhuma combinação produz conexão em claro para host público por descuido', () => {
  const ambientes: Array<Record<string, string | undefined>> = [
    {},
    { PGSSLMODE: 'Require' },
    { PGSSLMODE: 'allow' },
    { PGSSLMODE: 'require ' },
    { PGSSLMODE: 'require' },
    { PGSSLMODE: 'verify-full' },
    { PGSSLMODE: 'no-verify' },
    { DATABASE_CA_CERT: '   ' },
  ]
  const sufixos = ['', '?sslmode=require', '?sslmode=no-verify', '?sslmode=verify-full', '?application_name=x']
  let conferidas = 0

  for (const ambiente of ambientes) {
    for (const base of [PUBLICA, PUBLICA_US, VIZINHO, TERCEIRO]) {
      for (const sufixo of sufixos) {
        delete env.PGSSLMODE
        delete env.DATABASE_CA_CERT
        Object.assign(env, ambiente)
        const url = base + sufixo
        let resolvido: unknown
        try { resolvido = sslResolvido(url) } catch { continue } // recusa explícita: ótimo
        conferidas++
        assert.notEqual(
          resolvido, false,
          `${url} com ${JSON.stringify(ambiente)} sairia SEM CRIPTOGRAFIA`,
        )
      }
    }
  }
  assert.ok(conferidas > 50, `a varredura só conferiu ${conferidas} combinações`)
})

/* O contraponto — sem ele o invariante acima poderia estar apenas recusando
 * tudo: quando o operador PEDE texto claro, ele recebe texto claro. */
test('sslmode=disable explícito continua desligando o TLS', () => {
  assert.equal(sslResolvido(`${PUBLICA}?sslmode=disable`), false)
  env.PGSSLMODE = 'disable'
  assert.equal(sslResolvido(PUBLICA), false)
})

test('a rede privada resolve para sem-TLS, como esperado', () => {
  assert.equal(sslResolvido(INTERNA), false)
})
