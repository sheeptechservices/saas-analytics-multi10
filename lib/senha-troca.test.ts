import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { and, eq, isNull } from 'drizzle-orm'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'
import { CUSTO_BCRYPT, MSG_DADOS_INVALIDOS, MSG_SENHA_ATUAL_INCORRETA, MSG_SENHA_CURTA, MSG_SENHA_REPETIDA, MSG_USUARIO_SUMIU } from '@/lib/senha'

/* A troca de senha rodando de verdade contra Postgres (PGlite em memória).
 *
 * É o código de PRODUÇÃO — `trocarSenhaDoUsuario`, importada depois de
 * `usarComoBancoDoApp` preencher o `globalThis.__pgDb` que lib/db/index.ts já usa
 * como cache. Nenhuma linha de produção mudou para isto funcionar, e nenhum SQL
 * foi recopiado aqui: trocar o `bcrypt.compare` por `===` no módulo precisa
 * quebrar um teste de comportamento, não passar porque o teste tem a própria
 * cópia da lógica.
 *
 * Nenhuma senha plausível aparece no arquivo: as strings são montadas a partir de
 * um prefixo e um número, para que nada daqui pareça (nem seja) uma credencial. */

let banco: BancoDeTeste
let db: BancoDeTeste['db']
let trocarSenhaDoUsuario: typeof import('@/lib/senha-troca')['trocarSenhaDoUsuario']
let esquema: typeof import('@/lib/db/schema')

const TENANT = 'tenant-senha'
const USUARIO = 'usuario-senha'

/** Senhas de teste. Longas o bastante para passar na regra, e obviamente falsas. */
const ATUAL = 'senha-de-teste-atual'
const NOVA = 'senha-de-teste-nova'

/** Custo baixo só para o SETUP do teste: é hash descartável, não o do produto.
 *  O custo do produto é conferido no final, lendo o hash que a função gravou. */
const CUSTO_DO_SETUP = 4

before(async () => {
  banco = await bancoDeTeste()
  db = banco.db
  usarComoBancoDoApp(db)

  esquema = await import('@/lib/db/schema')
  ;({ trocarSenhaDoUsuario } = await import('@/lib/senha-troca'))

  await db.insert(esquema.tenants).values({
    id: TENANT, name: 'Teste', slug: 'teste-senha', createdAt: new Date(),
  })
})

after(async () => {
  soltarBancoDoApp()
  await banco.fechar()
})

/** Recria a conta antes de cada teste: quase todo caso mexe no hash. */
beforeEach(async () => {
  await db.delete(esquema.passwordResetTokens)
  await db.delete(esquema.users)
  await db.insert(esquema.users).values({
    id: USUARIO,
    tenantId: TENANT,
    name: 'Pessoa de Teste',
    email: 'pessoa@exemplo.com',
    passwordHash: bcrypt.hashSync(ATUAL, CUSTO_DO_SETUP),
    role: 'admin',
    createdAt: new Date(),
  })
})

async function hashGravado(): Promise<string> {
  const linha = await db
    .select({ passwordHash: esquema.users.passwordHash })
    .from(esquema.users)
    .where(eq(esquema.users.id, USUARIO))
    .then(r => r[0])
  return linha.passwordHash
}

// ── O caminho feliz ──────────────────────────────────────────────────────────

test('com a senha atual correta, a nova passa a valer e a antiga para de valer', async () => {
  const antes = await hashGravado()

  const r = await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })
  assert.deepEqual(r, { ok: true })

  const depois = await hashGravado()
  assert.notEqual(depois, antes, 'o hash tinha que mudar')
  assert.equal(await bcrypt.compare(NOVA, depois), true, 'a nova senha precisa entrar')
  assert.equal(await bcrypt.compare(ATUAL, depois), false, 'a antiga precisa parar de entrar')
})

