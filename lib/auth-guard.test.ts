import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Session } from 'next-auth'
import { requireMaster, requireTenantUser } from '@/lib/auth-guard'

// As duas portas que as rotas usam. `null` é "pode passar"; qualquer outra coisa
// é a resposta 403 que a rota devolve na hora.

const sessao = (role: string, tenantId = 'tenant-a') => ({
  user: { id: 'u1', name: 'Fulano', email: 'fulano@exemplo.com', role, tenantId },
  expires: '2099-01-01T00:00:00.000Z',
} as unknown as Session)

test('porta do tenant: admin, papéis legados e master passam', async () => {
  for (const papel of ['admin', 'manager', 'user', 'master']) {
    assert.equal(requireTenantUser(sessao(papel)), null, `${papel} deveria passar`)
  }
})

test('porta do tenant: sessão sem papel leva 403', async () => {
  const negado = requireTenantUser(sessao(''))
  assert.notEqual(negado, null)
  assert.equal(negado!.status, 403)
  assert.deepEqual(await negado!.json(), { error: 'insufficient_role' })
})

test('porta da plataforma: só o master passa', async () => {
  assert.equal(requireMaster(sessao('master')), null)

  for (const papel of ['admin', 'manager', 'user', '']) {
    const negado = requireMaster(sessao(papel))
    assert.notEqual(negado, null, `${papel} não podia passar na porta do master`)
    assert.equal(negado!.status, 403)
  }
})

test('o tenant da sessão não abre a porta da plataforma', () => {
  // Trocar de tenant não promove ninguém: quem não é master segue barrado.
  assert.notEqual(requireMaster(sessao('admin', 'tenant-b')), null)
})

// As duas exceções à conta única, por decisão do dono. Os dois handlers chamam
// requireMaster direto (DELETE /api/users/[userId] e PUT /api/settings), então é
// esta porta que precisa segurar — e ela é a mesma nos dois casos.

test('remover usuário (DELETE /api/users/[userId]) é só do master', async () => {
  assert.equal(requireMaster(sessao('master')), null)

  for (const papel of ['admin', 'manager', 'user']) {
    const negado = requireMaster(sessao(papel))
    assert.notEqual(negado, null, `${papel} não podia remover usuário`)
    assert.equal(negado!.status, 403)
    assert.deepEqual(await negado!.json(), { error: 'insufficient_role' })
  }
})

test('salvar a marca (PUT /api/settings) é só do master', async () => {
  assert.equal(requireMaster(sessao('master')), null)

  for (const papel of ['admin', 'manager', 'user']) {
    const negado = requireMaster(sessao(papel))
    assert.notEqual(negado, null, `${papel} não podia salvar a marca`)
    assert.equal(negado!.status, 403)
  }
})

test('o resto da equipe continua aberto: listar, convidar e renomear', () => {
  // Só a semântica da porta: quem passa por requireTenantUser. Qual rota chama
  // qual porta é o teste de baixo — este aqui não veria uma troca.
  for (const papel of ['admin', 'manager', 'user']) {
    assert.equal(requireTenantUser(sessao(papel)), null, `${papel} deveria gerenciar a equipe`)
  }
})

// ── Qual rota chama qual porta ───────────────────────────────────────────────
//
// Os testes acima provam o que cada porta faz; nenhum deles percebe se alguém
// trocar a porta dentro de um handler. Como chamar o handler de verdade exigiria
// sessão, banco e metade do NextAuth, a checagem é na fonte: leva o corpo de
// cada handler e exige a porta certa — e a ausência da outra. Trocar
// requireMaster por requireTenantUser no DELETE de usuários ou no PUT da marca
// derruba a suíte aqui.

/** Corpo do handler, do `export async function NOME(` até o próximo `export`. */
function corpoDoHandler(arquivo: string, metodo: string): string {
  const fonte = readFileSync(path.join(process.cwd(), arquivo), 'utf8')
  const marcador = `export async function ${metodo}(`
  const inicio = fonte.indexOf(marcador)
  assert.notEqual(inicio, -1, `${arquivo} não tem mais o handler ${metodo} — o teste precisa acompanhar`)
  const resto = fonte.slice(inicio + marcador.length)
  const fim = resto.indexOf('\nexport ')
  return fim === -1 ? resto : resto.slice(0, fim)
}

