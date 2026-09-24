import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { getTableColumns, getTableName } from 'drizzle-orm'
import * as esquema from '@/lib/db/schema'

/* Rede de proteção para o ORDER BY sobre coluna ANULÁVEL.
 *
 * O comportamento está provado em lib/db/consultas.test.ts, contra Postgres de
 * verdade. Este arquivo cuida de outra coisa: impedir que um ORDER BY NOVO nasça
 * com `desc()`/`asc()` cru sobre coluna anulável — porque aí a inversão dos NULL
 * volta em silêncio, num lugar que nenhum teste de comportamento cobre ainda.
 *
 * A lista de colunas anuláveis não é escrita à mão: sai do próprio schema.
 *
 * CUIDADO COM ESTE ARQUIVO: uma versão anterior tinha um U+0008 (BACKSPACE) no
 * começo do padrão, no lugar de um `\b` — nada num arquivo-fonte vem depois de
 * um backspace, então a varredura não casava NADA e passava sempre. Daí os
 * testes de não-vacuidade abaixo: a varredura tem de dizer quantos sítios
 * inspecionou, e tem de acusar um caso plantado. */

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
const PASTAS = ['app', 'lib']

// `desc(tabela.coluna)` / `asc(tabela.coluna)` em qualquer posição — não só
// colado no `orderBy(`, para pegar também constantes de ordem e `orderBy(a, desc(b))`.
const PADRAO_DE_ORDENACAO = /\b(desc|asc)\(\s*([A-Za-z_$][\w$]*\.[\w$]+)\s*\)/g

function ordenacoesEm(texto: string): Array<{ direcao: string; coluna: string }> {
  return [...texto.matchAll(PADRAO_DE_ORDENACAO)].map(m => ({ direcao: m[1], coluna: m[2] }))
}

function arquivosTs(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, saida)
    else if ((nome.endsWith('.ts') || nome.endsWith('.tsx')) && !nome.endsWith('.test.ts')) saida.push(caminho)
  }
  return saida
}

/** `nomeDaExportacao.nomeDaPropriedade` de toda coluna que aceita NULL. */
function colunasAnulaveis(): Set<string> {
  const anulaveis = new Set<string>()
  for (const [exportacao, valor] of Object.entries(esquema)) {
    try { getTableName(valor as Parameters<typeof getTableName>[0]) } catch { continue }
    const colunas = getTableColumns(valor as Parameters<typeof getTableColumns>[0])
    for (const [propriedade, coluna] of Object.entries(colunas)) {
      if (!coluna.notNull) anulaveis.add(`${exportacao}.${propriedade}`)
    }
  }
  return anulaveis
}

test('a lista de colunas anuláveis sai do schema e não está vazia', () => {
  const anulaveis = colunasAnulaveis()
  assert.ok(anulaveis.size > 10, `achei só ${anulaveis.size} colunas anuláveis`)
  // As duas que realmente aparecem em ORDER BY hoje.
  assert.ok(anulaveis.has('contacts.lastInteractionAt'))
  assert.ok(anulaveis.has('conversations.occurredAt'))
  // Contraprova: coluna NOT NULL não pode entrar na lista.
  assert.ok(!anulaveis.has('events.occurredAt'))
  assert.ok(!anulaveis.has('blastCampaigns.createdAt'))
})

/* Não-vacuidade, parte 1: o padrão acusa o que tem de acusar. Se ele voltar a
 * ser inerte (caractere de controle, grupo trocado, `\b` comido por um escape),
 * ESTE teste falha antes de o repositório passar batido. */
test('o padrão da varredura acusa um caso plantado', () => {
  const plantado = `
    const linhas = await db.select().from(contacts)
      .orderBy(desc(contacts.lastInteractionAt))
    const outras = await db.select().from(conversations)
      .orderBy(asc(conversations.occurredAt))
  `
  const achados = ordenacoesEm(plantado)
  assert.deepEqual(achados, [
    { direcao: 'desc', coluna: 'contacts.lastInteractionAt' },
    { direcao: 'asc',  coluna: 'conversations.occurredAt' },
  ])
})

test('o padrão ignora o que não é ordenação de coluna', () => {
  assert.deepEqual(ordenacoesEm('descNulosPorUltimo(contacts.lastInteractionAt)'), [])
  assert.deepEqual(ordenacoesEm('ascNulosPrimeiro(conversations.occurredAt)'), [])
  assert.deepEqual(ordenacoesEm('// ordena desc(alguma coisa)'), [])
})

/* Não-vacuidade, parte 2: a varredura do repositório tem de ter olhado para
 * alguma coisa. Zero ordenações inspecionadas significa varredura quebrada, não
 * repositório limpo. */
test('nenhuma ordenação usa desc()/asc() cru sobre coluna anulável', () => {
  const anulaveis = colunasAnulaveis()
  const problemas: string[] = []
  let inspecionadas = 0

  for (const pasta of PASTAS) {
    for (const arquivo of arquivosTs(join(RAIZ, pasta))) {
      for (const { direcao, coluna } of ordenacoesEm(readFileSync(arquivo, 'utf8'))) {
        inspecionadas++
        if (anulaveis.has(coluna)) {
          problemas.push(`${arquivo.slice(RAIZ.length)}: ${direcao}(${coluna})`)
        }
      }
    }
  }

  assert.ok(inspecionadas > 0, 'a varredura não encontrou ordenação nenhuma — ela está quebrada')
  assert.deepEqual(
    problemas, [],
    'coluna anulável precisa de descNulosPorUltimo/ascNulosPrimeiro (lib/db/ordem.ts): ' +
      'o Postgres trata NULL como o MAIOR valor e o SQLite como o menor, então o ' +
      'desc()/asc() cru inverte as pontas da lista sem erro nenhum.',
  )
})

/* Os seis sítios, cada um pela EXPRESSÃO exata que precisa estar lá — não por
 * "o arquivo menciona o helper em algum lugar", que é o que a versão anterior
 * fazia e que continuava verde com a linha guardada revertida. */
test('os seis ORDER BY sobre coluna anulável usam a expressão certa', () => {
  const esperados: Array<[string, string]> = [
    ['lib/contacts-busca.ts',                            'descNulosPorUltimo(contacts.lastInteractionAt)'],
    ['app/api/contacts/route.ts',                        '.orderBy(ordemDeContatos)'],
    ['app/api/bi/sdr/route.ts',                          'descNulosPorUltimo(conversations.occurredAt)'],
    ['app/api/ycloud/conversations/route.ts',            'descNulosPorUltimo(conversations.occurredAt)'],
    ['app/api/ycloud/conversations/[sessionId]/route.ts', 'ascNulosPrimeiro(conversations.occurredAt)'],
    ['app/api/ycloud/messages/route.ts',                 'descNulosPorUltimo(conversations.occurredAt)'],
  ]
  for (const [relativo, expressao] of esperados) {
    const texto = readFileSync(join(RAIZ, relativo), 'utf8')
    assert.ok(texto.includes(expressao), `${relativo} deixou de usar \`${expressao}\``)
  }
  // O /api/bi/sdr tem DOIS ORDER BY sobre conversations.occurredAt.
  const biSdr = readFileSync(join(RAIZ, 'app/api/bi/sdr/route.ts'), 'utf8')
  assert.equal(biSdr.split('descNulosPorUltimo(conversations.occurredAt)').length - 1, 2)
})
