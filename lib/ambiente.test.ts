import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bytesDeHex,
  CATALOGO,
  conferirAmbiente,
  configuracaoDeEmail,
  enderecoDoRemetente,
  GRUPOS_OU,
  modoDeVerificacao,
  textoDaFalhaDeAmbiente,
  type Ambiente,
} from '@/lib/ambiente'

/* Nada aqui toca `process.env`: `conferirAmbiente` recebe o ambiente como
 * argumento justamente para poder ser testada sem mexer no processo. Os valores
 * abaixo são de mentira e parecem de mentira — nenhum segredo de verdade entra
 * em arquivo de teste. */

const HEX_32_BYTES = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

/** Um ambiente de produção que passa em tudo. Cada teste estraga um pedaço. */
function ambienteBom(extra: Ambiente = {}): Ambiente {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://usuario:segredo-de-mentira@postgres.railway.internal:5432/railway',
    ENCRYPTION_SECRET: HEX_32_BYTES,
    APP_URL: 'https://app.exemplo.com.br',
    AUTH_SECRET: 'segredo-de-mentira-para-teste',
    CRON_SECRET: 'outro-segredo-de-mentira',
    RESEND_API_KEY: 're_chave_de_mentira',
    RESEND_FROM_EMAIL: 'nao-responda@teste.invalid',
    ...extra,
  }
}

test('o ambiente que a produção tem hoje passa limpo — nenhum erro e nenhum aviso', () => {
  /* Este é o teste mais importante do arquivo, e o único que protege contra o
   * risco real desta mudança: uma variável marcada como obrigatória que a
   * produção não tem transforma o próximo deploy em apagão. A lista de
   * variáveis aqui é EXATAMENTE a que o serviço de produção tem definida hoje
   * (menos as duas TURSO_*, que nenhuma linha de código lê), e APP_ROOT_DOMAIN
   * está de fora de propósito: ela é deliberadamente vazia lá. */
  const producao = {
    NODE_ENV: 'production',
    APP_URL: 'https://app.exemplo.com.br',
    AUTH_SECRET: 'segredo-de-mentira-para-teste',
    CRON_SECRET: 'outro-segredo-de-mentira',
    DATABASE_URL: 'postgres://usuario:segredo-de-mentira@postgres.railway.internal:5432/railway',
    ENCRYPTION_SECRET: HEX_32_BYTES,
    NEXTAUTH_SECRET: 'segredo-de-mentira-para-teste',
    RESEND_API_KEY: 're_chave_de_mentira',
    RESEND_FROM_EMAIL: 'nao-responda@teste.invalid',
    TURSO_DATABASE_URL: 'libsql://sobra-da-migracao',
    TURSO_AUTH_TOKEN: 'sobra-da-migracao',
  }
  const { erros, avisos } = conferirAmbiente(producao, true)
  assert.deepEqual(erros, [], 'nenhuma variável que a produção JÁ TEM pode virar erro')
  assert.deepEqual(avisos, [], 'nem aviso: APP_ROOT_DOMAIN vazia é o estado correto lá')
})

test('a falha lista TODAS as variáveis de uma vez, não a primeira', () => {
  const { erros } = conferirAmbiente({ NODE_ENV: 'production' }, true)
  const nomes = ['DATABASE_URL', 'ENCRYPTION_SECRET', 'APP_URL', 'AUTH_SECRET']
  for (const nome of nomes) {
    assert.ok(erros.some(e => e.includes(nome)), `${nome} deveria estar na lista de erros`)
  }
  assert.ok(erros.length >= 4, `esperava pelo menos 4 erros, veio ${erros.length}`)

  const texto = textoDaFalhaDeAmbiente(erros)
  for (const nome of nomes) assert.ok(texto.includes(nome), `${nome} sumiu da mensagem final`)
})

