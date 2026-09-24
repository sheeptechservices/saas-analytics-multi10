/* Rode a partir da raiz do repositorio:
 *   node scripts/migracao-postgres/conferir-copia.mjs
 * Le TURSO_DATABASE_URL, TURSO_AUTH_TOKEN e DATABASE_PUBLIC_URL do .env.local.
 * Nenhum valor de credencial e impresso.
 */
/* Confere a cópia além da contagem. SOMENTE LEITURA nos dois bancos.
 *
 * A contagem prova que nada se perdeu. Não prova que os valores chegaram certos —
 * e o modo de falha desta migração é justamente esse: data convertida do grupo
 * errado cai em 1970 ou no ano 58000 sem erro nenhum.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const REPO = process.cwd()
const require = createRequire(REPO + '/package.json')
const { createClient } = require('@libsql/client')
const { Client } = require('pg')

const env = Object.fromEntries(
  readFileSync(REPO + '/.env.local', 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')] }),
)

const turso = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
const u = env.DATABASE_PUBLIC_URL
const pg = new Client({
  connectionString: u.includes('?') ? u.slice(0, u.indexOf('?')) : u,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000,
})

const PISO = new Date('2020-01-01').getTime()
const TETO = new Date('2030-01-01').getTime()
let problemas = 0

await pg.connect()

// ── 1. toda data caiu numa faixa plausível? ──────────────────────────────────
const colsData = await pg.query(`
  select table_name, column_name from information_schema.columns
   where table_schema='public' and data_type='timestamp with time zone'
   order by table_name, column_name`)

console.log('1. faixa das', colsData.rowCount, 'colunas de data')
let vaziasData = 0
for (const { table_name: t, column_name: c } of colsData.rows) {
  const r = await pg.query(`select min("${c}") as mi, max("${c}") as ma, count("${c}")::int as n from "${t}"`)
  const { mi, ma, n } = r.rows[0]
  if (!n) { vaziasData++; continue }
  const fora = [mi, ma].filter(d => d && (d.getTime() < PISO || d.getTime() > TETO))
  if (fora.length) {
    problemas++
    console.log(`   FORA DA FAIXA  ${t}.${c}: ${mi?.toISOString()} … ${ma?.toISOString()}`)
  } else {
    console.log(`   ok  ${String(n).padStart(4)}  ${t}.${c}  ${mi.toISOString().slice(0, 10)} … ${ma.toISOString().slice(0, 10)}`)
  }
}
console.log(`   (${vaziasData} colunas sem nenhum valor)`)

// ── 2. os bigints de epoch continuam em milissegundos? ───────────────────────
const colsBig = await pg.query(`
  select table_name, column_name from information_schema.columns
   where table_schema='public' and data_type='bigint' order by table_name, column_name`)
console.log('\n2. colunas bigint (epoch em MILISSEGUNDOS — não podem ter virado segundos)')
for (const { table_name: t, column_name: c } of colsBig.rows) {
  const r = await pg.query(`select min("${c}") as mi, max("${c}") as ma, count("${c}")::int as n from "${t}"`)
  const { mi, ma, n } = r.rows[0]
  if (!n) { console.log(`   --  ${t}.${c}: vazia`); continue }
  const ok = Number(mi) > 1.5e12 && Number(ma) < 2.0e12
  if (!ok) problemas++
  console.log(`   ${ok ? 'ok' : 'SUSPEITO'}  ${t}.${c}: ${new Date(Number(mi)).toISOString().slice(0, 10)} … ${new Date(Number(ma)).toISOString().slice(0, 10)}`)
}

// ── 3. conferência linha a linha contra a origem ─────────────────────────────
console.log('\n3. amostra linha a linha contra o Turso')
const amostras = [
  ['tenants', 'created_at'],
  ['users', 'created_at'],
  ['events', 'occurred_at'],
  ['contacts', 'last_interaction_at'],
  ['blast_campaigns', 'created_at'],
]
for (const [tab, col] of amostras) {
  const o = await turso.execute(`select id, "${col}" as v from "${tab}" where "${col}" is not null order by id limit 3`)
  if (!o.rows.length) { console.log(`   --  ${tab}.${col}: sem dado`); continue }
  let iguais = 0
  for (const linha of o.rows) {
    const d = await pg.query(`select "${col}" as v from "${tab}" where id = $1`, [linha.id])
    const bruto = Number(linha.v)
    /* Valor acima de 1e11 ja esta em milissegundos: e a linha que o codigo antigo
     * gravou na unidade errada, e que a copia corrige com --corrigir-epoch. Sem esta
     * excecao o conferidor acusaria a propria correcao como divergencia. */
    const corrigida = bruto > 1e11
    const esperado = corrigida ? bruto : bruto * 1000
    const obtido = d.rows[0]?.v?.getTime()
    if (esperado === obtido) { iguais++; if (corrigida) console.log(`   (corrigida) ${tab}.${col} id=${linha.id}: ${new Date(obtido).toISOString()}`) }
    else {
      problemas++
      console.log(`   DIVERGE  ${tab}.${col} id=${linha.id}: origem ${new Date(esperado).toISOString()} · destino ${obtido ? new Date(obtido).toISOString() : 'null'}`)
    }
  }
  console.log(`   ok  ${tab}.${col}: ${iguais}/${o.rows.length} idênticos ao milissegundo`)
}

// ── 4. booleanos ─────────────────────────────────────────────────────────────
console.log('\n4. booleanos')
for (const [tab, col] of [['tenant_modules', 'enabled'], ['pipelines', 'is_archived']]) {
  const o = await turso.execute(`select sum(case when "${col}"=1 then 1 else 0 end) as n from "${tab}"`)
  const d = await pg.query(`select count(*)::int as n from "${tab}" where "${col}" = true`)
  const ok = Number(o.rows[0].n ?? 0) === d.rows[0].n
  if (!ok) problemas++
  console.log(`   ${ok ? 'ok' : 'DIVERGE'}  ${tab}.${col}: origem ${o.rows[0].n ?? 0} verdadeiros · destino ${d.rows[0].n}`)
}

// ── 5. o payload sobrevive ao ::jsonb? ───────────────────────────────────────
console.log('\n5. events.payload passa pelo ::jsonb (era o 500 permanente)')
try {
  const r = await pg.query("select count(distinct (payload)::jsonb ->> 'messageId')::int as n from events")
  console.log(`   ok  a varredura inteira converteu — ${r.rows[0].n} messageId distintos`)
} catch (e) {
  problemas++
  console.log(`   FALHOU  ${e.code}: ${String(e.message).slice(0, 90)}`)
}

console.log(problemas === 0 ? '\n=== tudo confere ===' : `\n=== ${problemas} PROBLEMA(S) ===`)
await pg.end()
process.exit(problemas === 0 ? 0 : 1)
