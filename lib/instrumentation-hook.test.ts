/* O gancho `register()` de instrumentation.ts, exercitado de verdade.
 *
 * Por que este arquivo existe: `npm test` roda `lib/**\/*.test.ts`, e o gancho mora
 * na RAIZ do projeto — fora do alcance do glob. Resultado: o arquivo de que a
 * conferência inteira depende era o único que nenhum teste tocava. A revisão
 * independente provou o estrago com duas mutações que deixavam os 405 testes
 * verdes:
 *
 *   - pôr um `return` no começo do `register()` → a conferência nunca roda, em
 *     ambiente nenhum, e o lote vira enfeite em silêncio;
 *   - apagar a guarda de `NEXT_RUNTIME === 'edge'` → a conferência entra no pacote
 *     da borda, onde o middleware roda em quase toda rota e as variáveis do
 *     servidor podem nem existir. O app sobe bem e serve 500 em tudo.
 *
 * Cada cenário roda num processo próprio porque o gancho lê `process.env.NEXT_RUNTIME`
 * na primeira avaliação e o módulo fica em cache: reimportar no mesmo processo
 * mediria o primeiro cenário três vezes. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CATALOGO } from '@/lib/ambiente'

const RAIZ = process.cwd()

/** O ambiente do processo atual sem nenhuma variável da aplicação. */
function limpo(): Record<string, string> {
  const fora = new Set(CATALOGO.map(v => v.nome))
  const heranca = process.env as Record<string, string | undefined>
  const saida: Record<string, string> = {}
  for (const chave of Object.keys(heranca)) {
    const valor = heranca[chave]
    if (!fora.has(chave) && typeof valor === 'string') saida[chave] = valor
  }
  return saida
}

/** Roda `register()` num processo limpo, com o ambiente dado, e diz o que houve. */
function rodarRegister(cenario: Record<string, string>): { estourou: boolean; saida: string } {
  /* Caminho como URL de arquivo: no Windows, `C:/...` não é esquema de módulo
   * válido para o carregador de ESM. */
  const alvo = pathToFileURL(join(RAIZ, 'instrumentation.ts')).href
  const script = `
    /* O tsx entrega este módulo em formato CommonJS (o package.json nao declara
       type module), então o register chega sob default. Aceitamos as duas
       formas para o teste não depender do transpilador. */
    // Aviso vai para stderr, e aqui só se lê stdout: redireciona para não perder
    // justamente a lista que o teste quer conferir.
    console.warn = (...a) => console.log(...a)
    const mod = await import(${JSON.stringify(alvo)})
    const register = mod.register ?? mod.default?.register
    if (typeof register !== 'function') {
      console.log('RESULTADO:sem-register')
      process.exit(0)
    }
    try {
      await register()
      console.log('RESULTADO:resolveu')
    } catch (e) {
      console.log('RESULTADO:estourou')
      console.log(String(e && e.message).slice(0, 400))
    }
  `
  const saida = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    {
      cwd: RAIZ,
      encoding: 'utf8',
      /* Herda o necessário para o Node rodar (PATH e afins), mas APAGA toda variável
       * que o catálogo conhece — senão o ambiente de quem roda os testes decidiria o
       * resultado. Lido por índice de propósito: escrever o nome da variável colado em `process` e `env` por extenso faria o teste de deriva acusar este arquivo, com razão, de ler uma
       * variável que ninguém documenta. */
      env: { ...limpo(), ...cenario } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  return { estourou: saida.includes('RESULTADO:estourou'), saida }
}

test('em produção, ambiente incompleto DERRUBA o arranque', () => {
  const { estourou, saida } = rodarRegister({ NODE_ENV: 'production' })

  assert.ok(estourou,
    'register() tem de estourar: sem isto a conferência é enfeite e o app sobe quebrado')
  // E a mensagem precisa listar TUDO de uma vez — o operador reinicia o contêiner
  // uma vez e aprende tudo que falta, em vez de descobrir uma variável por deploy.
  for (const esperada of ['DATABASE_URL', 'ENCRYPTION_SECRET', 'APP_URL']) {
    assert.ok(saida.includes(esperada), `a falha precisa nomear ${esperada}`)
  }
})

test('durante o next build, register() NÃO confere nada', () => {
  /* É a regra que impede o apagão: o `next build` importa cada rota para coletar os
   * dados das páginas, e a CI constrói de propósito sem variável de banco nenhuma.
   * Um `register()` que estoura aqui reprova o build inteiro. */
  const { estourou } = rodarRegister({
    NODE_ENV: 'production',
    NEXT_PHASE: 'phase-production-build',
  })
  assert.equal(estourou, false, 'a conferência não pode rodar na fase de build')
})

test('nos processos filhos do build também não', () => {
  // O worker de compilação nasce ANTES de o Next definir NEXT_PHASE; o que sobra
  // para reconhecê-lo é IS_NEXT_WORKER.
  const { estourou } = rodarRegister({ NODE_ENV: 'production', IS_NEXT_WORKER: 'true' })
  assert.equal(estourou, false, 'o processo filho do build não pode conferir o ambiente')
})

test('no pacote da borda, register() sai antes de qualquer conferência', () => {
  /* O middleware roda em quase toda rota, e lá as variáveis do servidor podem não
   * existir. Sem esta saída, um ambiente perfeitamente válido serviria 500 em tudo. */
  const { estourou } = rodarRegister({ NODE_ENV: 'production', NEXT_RUNTIME: 'edge' })
  assert.equal(estourou, false, 'a borda não confere o ambiente do servidor Node')
})

test('fora de produção, o que falta vira aviso e o servidor sobe', () => {
  const { estourou, saida } = rodarRegister({ NODE_ENV: 'development' })
  assert.equal(estourou, false, 'quem está montando o ambiente local não pode ser impedido de subir')
  assert.ok(/DATABASE_URL/.test(saida), 'mas o que falta tem de aparecer no aviso')
})
