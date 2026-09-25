import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { eq, inArray } from 'drizzle-orm'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'
import { CUSTO_BCRYPT } from '@/lib/senha'
import { TENANT_ROLE } from '@/lib/roles'

/* O script das três contas da 300, rodando contra Postgres de verdade (PGlite).
 *
 * A idempotência é a promessa central — "rodar duas vezes não estraga nada" só
 * vale se alguém rodar duas vezes e conferir, que é o que este arquivo faz.
 *
 * A senha de teste é montada por concatenação e é obviamente falsa; o script
 * real nunca tem senha literal, e este teste também não. */

let banco: BancoDeTeste
let db: BancoDeTeste['db']
let criarContas300: typeof import('@/lib/db/contas-300')['criarContas300']
let CONTAS_300: typeof import('@/lib/db/contas-300')['CONTAS_300']
let SLUG_300: typeof import('@/lib/db/contas-300')['SLUG_300']
let ERRO_TENANT_AUSENTE: typeof import('@/lib/db/contas-300')['ERRO_TENANT_AUSENTE']
let esquema: typeof import('@/lib/db/schema')

const TENANT_300 = 'tenant-300-de-teste'
const OUTRO_TENANT = 'tenant-vizinho'
const SENHA = ['temporaria', 'de', 'teste', '300'].join('-')

before(async () => {
  banco = await bancoDeTeste()
  db = banco.db
  usarComoBancoDoApp(db)

  esquema = await import('@/lib/db/schema')
  ;({ criarContas300, CONTAS_300, SLUG_300, ERRO_TENANT_AUSENTE } = await import('@/lib/db/contas-300'))
})

after(async () => {
  soltarBancoDoApp()
  await banco.fechar()
})

beforeEach(async () => {
  await db.delete(esquema.users)
  await db.delete(esquema.tenants)
})

async function criarTenant300() {
  await db.insert(esquema.tenants).values({
    id: TENANT_300, name: '300 Franchising', slug: SLUG_300, createdAt: new Date(),
  })
}

function emails(): string[] {
  return CONTAS_300.map(c => c.email)
}

async function contasNoBanco() {
  return db
    .select({
      id: esquema.users.id,
      name: esquema.users.name,
      email: esquema.users.email,
      role: esquema.users.role,
      tenantId: esquema.users.tenantId,
      passwordHash: esquema.users.passwordHash,
    })
    .from(esquema.users)
    .where(inArray(esquema.users.email, emails()))
}

// ── A lista que o dono mandou ────────────────────────────────────────────────

test('são exatamente as três contas pedidas', () => {
  assert.deepEqual(
    CONTAS_300.map(c => [c.nome, c.email]),
    [
      ['Ricardo Oliveira',  'ricardo.oliveira@300consultoria.com.br'],
      ['Yara Leite',        'yara.leite@300consultoria.com.br'],
      ['Isabella Nogueira', 'isabella.nogueira@300consultoria.com.br'],
    ],
  )
})