test('a mensagem de falha nunca ecoa um valor — só nomes', () => {
  /* Log de hospedagem é lido por muita gente e guardado por muito tempo. Um
   * segredo que vaza por uma mensagem de erro vaza para sempre. */
  const segredos = [
    'senha-secreta-nao-pode-vazar',
    'chave-secreta-nao-pode-vazar',
    'token-secreto-nao-pode-vazar',
  ]
  const { erros, avisos } = conferirAmbiente({
    NODE_ENV: 'production',
    DATABASE_URL: `mysql://u:${segredos[0]}@host/db`,       // esquema errado
    ENCRYPTION_SECRET: `zz${segredos[1]}`,                   // não é hex
    APP_URL: `nao-e-url-${segredos[2]}`,                     // não é URL
    AUTH_SECRET: 'ok',
    RESEND_API_KEY: 'chave',
    RESEND_FROM_EMAIL: 'alguem@yourdomain.com',              // domínio de exemplo
  }, true)

  const tudo = [textoDaFalhaDeAmbiente(erros), ...avisos].join('\n')
  for (const segredo of segredos) {
    assert.ok(!tudo.includes(segredo), `o valor "${segredo}" apareceu na mensagem`)
  }
  // ...e mesmo assim as quatro variáveis foram nomeadas.
  for (const nome of ['DATABASE_URL', 'ENCRYPTION_SECRET', 'APP_URL', 'RESEND_FROM_EMAIL']) {
    assert.ok(tudo.includes(nome), `${nome} deveria ter sido nomeada`)
  }
})

test('APP_ROOT_DOMAIN vazia não gera aviso nenhum — é o estado correto', () => {
  /* Avisar sobre algo que deve ficar vazio ensina o operador a ignorar o log.
   * Foi por este caso que o nível "opcional" existe separado de "recomendada". */
  const { erros, avisos } = conferirAmbiente(ambienteBom(), true)
  assert.deepEqual(erros, [])
  assert.ok(!avisos.some(a => a.includes('APP_ROOT_DOMAIN')), avisos.join(' | '))
})

test('APP_ROOT_DOMAIN preenchida é conferida', () => {
  const comUrl = conferirAmbiente(ambienteBom({ APP_ROOT_DOMAIN: 'https://mult10.com.br' }), true)
  assert.ok(comUrl.erros.some(e => e.includes('APP_ROOT_DOMAIN')))

  const semPonto = conferirAmbiente(ambienteBom({ APP_ROOT_DOMAIN: 'localhost' }), true)
  assert.ok(semPonto.erros.some(e => e.includes('APP_ROOT_DOMAIN')))

  const boa = conferirAmbiente(ambienteBom({ APP_ROOT_DOMAIN: 'mult10.com.br' }), true)
  assert.deepEqual(boa.erros, [])
})

test('CRON_SECRET e RESEND_API_KEY faltando são aviso, nunca erro', () => {
  /* O sync diário e o e-mail param; o painel não. Derrubar o servidor inteiro
   * por causa deles seria desproporcional — e é a diferença entre "o produto
   * está degradado" e "o produto está fora do ar". */
  const env = ambienteBom()
  delete env.CRON_SECRET
  delete env.RESEND_API_KEY
  delete env.RESEND_FROM_EMAIL   // sem chave, o remetente deixa de ser exigido
  const { erros, avisos } = conferirAmbiente(env, true)
  assert.deepEqual(erros, [], erros.join(' | '))
  assert.ok(avisos.some(a => a.includes('CRON_SECRET')))
  assert.ok(avisos.some(a => a.includes('RESEND_API_KEY')))
})

test('RESEND_FROM_EMAIL só é exigida quando existe RESEND_API_KEY', () => {
  const semNenhuma = ambienteBom()
  delete semNenhuma.RESEND_API_KEY
  delete semNenhuma.RESEND_FROM_EMAIL
  assert.deepEqual(conferirAmbiente(semNenhuma, true).erros, [])

  const chaveSemRemetente = ambienteBom()
  delete chaveSemRemetente.RESEND_FROM_EMAIL
  const { erros } = conferirAmbiente(chaveSemRemetente, true)
  assert.equal(erros.length, 1)
  assert.ok(erros[0].includes('RESEND_FROM_EMAIL'))
})

