import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* QUANDO o Next chama `register()` — provado contra o pacote instalado.
 *
 * Toda a segurança de `instrumentation.ts` depende de uma afirmação: o
 * `next build` NÃO executa o hook. Se executasse, a conferência de ambiente
 * estouraria no passo "collecting page data" e o deploy morreria — o mesmo
 * apagão que a criação do cliente de banco na importação do módulo já causou,
 * com uma fantasia nova. A CI constrói de propósito sem variável de banco
 * nenhuma (.github/workflows/ci.yml) justamente para segurar esse caso.
 *
 * Só que "o Next não chama no build" é uma frase de blog. Aqui ela é executada:
 * este arquivo carrega o módulo REAL do Next instalado
 * (next/dist/server/lib/router-utils/instrumentation-globals.external.js), monta
 * um projeto de mentira com um `instrumentation.js` que marca presença, e
 * observa. Se uma atualização do Next remover a guarda, este teste fica vermelho
 * antes de o deploy ficar.
 *
 * Nada aqui sobe servidor, abre porta ou toca no projeto: só um diretório
 * temporário e o módulo do Next carregado como biblioteca. */

/* Chamado `carregar`, e não `require`: uma variável com esse nome faz o
 * @typescript-eslint/no-require-imports acender em todo uso, e o teto de avisos
 * do lint é um número que só desce. */
const carregar = createRequire(import.meta.url)
const MODULO_DO_NEXT = carregar.resolve(
  'next/dist/server/lib/router-utils/instrumentation-globals.external.js',
)

interface ModuloDeInstrumentacao {
  ensureInstrumentationRegistered: (projectDir: string, distDir: string) => Promise<void>
}

type Marcador = { chamou: boolean }

const temporarios: string[] = []

/** Um projeto compilado de mentira: só o `instrumentation.js` que o Next
 *  procuraria em `<projeto>/.next/server/`. */
function projetoComHook(chave: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'instrumentacao-'))
  temporarios.push(dir)
  mkdirSync(join(dir, '.next', 'server'), { recursive: true })
  writeFileSync(
    join(dir, '.next', 'server', 'instrumentation.js'),
    `exports.register = function () { globalThis[${JSON.stringify(chave)}].chamou = true }\n`,
  )
  return dir
}

/** Um `instrumentation.js` que estoura, como o nosso estouraria com o ambiente
 *  errado — para provar que o estouro REALMENTE derruba quem chamou. */
function projetoComHookQueEstoura(): string {
  const dir = mkdtempSync(join(tmpdir(), 'instrumentacao-'))
  temporarios.push(dir)
  mkdirSync(join(dir, '.next', 'server'), { recursive: true })
  writeFileSync(
    join(dir, '.next', 'server', 'instrumentation.js'),
    'exports.register = function () { throw new Error("ambiente invalido de mentira") }\n',
  )
  return dir
}

/**
 * Carrega o módulo do Next DO ZERO e roda o cenário.
 *
 * O `delete carregar.cache[...]` não é preciosismo: aquele módulo guarda o
 * resultado do registro em variáveis de escopo de módulo
 * (`registerInstrumentationPromise`, `instrumentationModulePromise`), de modo que
 * a segunda chamada devolveria a primeira resposta e o segundo cenário mediria o
 * primeiro.
 */