test('o hash novo é gravado com o custo de bcrypt do produto', async () => {
  await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })
  // Formato do bcrypt: $2<letra>$<custo>$<salt+hash>. O custo fica no hash, o que
  // é o que permite conferi-lo sem reimplementar nada.
  const custo = Number((await hashGravado()).split('$')[2])
  assert.equal(custo, CUSTO_BCRYPT, `o hash saiu com custo ${custo}, não ${CUSTO_BCRYPT}`)
})

test('a senha em claro não fica em lugar nenhum da linha', async () => {
  await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })
  const linha = await db.select().from(esquema.users).where(eq(esquema.users.id, USUARIO)).then(r => r[0])
  assert.ok(!JSON.stringify(linha).includes(NOVA), 'a senha em claro vazou para a linha')
})

// ── O que a rota recusa ──────────────────────────────────────────────────────

test('senha atual errada: 400, e o hash guardado não muda', async () => {
  const antes = await hashGravado()
  const r = await trocarSenhaDoUsuario({
    userId: USUARIO, senhaAtual: ATUAL + '-errada', novaSenha: NOVA,
  })
  assert.deepEqual(r, { ok: false, status: 400, error: MSG_SENHA_ATUAL_INCORRETA })
  assert.equal(await hashGravado(), antes, 'recusa não pode alterar nada')
})

test('sessão sozinha não troca senha: sem a senha atual é 400', async () => {
  // O ponto do lote. Navegador logado e deixado aberto não pode trancar o dono
  // para fora da conta.
  const antes = await hashGravado()
  for (const senhaAtual of [undefined, null, '', 12345, {}, []]) {
    const r = await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual, novaSenha: NOVA })
    assert.deepEqual(
      r, { ok: false, status: 400, error: MSG_DADOS_INVALIDOS },
      `senhaAtual = ${JSON.stringify(senhaAtual)} não podia passar`,
    )
  }
  assert.equal(await hashGravado(), antes)
})

test('nova senha ausente ou de outro tipo: 400 de dados inválidos', async () => {
  for (const novaSenha of [undefined, null, 12345678, { toString: () => NOVA }]) {
    const r = await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha })
    assert.deepEqual(r, { ok: false, status: 400, error: MSG_DADOS_INVALIDOS })
  }
})

test('nova senha curta: 400 com a mesma frase da recuperação por e-mail', async () => {
  const antes = await hashGravado()
  const r = await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: 'abc' })
  assert.deepEqual(r, { ok: false, status: 400, error: MSG_SENHA_CURTA })
  assert.equal(await hashGravado(), antes)
})

test('o tamanho é conferido ANTES da senha atual', async () => {
  // Senha atual errada E nova curta: a recusa é a do tamanho. Assim quem digitou
  // as duas coisas erradas vê o problema que consegue consertar sozinho, e não
  // fica alternando entre as duas mensagens.
  const r = await trocarSenhaDoUsuario({
    userId: USUARIO, senhaAtual: 'qualquer-outra', novaSenha: 'abc',
  })
  assert.deepEqual(r, { ok: false, status: 400, error: MSG_SENHA_CURTA })
})

test('repetir a senha atual como nova é recusado', async () => {
  const antes = await hashGravado()
  const r = await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: ATUAL })
  assert.deepEqual(r, { ok: false, status: 400, error: MSG_SENHA_REPETIDA })
  assert.equal(await hashGravado(), antes, 'nem o salt pode ser rotacionado à toa')
})

test('conta apagada com sessão ainda válida: 404, não um sucesso vazio', async () => {
  // A sessão é JWT: ela sobrevive à remoção da linha. Sem este caminho, o UPDATE
  // não acharia nada e a rota responderia "senha alterada".
  await db.delete(esquema.users).where(eq(esquema.users.id, USUARIO))
  const r = await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })
  assert.deepEqual(r, { ok: false, status: 404, error: MSG_USUARIO_SUMIU })
})