test('AUTH_SECRET ou NEXTAUTH_SECRET: uma basta, nenhuma é erro', () => {
  const soNova = ambienteBom()
  assert.deepEqual(conferirAmbiente(soNova, true).erros, [])

  const soAntiga = ambienteBom({ NEXTAUTH_SECRET: 'segredo-de-mentira-para-teste' })
  delete soAntiga.AUTH_SECRET
  assert.deepEqual(conferirAmbiente(soAntiga, true).erros, [])

  const nenhuma = ambienteBom()
  delete nenhuma.AUTH_SECRET
  const { erros } = conferirAmbiente(nenhuma, true)
  assert.equal(erros.length, 1)
  assert.ok(erros[0].includes('AUTH_SECRET') && erros[0].includes('NEXTAUTH_SECRET'))
})

test('NEXTAUTH_URL e AUTH_URL definidas derrubam o arranque', () => {
  /* O .env.example manda em letras garrafais nunca definir essas duas, e até
   * agora nada impedia — pior, lib/origin.ts usava NEXTAUTH_URL como reserva,
   * o que convidava a definir. */
  for (const nome of ['NEXTAUTH_URL', 'AUTH_URL']) {
    const { erros } = conferirAmbiente(ambienteBom({ [nome]: 'https://app.exemplo.com.br' }), true)
    assert.equal(erros.length, 1, `${nome}: ${erros.join(' | ')}`)
    assert.ok(erros[0].includes(nome))
  }
})

test('valor só com espaço conta como ausente', () => {
  /* Variável de ambiente com espaço sobrando é truthy. Sem `trim`, '   ' passaria
   * por valor preenchido e o erro viria muito depois, de outro lugar. */
  const { erros } = conferirAmbiente(ambienteBom({ DATABASE_URL: '   ' }), true)
  assert.equal(erros.length, 1)
  assert.ok(erros[0].includes('DATABASE_URL') && erros[0].includes('não está definida'))
})

test('DATABASE_URL com libsql:// do Turso antigo é recusada', () => {
  const { erros } = conferirAmbiente(ambienteBom({ DATABASE_URL: 'libsql://algo.turso.io' }), true)
  assert.equal(erros.length, 1)
  assert.ok(erros[0].includes('DATABASE_URL'))
})

test('APP_URL apontando para localhost em produção é aviso, não erro', () => {
  const producao = conferirAmbiente(ambienteBom({ APP_URL: 'http://localhost:3000' }), true)
  assert.deepEqual(producao.erros, [])
  assert.ok(producao.avisos.some(a => a.includes('APP_URL')))

  // Em desenvolvimento é o valor certo, e avisar seria ruído em todo `next dev`.
  const local = conferirAmbiente(ambienteBom({ APP_URL: 'http://localhost:3000' }), false)
  assert.ok(!local.avisos.some(a => a.includes('APP_URL')), local.avisos.join(' | '))
})

/* ─── ENCRYPTION_SECRET: a regra é a de lib/crypto.ts, não uma inventada ───── */

test('bytesDeHex concorda com Buffer.from(x, "hex") em todo caso de borda', () => {
  /* É esta igualdade que impede a validação de recusar um ENCRYPTION_SECRET que
   * lib/crypto.ts aceitaria — o que transformaria "a criptografia falha" em "o
   * app não sobe", um negócio muito pior. A regra da issue #105 ("64 caracteres
   * hex") é mais estrita do que a do código: o Node aceita 65 e 66 também. */
  const casos = [
    '',
    'a',
    'ab',
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'a'.repeat(66),
    'A'.repeat(64),
    'z'.repeat(64),
    'a'.repeat(64) + 'zz',
    '  ' + 'a'.repeat(64),
    'a'.repeat(64) + ' ',
    '0123456789abcdefABCDEF',
    'gg',
    HEX_32_BYTES,
  ]
  for (const caso of casos) {
    assert.equal(
      bytesDeHex(caso),
      Buffer.from(caso, 'hex').length,
      `divergiram para uma entrada de ${caso.length} caracteres`,
    )
  }
})

