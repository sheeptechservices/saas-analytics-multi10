import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ApiError } from '@/lib/api-error'
import {
  CUSTO_BCRYPT,
  MIN_SENHA,
  MSG_SENHA_ATUAL_INCORRETA,
  MSG_SENHA_CURTA,
  RECUSAS_DA_TROCA,
  textoDaTrocaDeSenha,
  validarNovaSenha,
} from '@/lib/senha'

/* A regra de senha, sem banco.
 *
 * Nenhuma senha de verdade aparece aqui: as strings são do tipo 'x'.repeat(n),
 * geradas pelo tamanho que interessa ao teste. Fixture com cara de senha real
 * acaba copiada para um .env de alguém. */

const senhaDe = (n: number) => 'x'.repeat(n)

// ── validarNovaSenha ─────────────────────────────────────────────────────────

test('a senha curta é recusada, e a de tamanho exato passa', () => {
  assert.equal(validarNovaSenha(senhaDe(MIN_SENHA - 1)), MSG_SENHA_CURTA)
  assert.equal(validarNovaSenha(senhaDe(MIN_SENHA)), null, 'o mínimo é inclusivo')
  assert.equal(validarNovaSenha(senhaDe(MIN_SENHA + 40)), null)
})

test('senha vazia é recusada pela mesma regra de tamanho', () => {
  assert.equal(validarNovaSenha(''), MSG_SENHA_CURTA)
})

test('a mensagem do tamanho cita o número que a regra realmente usa', () => {
  // Mudar MIN_SENHA sem mudar o texto deixaria a tela pedindo outro número.
  assert.ok(MSG_SENHA_CURTA.includes(String(MIN_SENHA)), MSG_SENHA_CURTA)
})

// ── O texto que vai para a tela ──────────────────────────────────────────────

test('recusa de negócio da rota chega ao usuário com a frase da rota', () => {
  const texto = textoDaTrocaDeSenha(new ApiError(400, 'requisicao', MSG_SENHA_ATUAL_INCORRETA))
  assert.equal(texto.detalhe, MSG_SENHA_ATUAL_INCORRETA)
  assert.equal(texto.podeTentarDeNovo, false, 'repetir o mesmo pedido dá a mesma recusa')
})

test('todas as recusas conhecidas passam inteiras para a tela', () => {
  for (const frase of RECUSAS_DA_TROCA) {
    const texto = textoDaTrocaDeSenha(new ApiError(400, 'requisicao', frase))
    assert.equal(texto.detalhe, frase, `"${frase}" precisa chegar à tela como está`)
  }
})

test('código de máquina NÃO vira texto de tela', () => {
  // 'insufficient_role' é o corpo do 403 de lib/auth-guard.ts. Mostrá-lo cru era
  // o defeito que a issue #98 tirou das telas de leads.
  const texto = textoDaTrocaDeSenha(new ApiError(403, 'sem-modulo', 'insufficient_role'))
  assert.ok(!texto.detalhe.includes('insufficient_role'), texto.detalhe)
  assert.equal(texto.titulo, 'Módulo não disponível', 'cai no texto do status')
})

test('401 continua dizendo que a sessão expirou', () => {
  const texto = textoDaTrocaDeSenha(new ApiError(401, 'sem-sessao', 'Unauthorized'))
  assert.equal(texto.titulo, 'Sessão expirada')
})

test('500 e queda de rede oferecem tentar de novo; a recusa de senha não', () => {
  assert.equal(textoDaTrocaDeSenha(new ApiError(500, 'servidor')).podeTentarDeNovo, true)
  assert.equal(textoDaTrocaDeSenha(new TypeError('falhou')).podeTentarDeNovo, true)
  assert.equal(
    textoDaTrocaDeSenha(new ApiError(400, 'requisicao', MSG_SENHA_CURTA)).podeTentarDeNovo,
    false,
  )
})

// ── As duas telas têm que concordar ──────────────────────────────────────────
//
// A recuperação por e-mail (app/api/auth/reset-password) foi escrita antes e tem
// a regra embutida no próprio handler. Enquanto ela não importar lib/senha.ts, a
// única forma de impedir que as duas divirjam em silêncio — uma senha aceita numa
// tela e recusada na outra — é conferir a fonte. É a mesma técnica de
// lib/auth-guard.test.ts.