test('nenhuma recusa devolve 401 nem 403', async () => {
  /* lib/api-error.ts dá a esses dois status um sentido que não é este: 401 é
   * "sessão expirada" e 403 é "módulo fora do plano". Uma recusa de senha com
   * esses códigos faria a tela mentir sobre a causa. */
  const recusas = await Promise.all([
    trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: 'outra-coisa', novaSenha: NOVA }),
    trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: 'abc' }),
    trocarSenhaDoUsuario({ userId: 'nao-existe', senhaAtual: ATUAL, novaSenha: NOVA }),
    trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: undefined, novaSenha: NOVA }),
  ])
  for (const r of recusas) {
    assert.equal(r.ok, false)
    if (r.ok === false) assert.ok(r.status !== 401 && r.status !== 403, `status ${r.status}`)
  }
})

// ── Os links de recuperação pendentes ────────────────────────────────────────

async function pendentes(): Promise<number> {
  const linhas = await db
    .select({ id: esquema.passwordResetTokens.id })
    .from(esquema.passwordResetTokens)
    .where(and(
      eq(esquema.passwordResetTokens.userId, USUARIO),
      isNull(esquema.passwordResetTokens.usedAt),
    ))
  return linhas.length
}

async function criarLinkPendente(token: string) {
  await db.insert(esquema.passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId: USUARIO,
    token,
    expiresAt: Date.now() + 3_600_000,
  })
}

test('trocar a senha queima os links de recuperação pendentes', async () => {
  // Um link vazado na caixa de e-mail invadida é o motivo mais comum para alguém
  // correr a trocar a senha. Deixá-lo vivo permitiria desfazer a troca.
  await criarLinkPendente('token-a')
  await criarLinkPendente('token-b')
  assert.equal(await pendentes(), 2)

  await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })
  assert.equal(await pendentes(), 0, 'os links pendentes tinham que ser marcados como usados')
})

test('uma troca RECUSADA não queima link nenhum', async () => {
  await criarLinkPendente('token-c')
  await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: 'errada', novaSenha: NOVA })
  assert.equal(await pendentes(), 1, 'quem errou a senha atual não pode invalidar o link de quem sabe')
})

test('a troca não mexe nos links de OUTRA pessoa', async () => {
  const outro = 'usuario-vizinho'
  await db.insert(esquema.users).values({
    id: outro,
    tenantId: TENANT,
    name: 'Vizinho',
    email: 'vizinho@exemplo.com',
    passwordHash: bcrypt.hashSync(ATUAL, CUSTO_DO_SETUP),
    role: 'admin',
    createdAt: new Date(),
  })
  await db.insert(esquema.passwordResetTokens).values({
    id: crypto.randomUUID(), userId: outro, token: 'token-do-vizinho',
    expiresAt: Date.now() + 3_600_000,
  })

  await criarLinkPendente('token-d')
  await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })

  const doVizinho = await db
    .select({ usedAt: esquema.passwordResetTokens.usedAt })
    .from(esquema.passwordResetTokens)
    .where(eq(esquema.passwordResetTokens.userId, outro))
    .then(r => r[0])
  assert.equal(doVizinho.usedAt, null, 'o link do vizinho continua valendo')
})

test('a troca não muda a senha de outra conta', async () => {
  const outro = 'usuario-vizinho-2'
  const hashDoVizinho = bcrypt.hashSync(ATUAL, CUSTO_DO_SETUP)
  await db.insert(esquema.users).values({
    id: outro,
    tenantId: TENANT,
    name: 'Vizinho 2',
    email: 'vizinho2@exemplo.com',
    passwordHash: hashDoVizinho,
    role: 'admin',
    createdAt: new Date(),
  })

  await trocarSenhaDoUsuario({ userId: USUARIO, senhaAtual: ATUAL, novaSenha: NOVA })

  const depois = await db
    .select({ passwordHash: esquema.users.passwordHash })
    .from(esquema.users)
    .where(eq(esquema.users.id, outro))
    .then(r => r[0])
  assert.equal(depois.passwordHash, hashDoVizinho)
})