test('o e-mail é a identidade: nada é derivado do nome', () => {
  /* O nome é o campo mais fácil de errar e o mais barato de corrigir depois, e
   * o desenho não pode atrapalhar essa correção. A garantia: o id da linha é um
   * UUID sorteado (não sai do nome), e a busca por conta existente é por e-mail.
   * Assim renomear alguém é um UPDATE na coluna `name` e nada mais. */
  const codigo = fonte('lib/db/contas-300.ts')
  assert.ok(codigo.includes('crypto.randomUUID()'), 'o id não pode vir do nome')
  assert.ok(
    codigo.includes('eq(users.email, email)'),
    'a conta existente é procurada pelo e-mail, nunca pelo nome',
  )
  assert.ok(
    !/eq\(users\.name/.test(codigo),
    'nenhuma consulta pode depender do nome — trocar o rótulo quebraria a idempotência',
  )
})

test('trocar o nome de uma conta existente não cria outra conta', async () => {
  // O ensaio da correção que o dono pode querer depois: renomeia no banco e roda
  // de novo. Como a chave é o e-mail, a segunda passada reconhece a mesma conta.
  await criarTenant300()
  await criarContas300(SENHA)
  await db
    .update(esquema.users)
    .set({ name: 'Outro Nome Qualquer' })
    .where(eq(esquema.users.email, CONTAS_300[0].email))

  const resultados = await criarContas300(SENHA)
  assert.deepEqual(resultados.map(r => r.situacao), ['ja-existia', 'ja-existia', 'ja-existia'])
  assert.equal((await contasNoBanco()).length, 3)

  const linha = (await contasNoBanco()).find(l => l.email === CONTAS_300[0].email)!
  assert.equal(linha.name, 'Outro Nome Qualquer', 'o script não sobrescreve conta existente')
})

test('os e-mails já estão em minúsculas e sem espaço', () => {
  for (const { email } of CONTAS_300) {
    assert.equal(email, email.toLowerCase().trim(), email)
  }
})

// ── Primeira execução ────────────────────────────────────────────────────────

test('cria as três contas no cliente do slug, com o papel da conta única', async () => {
  await criarTenant300()

  const resultados = await criarContas300(SENHA)
  assert.deepEqual(resultados.map(r => r.situacao), ['criada', 'criada', 'criada'])

  const linhas = await contasNoBanco()
  assert.equal(linhas.length, 3)
  for (const linha of linhas) {
    assert.equal(linha.tenantId, TENANT_300, 'a conta tem que cair no cliente do slug 300')
    assert.equal(linha.role, TENANT_ROLE, 'lib/roles.ts: todo usuário de cliente é admin')
    assert.equal(await bcrypt.compare(SENHA, linha.passwordHash), true)
  }
})

test('o nome vai exatamente como na lista', async () => {
  await criarTenant300()
  await criarContas300(SENHA)
  const linhas = await contasNoBanco()
  for (const conta of CONTAS_300) {
    const linha = linhas.find(l => l.email === conta.email)
    assert.equal(linha?.name, conta.nome)
  }
})

test('o hash sai com o custo de bcrypt do produto', async () => {
  await criarTenant300()
  await criarContas300(SENHA)
  for (const linha of await contasNoBanco()) {
    assert.equal(Number(linha.passwordHash.split('$')[2]), CUSTO_BCRYPT)
  }
})

test('cada conta tem o próprio salt: três hashes diferentes para a mesma senha', async () => {
  await criarTenant300()
  await criarContas300(SENHA)
  const hashes = (await contasNoBanco()).map(l => l.passwordHash)
  assert.equal(new Set(hashes).size, 3, 'hashes iguais contariam que as senhas são a mesma')
})

test('a senha em claro não aparece em nenhuma linha gravada', async () => {
  await criarTenant300()
  await criarContas300(SENHA)
  assert.ok(!JSON.stringify(await contasNoBanco()).includes(SENHA))
})

// ── Segunda execução ─────────────────────────────────────────────────────────

test('rodar de novo não falha, não duplica e NÃO redefine a senha existente', async () => {
  await criarTenant300()
  await criarContas300(SENHA)

  /* Simula o que acontece de verdade entre uma execução e outra: a pessoa entrou
   * e trocou a senha. A segunda execução não pode devolvê-la à temporária. */
  const trocada = ['senha', 'que', 'a', 'pessoa', 'escolheu'].join('-')
  const alvo = CONTAS_300[0].email
  await db
    .update(esquema.users)
    .set({ passwordHash: await bcrypt.hash(trocada, 4) })
    .where(eq(esquema.users.email, alvo))

  const antes = await contasNoBanco()
  const resultados = await criarContas300(SENHA)

  assert.deepEqual(resultados.map(r => r.situacao), ['ja-existia', 'ja-existia', 'ja-existia'])
  const depois = await contasNoBanco()
  assert.equal(depois.length, 3, 'nada de conta duplicada')
  assert.deepEqual(
    depois.map(l => [l.email, l.passwordHash, l.id]).sort(),
    antes.map(l => [l.email, l.passwordHash, l.id]).sort(),
    'a segunda execução não pode tocar em conta que já existe',
  )
  const escolhida = depois.find(l => l.email === alvo)!
  assert.equal(await bcrypt.compare(trocada, escolhida.passwordHash), true,
    'a senha escolhida pela pessoa tinha que continuar valendo')
  assert.equal(await bcrypt.compare(SENHA, escolhida.passwordHash), false,
    'a temporária não pode voltar a valer')
})

test('execução parcial: cria só o que falta', async () => {
  await criarTenant300()
  await criarContas300(SENHA)
  await db.delete(esquema.users).where(eq(esquema.users.email, CONTAS_300[1].email))

  const resultados = await criarContas300(SENHA)
  assert.deepEqual(resultados.map(r => r.situacao), ['ja-existia', 'criada', 'ja-existia'])
  assert.equal((await contasNoBanco()).length, 3)
})

// ── Casos torto ──────────────────────────────────────────────────────────────

test('sem o cliente de slug 300, falha com mensagem em português e não grava nada', async () => {
  await db.insert(esquema.tenants).values({
    id: OUTRO_TENANT, name: 'Outro', slug: 'outro', createdAt: new Date(),
  })

  await assert.rejects(
    () => criarContas300(SENHA),
    (erro: Error) => {
      assert.equal(erro.message, ERRO_TENANT_AUSENTE)
      assert.ok(erro.message.includes(`slug "${SLUG_300}"`), erro.message)
      assert.ok(/cliente|banco/i.test(erro.message), 'a mensagem tem que dizer o que fazer')
      return true
    },
  )
  assert.equal((await contasNoBanco()).length, 0, 'nenhuma conta podia ter sido criada')
})

test('o cliente é achado pelo slug, não por id fixo', async () => {
  // Mesmo slug, outro id: o script tem que seguir o slug.
  await db.insert(esquema.tenants).values({
    id: 'id-completamente-diferente', name: '300 Franchising', slug: SLUG_300, createdAt: new Date(),
  })
  await criarContas300(SENHA)
  for (const linha of await contasNoBanco()) {
    assert.equal(linha.tenantId, 'id-completamente-diferente')
  }
})

test('senha temporária curta é recusada antes de tocar no banco', async () => {
  await criarTenant300()
  await assert.rejects(() => criarContas300('abc'), /senha tempor/i)
  assert.equal((await contasNoBanco()).length, 0)
})

test('e-mail já usado em OUTRO cliente é relatado, não roubado', async () => {
  /* users.email é único no banco inteiro. Se um dos e-mails já existir preso a
   * outro cliente, a conta NÃO pode ser criada na 300 — e o script tem que dizer
   * isso, em vez de relatar um "já existia" que faria o operador supor que a
   * pessoa está na 300. */
  await criarTenant300()
  await db.insert(esquema.tenants).values({
    id: OUTRO_TENANT, name: 'Outro', slug: 'outro', createdAt: new Date(),
  })
  await db.insert(esquema.users).values({
    id: 'intruso',
    tenantId: OUTRO_TENANT,
    name: 'Homônimo',
    email: CONTAS_300[2].email,
    passwordHash: bcrypt.hashSync(SENHA, 4),
    role: TENANT_ROLE,
    createdAt: new Date(),
  })

  const resultados = await criarContas300(SENHA)
  const relatada = resultados.find(r => r.email === CONTAS_300[2].email)!
  assert.equal(relatada.situacao, 'ja-existia')
  assert.equal(relatada.emOutroTenant, true)
  // E as outras duas foram criadas normalmente.
  assert.equal(resultados.filter(r => r.situacao === 'criada').length, 2)
})

test('o e-mail que já está na 300 não é marcado como de outro cliente', async () => {
  await criarTenant300()
  await criarContas300(SENHA)
  for (const r of await criarContas300(SENHA)) {
    assert.equal(r.emOutroTenant, false, r.email)
  }
})

// ── O executável ─────────────────────────────────────────────────────────────

function fonte(arquivo: string): string {
  return readFileSync(path.join(process.cwd(), arquivo), 'utf8')
}

const SCRIPT = 'lib/db/create-users-300.ts'

/** O código do arquivo sem o TEXTO das strings — o que sobra é só identificador.
 *  Dentro de template, o que está em `${...}` fica; o texto fixo some. Assim dá
 *  para perguntar "esta chamada recebe a VARIÁVEL senha?" sem que a palavra
 *  "senha" escrita numa frase para o operador conte como vazamento. */
function soOsIdentificadores(texto: string): string {
  return texto
    // `[^\`\\]` já engole quebra de linha, então nada de flag `s` (que o target
    // ES2017 deste tsconfig nem aceita).
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, m => '`' + (m.match(/\$\{[^}]*\}/g) ?? []).join('') + '`')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