const PORTAS: [arquivo: string, metodo: string, porta: 'requireMaster' | 'requireTenantUser'][] = [
  // As duas exceções da conta única: plataforma.
  ['app/api/users/[userId]/route.ts',   'DELETE', 'requireMaster'],
  ['app/api/settings/route.ts',         'PUT',    'requireMaster'],
  // O resto é do cliente.
  ['app/api/users/[userId]/route.ts',   'GET',    'requireTenantUser'],
  ['app/api/users/[userId]/route.ts',   'PUT',    'requireTenantUser'],
  ['app/api/users/route.ts',            'GET',    'requireTenantUser'],
  ['app/api/users/route.ts',            'POST',   'requireTenantUser'],
  // Trocar a PRÓPRIA senha é de quem tem conta, master incluído — a porta do
  // tenant deixa o master passar. Fechar aqui com requireMaster deixaria o
  // cliente sem nenhum caminho para trocar a senha estando logado.
  ['app/api/me/password/route.ts',      'PUT',    'requireTenantUser'],
  ['app/api/audit-logs/route.ts',       'GET',    'requireTenantUser'],
  ['app/api/sdr/dispatch/route.ts',     'POST',   'requireTenantUser'],
  ['app/api/sdr/enroll/route.ts',       'POST',   'requireTenantUser'],
  ['app/api/sdr/leads/blast/route.ts',  'POST',   'requireTenantUser'],
  // A importação escreve na base do cliente (INSERT/UPDATE de leads), então precisa
  // da mesma porta das irmãs — não basta ter sessão. O cadastro manual escreve pelo
  // mesmo caminho, um lead por vez, e por isso entra na mesma lista.
  ['app/api/sdr/leads/import/route.ts', 'POST',   'requireTenantUser'],
  ['app/api/sdr/leads/manual/route.ts', 'POST',   'requireTenantUser'],
]

test('cada rota chama a porta certa — trocar uma pela outra derruba isto', () => {
  for (const [arquivo, metodo, esperada] of PORTAS) {
    const corpo = corpoDoHandler(arquivo, metodo)
    const outra = esperada === 'requireMaster' ? 'requireTenantUser' : 'requireMaster'
    assert.ok(
      corpo.includes(`${esperada}(session)`),
      `${metodo} ${arquivo} tem que chamar ${esperada}(session)`,
    )
    assert.ok(
      !corpo.includes(`${outra}(session)`),
      `${metodo} ${arquivo} não pode chamar ${outra}(session)`,
    )
  }
})

test('ler a marca não virou coisa de master', () => {
  // GET /api/settings é o que pinta a tela: cor, logo e nome do tenant. Fechar
  // esse GET deixaria todo usuário do cliente sem marca.
  const corpo = corpoDoHandler('app/api/settings/route.ts', 'GET')
  assert.ok(!corpo.includes('requireMaster('), 'GET /api/settings não pode exigir master')
  assert.ok(!corpo.includes('requireTenantUser('), 'GET /api/settings só precisa de sessão')
})

test('nenhuma rota de tenant ficou sem porta nenhuma', () => {
  // Um handler que perca a linha do guard passaria nos dois testes acima se eles
  // olhassem só a porta esperada; aqui a exigência é ter alguma.
  for (const [arquivo, metodo] of PORTAS) {
    const corpo = corpoDoHandler(arquivo, metodo)
    assert.ok(
      /require(Master|TenantUser)\(session\)/.test(corpo),
      `${metodo} ${arquivo} ficou sem checagem de papel`,
    )
  }
})

test('o 403 da porta é devolvido, não só calculado', () => {
  // Chamar o guard e ignorar o retorno deixa a rota aberta com cara de fechada:
  // `const r = requireMaster(session)` sozinho não barra ninguém. Aqui exigimos
  // o `if (r) return r` logo em seguida, com o mesmo nome de variável.
  for (const [arquivo, metodo] of PORTAS) {
    const corpo = corpoDoHandler(arquivo, metodo)
    const atribuicao = corpo.match(/const\s+(\w+)\s*=\s*require(?:Master|TenantUser)\(session\)/)
    assert.ok(atribuicao, `${metodo} ${arquivo}: guard fora do formato const x = requireX(session)`)
    const nome = atribuicao![1]
    assert.ok(
      new RegExp(`if\\s*\\(\\s*${nome}\\s*\\)\\s*return\\s+${nome}\\b`).test(corpo),
      `${metodo} ${arquivo} calcula a porta mas não devolve o 403 (falta if (${nome}) return ${nome})`,
    )
  }
})
