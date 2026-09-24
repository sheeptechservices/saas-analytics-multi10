import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import * as esquema from '@/lib/db/schema'
import { contagensPorStatus } from '@/lib/blast/campanhas'
import { contagensDeMensagens } from '@/lib/bi/whatsapp-mensagens'

/* `.mapWith(Number)` nos agregados — e por que ele NÃO dá para testar do jeito
 * óbvio.
 *
 * `count()` e `sum()` sobre coluna inteira devolvem bigint. O node-postgres, que
 * é o driver de produção, entrega bigint como STRING; o PGlite, que é o que roda
 * nos testes, entrega como number. Ou seja: um teste que só leia o resultado de
 * uma consulta no PGlite está afirmando uma propriedade DO HARNESS, não do
 * código — some com o `.mapWith(Number)` e ele continua verde.
 *
 * Então aqui o teste não lê resultado: ele inspeciona o DECODIFICADOR do próprio
 * fragmento de SQL de produção, que é exatamente a peça que `.mapWith(Number)`
 * instala e que o node-postgres vai usar. Sem `.mapWith`, o drizzle deixa o
 * decodificador neutro, que devolve a string intacta.
 *
 * Nenhum defeito decorre disso hoje — todo consumidor embrulha em `Number(...)`
 * ou faz aritmética que coage. O que se protege é a propriedade. */

type ComDecodificador = SQL<number> & { decoder: { mapFromDriverValue: (v: unknown) => unknown } }

function normalizaParaNumero(fragmento: SQL<number>): boolean {
  const { decoder } = fragmento as ComDecodificador
  return decoder.mapFromDriverValue('42') === 42
}

test('o decodificador neutro do drizzle devolveria a string — a premissa', async () => {
  const { sql } = await import('drizzle-orm')
  const sem = sql<number>`count(*)` as ComDecodificador
  assert.equal(sem.decoder.mapFromDriverValue('42'), '42', 'sem mapWith, bigint chega como texto')
  const com = sql<number>`count(*)`.mapWith(Number) as ComDecodificador
  assert.equal(com.decoder.mapFromDriverValue('42'), 42)
})

test('as cinco contagens de /api/sdr/blast/campaigns normalizam bigint para number', () => {
  const chaves = Object.keys(contagensPorStatus)
  assert.deepEqual(chaves, ['pendente', 'enviado', 'entregue', 'lido', 'falhou'])
  for (const [nome, fragmento] of Object.entries(contagensPorStatus)) {
    assert.ok(normalizaParaNumero(fragmento), `contagensPorStatus.${nome} perdeu o .mapWith(Number)`)
  }
})

test('as quatro contagens de /api/bi/sdr normalizam bigint para number', () => {
  const chaves = Object.keys(contagensDeMensagens)
  assert.deepEqual(chaves, ['sent', 'delivered', 'read', 'failed'])
  for (const [nome, fragmento] of Object.entries(contagensDeMensagens)) {
    assert.ok(normalizaParaNumero(fragmento), `contagensDeMensagens.${nome} perdeu o .mapWith(Number)`)
  }
})

// ─── Varredura: os agregados que ficaram embutidos nas rotas ─────────────────