function fonte(arquivo: string): string {
  return readFileSync(path.join(process.cwd(), arquivo), 'utf8')
}

const RESET = 'app/api/auth/reset-password/route.ts'

test(`${RESET} exige o mesmo mínimo de caracteres que lib/senha.ts`, () => {
  const texto = fonte(RESET)
  assert.ok(
    texto.includes(`password.length < ${MIN_SENHA}`),
    `A recuperação por e-mail não usa mais o mínimo ${MIN_SENHA}. As duas telas precisam ` +
      'aceitar a mesma senha: ajuste MIN_SENHA em lib/senha.ts, ou faça a rota importá-lo.',
  )
  assert.ok(
    texto.includes(MSG_SENHA_CURTA),
    `A frase do tamanho mudou em ${RESET} e ficou diferente de MSG_SENHA_CURTA.`,
  )
})

test(`${RESET} grava o hash com o mesmo custo de bcrypt que lib/senha.ts`, () => {
  assert.ok(
    fonte(RESET).includes(`bcrypt.hash(password, ${CUSTO_BCRYPT})`),
    `O custo do bcrypt divergiu. Trocar a senha pela tela nova não pode gravar um hash ` +
      `mais fraco (ou mais caro) do que a recuperação por e-mail grava — os dois usam ` +
      `${CUSTO_BCRYPT}.`,
  )
})

test('o convite de usuário também grava com o mesmo custo', () => {
  assert.ok(
    fonte('app/api/users/route.ts').includes(`bcrypt.hash(crypto.randomUUID(), ${CUSTO_BCRYPT})`),
    `app/api/users/route.ts saiu do custo ${CUSTO_BCRYPT}.`,
  )
})

// ── A rota de troca ──────────────────────────────────────────────────────────

const ROTA = 'app/api/me/password/route.ts'

/* A identidade de quem troca a senha vem da SESSÃO e de mais lugar nenhum. É a
 * invariante em que este recurso inteiro se apoia, e o handler não tem teste de
 * comportamento (a lógica testável mora em lib/senha-troca.ts) — então esta leitura
 * de fonte é a única defesa que existe.
 *
 * Sem ela, trocar a linha por `userId: body?.userId ?? session.user.id` passaria com
 * a suíte inteira verde. E aí qualquer usuário autenticado poderia apontar a troca
 * para a conta de outro cliente: como `userId` não é filtrado por tenant e a
 * conferência da senha atual é feita contra a linha apontada, o resultado é um
 * oráculo de senha — um palpite por requisição, resposta limpa de 200 ou 400, contra
 * qualquer conta do banco, master inclusive. */
test('o id de quem troca a senha sai da sessão, nunca do corpo do pedido', () => {
  const texto = fonte(ROTA)
  const inicio = texto.indexOf('trocarSenhaDoUsuario({')
  assert.notEqual(inicio, -1, `${ROTA} deixou de delegar para trocarSenhaDoUsuario`)
  const chamada = texto.slice(inicio, texto.indexOf('})', inicio))

  assert.ok(chamada.includes('userId: session.user.id'),
    'o userId tem de vir de session.user.id, literalmente')
  for (const origem of ['body', 'params', 'searchParams', 'headers', 'req.']) {
    assert.ok(!chamada.includes(`userId: ${origem}`) && !chamada.includes(`${origem}?.userId`),
      `o userId não pode vir de ${origem} — seria a conta de outra pessoa`)
  }
})

/* O registro de auditoria não leva `metadata` NENHUMA, e o teste afirma a forma em
 * vez de uma lista de palavras proibidas. A lista não segurava o caso óbvio:
 * `metadata: { corpo: body }` grava as DUAS senhas em texto puro — a antiga e a nova
 * — numa tabela que todo usuário do cliente lê em Configurações → Auditoria, e que o
 * master lê de todos os clientes. Nenhuma palavra proibida aparece nessa linha. */
test('o registro de auditoria da troca não tem metadata alguma', () => {
  const texto = fonte(ROTA)
  const inicio = texto.indexOf('logAudit({')
  assert.notEqual(inicio, -1, `${ROTA} deixou de registrar a troca em auditoria`)
  const chamada = texto.slice(inicio, texto.indexOf('})', inicio))

  assert.ok(!/\bmetadata\b/.test(chamada),
    'nada de metadata aqui: qualquer objeto ali acaba em JSON.stringify no banco, ' +
    'e o corpo do pedido contém as duas senhas em texto puro')
  for (const proibido of ['senhaAtual', 'novaSenha', 'passwordHash', 'body']) {
    assert.ok(!chamada.includes(proibido), `${proibido} não pode entrar no registro de auditoria`)
  }
})