async function comAmbiente<T>(
  fase: string | undefined,
  acao: (mod: ModuloDeInstrumentacao) => Promise<T>,
): Promise<T> {
  const anterior = process.env.NEXT_PHASE
  if (fase === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = fase
  delete carregar.cache[MODULO_DO_NEXT]
  try {
    return await acao(carregar(MODULO_DO_NEXT) as ModuloDeInstrumentacao)
  } finally {
    delete carregar.cache[MODULO_DO_NEXT]
    if (anterior === undefined) delete process.env.NEXT_PHASE
    else process.env.NEXT_PHASE = anterior
  }
}

function marcador(chave: string): Marcador {
  const alvo = globalThis as unknown as Record<string, Marcador>
  alvo[chave] = { chamou: false }
  return alvo[chave]
}

test('NEXT_PHASE=phase-production-build: o Next NÃO chama register()', async () => {
  /* A afirmação em que `instrumentation.ts` inteiro se apoia. O `next build`
   * define essa variável em next/dist/build/index.js logo antes de abrir os
   * processos que coletam os dados das páginas — os mesmos que derrubaram o
   * deploy da outra vez. */
  const chave = '__marcadorNoBuild'
  const visto = marcador(chave)
  const projeto = projetoComHook(chave)

  await comAmbiente('phase-production-build', mod =>
    mod.ensureInstrumentationRegistered(projeto, '.next'),
  )

  assert.equal(visto.chamou, false, 'o Next chamou register() durante o build — a guarda sumiu')
})

test('sem NEXT_PHASE (servidor subindo): o Next CHAMA register()', async () => {
  /* O contraponto. Sem ele, o teste acima passaria também se o hook nunca fosse
   * chamado em situação nenhuma — por exemplo se o caminho do arquivo estivesse
   * errado e o módulo silenciosamente não achasse nada (ele engole ENOENT). */
  const chave = '__marcadorNoServidor'
  const visto = marcador(chave)
  const projeto = projetoComHook(chave)

  await comAmbiente(undefined, mod => mod.ensureInstrumentationRegistered(projeto, '.next'))

  assert.equal(visto.chamou, true, 'o Next não chamou register() no arranque do servidor')
})

test('um register() que estoura derruba quem o chamou — por isso o portão existe', async () => {
  /* Prova que a consequência é real: se a conferência de ambiente rodasse no
   * build e reprovasse, o `next build` morreria com ela. É a diferença entre
   * "cuidado teórico" e "cuidado necessário". */
  const projeto = projetoComHookQueEstoura()

  await assert.rejects(
    comAmbiente(undefined, mod => mod.ensureInstrumentationRegistered(projeto, '.next')),
    /ambiente invalido de mentira/,
  )
})

test('o mesmo register() que estoura passa batido durante o build', async () => {
  const projeto = projetoComHookQueEstoura()
  await comAmbiente('phase-production-build', mod =>
    mod.ensureInstrumentationRegistered(projeto, '.next'),
  )
  // Chegar aqui sem rejeitar É o resultado.
})

test('IS_NEXT_WORKER continua sendo carimbado pelo Next nos processos do build', async () => {
  /* O segundo sinal de `modoDeVerificacao`. Não é chamada de função, é leitura
   * do fonte instalado: next/dist/lib/worker.js monta o ambiente de cada
   * processo filho com `IS_NEXT_WORKER: 'true'`. Se uma atualização trocar o
   * nome, o portão perde uma das duas trancas — e é bom saber. */
  const { readFileSync } = await import('node:fs')
  const fonte = readFileSync(carregar.resolve('next/dist/lib/worker.js'), 'utf8')
  assert.match(fonte, /IS_NEXT_WORKER:\s*'true'/)
})

test('o Next define NEXT_PHASE antes de abrir os processos do build', async () => {
  /* A herança é o que faz o sinal chegar aos filhos: o `env` deles é
   * `{ ...process.env, IS_NEXT_WORKER: 'true', ... }`. Se a atribuição saísse de
   * lugar, ou a herança acabasse, os dois sinais ficariam frouxos ao mesmo
   * tempo. */
  const { readFileSync } = await import('node:fs')
  const build = readFileSync(carregar.resolve('next/dist/build/index.js'), 'utf8')
  const posicaoDaFase = build.indexOf('process.env.NEXT_PHASE = ')
  /* `= createStaticWorker(` casa só a CHAMADA; `function createStaticWorker(`,
   * a definição, aparece bem antes no arquivo e daria a ordem errada. */
  const posicaoDoWorker = build.indexOf('= createStaticWorker(')
  assert.ok(posicaoDaFase > 0, 'next/dist/build/index.js não define mais NEXT_PHASE')
  assert.ok(posicaoDoWorker > 0, 'next/dist/build/index.js não chama mais createStaticWorker — confira a ordem na mão')
  assert.ok(
    posicaoDaFase < posicaoDoWorker,
    'NEXT_PHASE passou a ser definida DEPOIS de abrir os processos do build',
  )

  const worker = readFileSync(carregar.resolve('next/dist/lib/worker.js'), 'utf8')
  assert.match(worker, /env:\s*\{\s*\.\.\.process\.env/)
})

after(() => {
  for (const dir of temporarios) rmSync(dir, { recursive: true, force: true })
  temporarios.length = 0
})