test('ENCRYPTION_SECRET: 32 bytes passa, o resto é erro', () => {
  assert.deepEqual(conferirAmbiente(ambienteBom(), true).erros, [])

  for (const ruim of ['a'.repeat(63), 'z'.repeat(64), 'nao-e-hex']) {
    const { erros } = conferirAmbiente(ambienteBom({ ENCRYPTION_SECRET: ruim }), true)
    assert.equal(erros.length, 1, `${ruim.slice(0, 8)}…: ${erros.join(' | ')}`)
    assert.ok(erros[0].includes('ENCRYPTION_SECRET'))
  }
})

test('ENCRYPTION_SECRET com caractere a mais funciona, mas avisa', () => {
  /* 65 caracteres dão os mesmos 32 bytes que 64: o Node decodifica os pares do
   * começo e descarta o dígito ímpar sobrando, calado.
   * Quem colou um caractere a mais acha que trocou a chave e não trocou. Não é
   * erro (a chave FUNCIONA), é aviso. */
  const { erros, avisos } = conferirAmbiente(ambienteBom({ ENCRYPTION_SECRET: HEX_32_BYTES + 'f' }), true)
  assert.deepEqual(erros, [])
  assert.ok(avisos.some(a => a.includes('ENCRYPTION_SECRET')), avisos.join(' | '))
})

/* ─── O portão que impede o apagão do `next build` ─────────────────────────── */

test('modoDeVerificacao ignora o build por dois sinais independentes', () => {
  assert.equal(modoDeVerificacao({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }), 'ignorar')
  assert.equal(modoDeVerificacao({ NODE_ENV: 'production', IS_NEXT_WORKER: 'true' }), 'ignorar')
  // Cada sinal sozinho basta: se uma atualização do Next parar de definir um, o outro segura.
  assert.equal(modoDeVerificacao({ NODE_ENV: 'production' }), 'exigir')
  assert.equal(modoDeVerificacao({ NODE_ENV: 'development' }), 'avisar')
  assert.equal(modoDeVerificacao({}), 'avisar')
  assert.equal(modoDeVerificacao({ NODE_ENV: 'test' }), 'avisar')
})

/* ─── Configuração de e-mail ──────────────────────────────────────────────── */

test('sem RESEND_API_KEY: desligado fora de produção, quebrado dentro', () => {
  assert.equal(configuracaoDeEmail({ NODE_ENV: 'development' }).estado, 'desligado')
  assert.equal(configuracaoDeEmail({}).estado, 'desligado')
  assert.equal(configuracaoDeEmail({ NODE_ENV: 'production' }).estado, 'quebrado')
})

test('chave sem remetente é quebrado — a configuração pela metade que causou a issue', () => {
  const c = configuracaoDeEmail({ RESEND_API_KEY: 're_chave_de_mentira' })
  assert.equal(c.estado, 'quebrado')
  assert.ok(c.estado === 'quebrado' && c.motivo.includes('RESEND_FROM_EMAIL'))
})

test('o remetente de reserva que existia no código é recusado', () => {
  /* `noreply@yourdomain.com` era o valor escrito à mão nas duas rotas. Mesmo que
   * alguém o cole na variável de ambiente, ele não passa. */
  for (const placeholder of [
    'noreply@yourdomain.com',
    'Suporte <noreply@yourdomain.com>',
    'alguem@example.com',
    'alguem@exemplo.com.br',
  ]) {
    const c = configuracaoDeEmail({ RESEND_API_KEY: 're_chave_de_mentira', RESEND_FROM_EMAIL: placeholder })
    assert.equal(c.estado, 'quebrado', `${placeholder} deveria ser recusado`)
  }
})