/* Os fragmentos que continuam dentro de um `route.ts` não podem ser importados
 * (o Next só deixa a rota exportar GET/POST/...), então a cobertura deles é
 * textual. A regra não é "todo SUM precisa de mapWith" — isso seria falso: `SUM`
 * sobre `double precision` devolve float8, que o node-postgres já entrega como
 * number. Quem decide é o TIPO DA COLUNA, lido do schema. */

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
const FRAGMENTO = /sql<number>`([^`]*)`(\.mapWith\(Number\))?/g
const REFERENCIA = /\$\{\s*([A-Za-z_$][\w$]*)\.([\w$]+)\s*\}/g

function arquivosTs(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, saida)
    else if ((nome.endsWith('.ts') || nome.endsWith('.tsx')) && !nome.endsWith('.test.ts')) saida.push(caminho)
  }
  return saida
}

/** `exportacao.propriedade` → tipo SQL da coluna, tirado do próprio schema. */
function tiposDasColunas(): Map<string, string> {
  const tipos = new Map<string, string>()
  for (const [exportacao, valor] of Object.entries(esquema)) {
    try { getTableName(valor as Parameters<typeof getTableName>[0]) } catch { continue }
    for (const [prop, coluna] of Object.entries(getTableColumns(valor as Parameters<typeof getTableColumns>[0]))) {
      tipos.set(`${exportacao}.${prop}`, coluna.getSQLType())
    }
  }
  return tipos
}

const EM_PONTO_FLUTUANTE = new Set(['double precision', 'real'])

/**
 * O agregado volta como texto no node-postgres?
 * - `count(...)` → sempre bigint → sim.
 * - `sum(x)` → bigint quando x é inteiro (ou quando a soma é de literais, como o
 *   `SUM(CASE ... THEN 1 ELSE 0 END)`); float8 quando x é ponto flutuante.
 * Na dúvida (coluna que não achamos no schema), responde "sim" — exigir o
 * `.mapWith` a mais é inofensivo; deixar faltando não é.
 */
function voltaComoTexto(corpo: string, tipos: Map<string, string>): boolean {
  if (/\bcount\s*\(/i.test(corpo)) return true
  if (!/\bsum\s*\(/i.test(corpo)) return false
  const referenciadas = [...corpo.matchAll(REFERENCIA)].map(m => tipos.get(`${m[1]}.${m[2]}`))
  const temFlutuante = referenciadas.some(t => t && EM_PONTO_FLUTUANTE.has(t))
  const temInteira = referenciadas.some(t => t && !EM_PONTO_FLUTUANTE.has(t) && /int/.test(t))
  return temInteira || !temFlutuante
}

test('a classificação por tipo de coluna casa com o schema — a premissa', () => {
  const tipos = tiposDasColunas()
  assert.equal(tipos.get('adInsights.spend'), 'double precision')
  assert.equal(tipos.get('adInsights.impressions'), 'integer')
  assert.equal(tipos.get('funnelSnapshots.count'), 'integer')

  assert.equal(voltaComoTexto('COALESCE(SUM(${adInsights.spend}), 0)', tipos), false)
  assert.equal(voltaComoTexto('COALESCE(SUM(${adInsights.impressions}), 0)', tipos), true)
  assert.equal(voltaComoTexto('count(*)', tipos), true)
  assert.equal(voltaComoTexto('count(distinct case when ${events.eventType} = 1 then 2 end)', tipos), true)
  assert.equal(voltaComoTexto('SUM(CASE WHEN ${blastRecipients.status} = 1 THEN 1 ELSE 0 END)', tipos), true)
  assert.equal(voltaComoTexto('min(${funnelSnapshots.order})', tipos), false)
})

test('todo agregado que volta como texto carrega .mapWith(Number)', () => {
  const tipos = tiposDasColunas()
  const faltando: string[] = []
  let inspecionados = 0
  let exigiramMap = 0

  for (const pasta of ['app', 'lib']) {
    for (const arquivo of arquivosTs(join(RAIZ, pasta))) {
      for (const m of readFileSync(arquivo, 'utf8').matchAll(FRAGMENTO)) {
        inspecionados++
        if (!voltaComoTexto(m[1], tipos)) continue
        exigiramMap++
        if (!m[2]) faltando.push(`${arquivo.slice(RAIZ.length)}: sql<number>\`${m[1].slice(0, 70)}\``)
      }
    }
  }

  assert.ok(inspecionados > 20, `a varredura só achou ${inspecionados} fragmentos — está quebrada`)
  assert.ok(exigiramMap > 10, `só ${exigiramMap} fragmentos exigiriam mapWith — classificação quebrada`)
  assert.deepEqual(
    faltando, [],
    'count()/sum(int) voltam bigint, que o node-postgres entrega como STRING; ' +
      'sem .mapWith(Number) o tipo declarado `sql<number>` passa a mentir.',
  )
})

test('a varredura acusa um agregado plantado sem .mapWith', () => {
  const tipos = tiposDasColunas()
  const plantado = 'const x = sql<number>`count(*)`\nconst y = sql<number>`count(*)`.mapWith(Number)'
  const achados = [...plantado.matchAll(FRAGMENTO)]
  assert.equal(achados.length, 2)
  assert.equal(achados[0][2], undefined, 'o primeiro não tem mapWith e tem de ser notado')
  assert.ok(achados[1][2], 'o segundo tem')
  assert.ok(voltaComoTexto(achados[0][1], tipos))
})