test('a senha vem do ambiente, nunca da linha de comando', () => {
  const texto = fonte(SCRIPT)
  assert.ok(texto.includes('process.env[VAR_SENHA]'), 'a senha vem de variável de ambiente')
  assert.ok(
    !/process\.argv/.test(texto),
    'senha por argumento fica no histórico do shell e no `ps` de qualquer usuário da máquina',
  )
})

test('o script não imprime a senha em nenhuma saída', () => {
  // lib/db/seed-300.ts e lib/db/create-master.ts terminam com `console.log('Senha:', password)`.
  // É exatamente o que não se repete aqui: a senha iria para o terminal, para o
  // scrollback e para o log do CI.
  const codigo = soOsIdentificadores(fonte(SCRIPT))
  assert.ok(
    !/console\.\w+\([^)]*\bsenha\b/.test(codigo),
    'nenhuma chamada de console pode receber a variável senha',
  )
})

test('não existe senha padrão: sem a variável de ambiente o script para', () => {
  const texto = fonte(SCRIPT)
  // Os dois scripts vizinhos fazem `?? '<literal>'`. Aqui o `??` só pode cair em ''.
  assert.ok(!/\?\?\s*['"][^'"]+['"]/.test(texto), 'senha padrão literal no script')
  assert.ok(/process\.exit\(1\)/.test(texto), 'sem a variável, o script tem que parar com erro')
})

test('a única senha que o módulo hasheia é a que recebeu por parâmetro', () => {
  const chamadas = fonte('lib/db/contas-300.ts').match(/bcrypt\.hash\w*\([^,]+,/g) ?? []
  assert.deepEqual(chamadas, ['bcrypt.hash(senhaTemporaria,'])
})

test('o script está registrado no package.json', () => {
  const pkg = JSON.parse(fonte('package.json')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts['create-users-300'], `npx tsx ${SCRIPT}`)
})