test('remetente com nome — `Nome <a@b>` — é aceito', () => {
  /* A Resend aceita as duas formas, e a produção pode estar usando a segunda.
   * Recusá-la seria quebrar o que funciona hoje. */
  const c = configuracaoDeEmail({
    RESEND_API_KEY: 're_chave_de_mentira',
    RESEND_FROM_EMAIL: 'Mult10 <nao-responda@mult10.com.br>',
  })
  assert.equal(c.estado, 'pronto')
  assert.ok(c.estado === 'pronto' && c.remetente === 'Mult10 <nao-responda@mult10.com.br>')
})

test('enderecoDoRemetente extrai o endereço e recusa o que não é endereço', () => {
  assert.equal(enderecoDoRemetente('a@b.com'), 'a@b.com')
  assert.equal(enderecoDoRemetente('Nome Sobrenome <a@b.com>'), 'a@b.com')
  assert.equal(enderecoDoRemetente('  a@b.com  '), 'a@b.com')
  assert.equal(enderecoDoRemetente('sem-arroba'), null)
  assert.equal(enderecoDoRemetente('a@semponto'), null)
  assert.equal(enderecoDoRemetente('a b@c.com'), null)
  assert.equal(enderecoDoRemetente(''), null)
})

/* ─── Invariantes do catálogo ─────────────────────────────────────────────── */

test('o catálogo não tem nome repetido e todo nome é MAIÚSCULA_COM_UNDERSCORE', () => {
  const nomes = CATALOGO.map(v => v.nome)
  assert.equal(new Set(nomes).size, nomes.length, 'há nome repetido no catálogo')
  for (const nome of nomes) {
    assert.match(nome, /^[A-Z][A-Z0-9_]*$/, `${nome} não parece nome de variável de ambiente`)
  }
})

test('toda variável do catálogo explica para que serve', () => {
  /* A frase `para` vai direto para a mensagem que o operador lê às três da
   * manhã. Uma entrada sem explicação é uma entrada inútil. */
  for (const v of CATALOGO) {
    assert.ok(v.para.length > 30, `${v.nome}: a explicação está curta demais`)
  }
})

test('variável proibida nunca é documentada como preenchível', () => {
  for (const v of CATALOGO) {
    if (v.nivel === 'proibida') {
      assert.equal(v.documentar, false, `${v.nome} é proibida e não pode ter linha NOME= no .env.example`)
    }
  }
})

test('todo nome citado em GRUPOS_OU existe no catálogo', () => {
  const nomes = new Set(CATALOGO.map(v => v.nome))
  for (const grupo of GRUPOS_OU) {
    for (const nome of grupo.nomes) {
      assert.ok(nomes.has(nome), `${nome} está em GRUPOS_OU e não no catálogo`)
    }
  }
})

/* O remetente que a produção usa HOJE. Não é um caso hipotético: descobri isto
 * conferindo o serviço real, e é a diferença entre "o e-mail sai" e "o e-mail
 * chega". O domínio pronto da Resend não é verificado, então ela só entrega para
 * o endereço dono da conta — recuperação de senha e convite não chegam a mais
 * ninguém, e nada na tela sugere isso. */
test('o domínio de teste da Resend vira aviso em produção, e não derruba', () => {
  const env = ambienteBom({ RESEND_FROM_EMAIL: 'nao-responda@resend.dev' })
  const { erros, avisos } = conferirAmbiente(env, true)

  assert.equal(erros.length, 0, 'ele funciona — derrubar o app seria desproporcional')
  assert.ok(avisos.some(a => /resend\.dev/.test(a) && /dono da conta/.test(a)),
    'mas o operador precisa saber que o e-mail não chega a mais ninguém')
})

test('APP_ROOT_DOMAIN no domínio da hospedagem vira aviso', () => {
  /* Com ela assim, QUALQUER aplicação daquela hospedagem passa a ser host
   * confiável para link de e-mail com token dentro. */
  const env = ambienteBom({ APP_ROOT_DOMAIN: 'up.railway.app' })
  const { erros, avisos } = conferirAmbiente(env, true)

  assert.equal(erros.length, 0)
  assert.ok(avisos.some(a => /APP_ROOT_DOMAIN/.test(a) && /compartilhado/.test(a)),
    'o aviso tem de nomear a variável e a causa')
})