test('a rota não tem senha em lugar nenhum do console', () => {
  const texto = fonte(ROTA) + fonte('lib/senha-troca.ts')
  // Qualquer método, não só os quatro óbvios: `console.debug`, `.trace`, `.dir` e
  // `.table` também escrevem no log do servidor — e lá a senha ficaria legível.
  assert.ok(!/console\.\w+/.test(texto), 'nada de senha no console')
})

test('o handler é PUT, e a validação é a de lib/senha-troca.ts', () => {
  const texto = fonte(ROTA)
  assert.ok(texto.includes('export async function PUT('), 'a tela chama PUT /api/me/password')
  // A porta de papel é cobrada na tabela PORTAS de auth-guard.test.ts; aqui fica a
  // de sessão, que aquela tabela não cobre. Sem sessão o guard recebe null e o Next
  // devolve 500 — fecha, mas fecha por acidente, e acidente não é garantia.
  assert.ok(/const session = await auth\(\)/.test(texto) && texto.includes('if (!session)'),
    'a rota precisa checar a sessão explicitamente antes de tudo')
  assert.ok(
    texto.includes('trocarSenhaDoUsuario('),
    'o handler precisa continuar delegando: é a parte coberta por teste com banco',
  )
  assert.ok(
    // Só o import: o comentário do arquivo CITA o bcrypt.hash de app/api/users
    // ao explicar por que esta rota existe, e citar não é duplicar.
    !/^\s*import .*bcrypt/m.test(texto),
    'hash no handler é regra duplicada — ela mora em lib/senha-troca.ts',
  )
})

/* A frase sobre os outros aparelhos é a única coisa entre este recurso e uma falsa
 * sensação de segurança. A sessão é um JWT assinado, sem tabela de sessão para
 * limpar: trocar a senha NÃO derruba quem já está logado, nem um invasor com o
 * cookie roubado, até o token expirar.
 *
 * Trocar o texto por "todos os outros aparelhos foram desconectados" passaria com a
 * suíte verde e faria a pessoa parar de procurar ajuda justamente quando mais
 * precisa. Este teste existe para que essa frase só mude junto com a arquitetura. */
test('a tela não promete desconectar outros aparelhos — porque não desconecta', () => {
  const texto = fonte('components/settings/TrocarSenha.tsx')

  assert.ok(
    /não desconecta os aparelhos que já estão logados/.test(texto),
    'a tela precisa dizer, em texto, que os outros aparelhos continuam logados',
  )
  for (const mentira of [
    'foram desconectados', 'serão desconectados', 'desconecta todos',
    'encerra as sessões', 'encerradas as sessões', 'sessões foram encerradas',
  ]) {
    assert.ok(!texto.includes(mentira),
      `a tela não pode dizer "${mentira}": a sessão é JWT e nada é encerrado`)
  }
})

// ── A tela ───────────────────────────────────────────────────────────────────

test('a tela usa fetchJson e o CampoSenha, e não escreve <input> de senha', () => {
  const texto = fonte('components/settings/TrocarSenha.tsx')
  assert.ok(texto.includes('fetchJson('), 'sem fetchJson, um 400 viraria "senha alterada"')
  assert.ok(texto.includes('<CampoSenha'), 'o campo com o olho é o componente que já existe')
  assert.ok(!texto.includes('type="password"'), 'nenhum <input> de senha escrito à mão')
})

test('a tela não tem estilo em linha nem hover em JavaScript', () => {
  // As duas regras da casa que o eslint cobra (eslint.config.mjs). Aqui elas
  // valem como ERRO para este arquivo, e não como aviso.
  const texto = fonte('components/settings/TrocarSenha.tsx')
  assert.ok(!/\bstyle=\{/.test(texto), 'estilo em linha: use classe do design system')
  assert.ok(!/onMouse(Enter|Leave|Over|Out)=/.test(texto), 'hover é :hover no CSS')
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(texto), 'cor solta: use var(--token)')
})
