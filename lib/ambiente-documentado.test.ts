import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { CATALOGO, type Variavel } from '@/lib/ambiente'

/* `.env.example` e o código não podem se afastar em silêncio.
 *
 * Era exatamente o que estava acontecendo: o arquivo anunciava ANTHROPIC_API_KEY,
 * que nenhuma linha lê há tempo (a chave da Anthropic vive cifrada no banco), e
 * não dizia uma palavra sobre MASTER_EMAIL, MASTER_PASSWORD, TENANT_300_EMAIL e
 * TENANT_300_PASSWORD, sem as quais dois scripts de npm não rodam. Nada avisava,
 * porque nada comparava os dois lados.
 *
 * Este teste compara TRÊS lados, e reprova quando qualquer par discorda:
 *
 *   código        todo acesso a `process.env.<NOME>` em todo arquivo do repo
 *   catálogo      lib/ambiente.ts, a lista que o servidor confere no arranque
 *   .env.example  o que o operador lê
 *
 * (Nas frases acima o nome vai como `<NOME>` de propósito: escrito por extenso,
 * o texto deste comentário viraria uma leitura falsa para a própria varredura.)
 *
 * As regras:
 *   1. Nome lido pelo código PRECISA existir no catálogo.
 *   2. Catálogo com `documentar: true` PRECISA ter uma linha `NOME=` no exemplo.
 *   3. Linha `NOME=` no exemplo PRECISA ser um nome do catálogo com `documentar`.
 *   4. Variável proibida PRECISA ser citada no texto e NUNCA ter linha `NOME=`.
 */

const RAIZ = fileURLToPath(new URL('../', import.meta.url))

const PASTAS_IGNORADAS = new Set([
  'node_modules', '.next', '.git', '.claude', 'drizzle', 'design-handoff', 'public',
])
const EXTENSOES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx']

function arquivosDoRepositorio(dir = RAIZ, encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (PASTAS_IGNORADAS.has(entrada.name)) continue
      arquivosDoRepositorio(join(dir, entrada.name), encontrados)
    } else if (EXTENSOES.some(ext => entrada.name.endsWith(ext))) {
      encontrados.push(join(dir, entrada.name))
    }
  }
  return encontrados
}

/* Os padrões são montados por concatenação de propósito: escritos inteiros, o
 * texto literal deles apareceria neste arquivo e a varredura encontraria a si
 * mesma, inventando nomes que ninguém lê. Com o `+` no meio, a sequência que o
 * padrão procura não existe em lugar nenhum daqui. */
const ACESSO_POR_PONTO = 'process' + '\\.env\\.([A-Za-z_][A-Za-z0-9_]*)'
const ACESSO_POR_COLCHETE = 'process' + '\\.env\\[[\'"]([A-Za-z_][A-Za-z0-9_]*)[\'"]\\]'

function nomesLidosPeloCodigo(): Map<string, string[]> {
  const ondeAparece = new Map<string, string[]>()
  for (const arquivo of arquivosDoRepositorio()) {
    const texto = readFileSync(arquivo, 'utf8')
    for (const padrao of [ACESSO_POR_PONTO, ACESSO_POR_COLCHETE]) {
      for (const achado of texto.matchAll(new RegExp(padrao, 'g'))) {
        const nome = achado[1]
        const lista = ondeAparece.get(nome) ?? []
        const curto = arquivo.slice(RAIZ.length).replace(/\\/g, '/')
        if (!lista.includes(curto)) lista.push(curto)
        ondeAparece.set(nome, lista)
      }
    }
  }
  return ondeAparece
}

/** Só linhas de atribuição de verdade. Comentário começa com `#` e não conta —
 *  é o que permite ao arquivo CITAR as proibidas sem documentá-las. */
function chavesDoExemplo(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map(linha => linha.match(/^([A-Za-z_][A-Za-z0-9_]*)=/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => m[1])
}

interface Deriva {
  semCatalogo: string[]
  semLinhaNoExemplo: string[]
  sobrandoNoExemplo: string[]
}

/** O coração do teste, isolado para poder ser alimentado com dados falsos e
 *  provar que ele REPROVA quando deve. Comparação sem essa prova é enfeite. */
function compararDeriva(
  lidasNoCodigo: Iterable<string>,
  noExemplo: Iterable<string>,
  catalogo: readonly Variavel[],
): Deriva {
  const doCatalogo = new Set(catalogo.map(v => v.nome))
  const documentadas = new Set(catalogo.filter(v => v.documentar).map(v => v.nome))
  const exemplo = new Set(noExemplo)

  return {
    semCatalogo: [...lidasNoCodigo].filter(n => !doCatalogo.has(n)).sort(),
    semLinhaNoExemplo: [...documentadas].filter(n => !exemplo.has(n)).sort(),
    sobrandoNoExemplo: [...exemplo].filter(n => !documentadas.has(n)).sort(),
  }
}

const TEXTO_DO_EXEMPLO = readFileSync(join(RAIZ, '.env.example'), 'utf8')
const CHAVES = chavesDoExemplo(TEXTO_DO_EXEMPLO)
const LIDAS = nomesLidosPeloCodigo()

/* ─── Não é vazio ─────────────────────────────────────────────────────────── */

test('a varredura realmente encontra coisa — os três lados têm tamanho de verdade', () => {
  /* Sem estes números, uma varredura quebrada (pasta errada, padrão que nunca
   * casa) passaria por "nenhuma deriva encontrada" e o teste viraria enfeite. */
  const arquivos = arquivosDoRepositorio()
  assert.ok(arquivos.length > 100, `varreu só ${arquivos.length} arquivos — algo está errado no caminho`)
  assert.ok(LIDAS.size >= 12, `só ${LIDAS.size} nomes lidos no código: ${[...LIDAS.keys()].join(', ')}`)
  assert.ok(CHAVES.length >= 15, `só ${CHAVES.length} chaves em .env.example`)
  assert.ok(CATALOGO.length >= 20, `só ${CATALOGO.length} entradas no catálogo`)

  // E encontra nomes que sabemos existir, em arquivos que sabemos quais são.
  assert.ok(LIDAS.get('DATABASE_URL')?.some(f => f === 'lib/db/index.ts'), [...(LIDAS.get('DATABASE_URL') ?? [])].join(', '))
  assert.ok(LIDAS.get('ENCRYPTION_SECRET')?.some(f => f === 'lib/crypto.ts'))
  assert.ok(LIDAS.get('APP_URL')?.some(f => f === 'lib/origin.ts'))
})

test('a varredura não encontra a si mesma', () => {
  /* Os padrões são montados com `+`. Se alguém "arrumar" isso escrevendo-os
   * inteiros, este arquivo passa a casar consigo e inventa nomes fantasmas. */
  const nomesFantasma = ['ACESSO_POR_PONTO', 'ACESSO_POR_COLCHETE', 'A', 'Za']
  for (const fantasma of nomesFantasma) {
    assert.ok(!LIDAS.has(fantasma), `a varredura casou com o próprio padrão e colheu "${fantasma}"`)
  }
})

/* ─── A comparação reprova quando deve ────────────────────────────────────── */

test('compararDeriva acusa nome lido pelo código e ausente do catálogo', () => {
  const d = compararDeriva(['DATABASE_URL', 'VARIAVEL_QUE_NINGUEM_CADASTROU'], ['DATABASE_URL'], CATALOGO)
  assert.deepEqual(d.semCatalogo, ['VARIAVEL_QUE_NINGUEM_CADASTROU'])
})

test('compararDeriva acusa entrada do catálogo sem linha no .env.example', () => {
  const semUma = CHAVES.filter(c => c !== 'DATABASE_URL')
  const d = compararDeriva([], semUma, CATALOGO)
  assert.deepEqual(d.semLinhaNoExemplo, ['DATABASE_URL'])
})

test('compararDeriva acusa linha no .env.example sem entrada no catálogo', () => {
  const d = compararDeriva([], [...CHAVES, 'SOBRA_ANTIGA'], CATALOGO)
  assert.deepEqual(d.sobrandoNoExemplo, ['SOBRA_ANTIGA'])
})

test('compararDeriva acusa quando a entrada some do catálogo, não só do arquivo', () => {
  const catalogoPodado = CATALOGO.filter(v => v.nome !== 'APP_URL')
  const d = compararDeriva(['APP_URL'], CHAVES, catalogoPodado)
  assert.deepEqual(d.semCatalogo, ['APP_URL'])
  assert.deepEqual(d.sobrandoNoExemplo, ['APP_URL'])
})

/* ─── E, com os dados de verdade, não acusa nada ──────────────────────────── */

test('código, catálogo e .env.example estão sincronizados', () => {
  const d = compararDeriva(LIDAS.keys(), CHAVES, CATALOGO)

  assert.deepEqual(
    d.semCatalogo, [],
    'lidas pelo código e ausentes do catálogo de lib/ambiente.ts: ' +
      d.semCatalogo.map(n => `${n} (${LIDAS.get(n)?.join(', ')})`).join(' | '),
  )
  assert.deepEqual(d.semLinhaNoExemplo, [], 'no catálogo com documentar:true e sem linha NOME= no .env.example')
  assert.deepEqual(d.sobrandoNoExemplo, [], 'com linha NOME= no .env.example e sem entrada documentada no catálogo')
})

test('.env.example não repete chave', () => {
  assert.equal(new Set(CHAVES).size, CHAVES.length, `chave repetida: ${CHAVES.join(', ')}`)
})

/* ─── As proibidas: citadas, nunca atribuídas ─────────────────────────────── */

test('toda variável proibida é citada no .env.example e nunca ganha linha NOME=', () => {
  const proibidas = CATALOGO.filter(v => v.nivel === 'proibida').map(v => v.nome)
  assert.ok(proibidas.length >= 2, `esperava pelo menos duas proibidas, veio ${proibidas.length}`)

  for (const nome of proibidas) {
    assert.ok(
      TEXTO_DO_EXEMPLO.includes(nome),
      `${nome} é proibida e não aparece em .env.example — quem lê o arquivo não fica sabendo`,
    )
    assert.ok(
      !CHAVES.includes(nome),
      `${nome} é proibida e tem linha ${nome}= no .env.example, que é um convite a defini-la`,
    )
  }
})

test('ANTHROPIC_API_KEY saiu do .env.example junto com o código que a lia', () => {
  /* Guarda contra o retorno do exato caso que motivou este teste: o arquivo
   * anunciava a variável e nenhuma linha a lia (a chave por cliente vive
   * cifrada no banco, app/api/ai-chat/route.ts). */
  assert.ok(!CHAVES.includes('ANTHROPIC_API_KEY'))
  assert.ok(!LIDAS.has('ANTHROPIC_API_KEY'))
})

test('nenhuma TURSO_* sobrou no código — o banco é Postgres', () => {
  const turso = [...LIDAS.keys()].filter(n => n.startsWith('TURSO_'))
  assert.deepEqual(turso, [], `ainda há leitura de ${turso.join(', ')}`)
})
