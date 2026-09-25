/* Rode a partir da raiz do repositorio:
 *   node scripts/migracao-postgres/copiar-turso-para-postgres.mjs
 * Le TURSO_DATABASE_URL, TURSO_AUTH_TOKEN e DATABASE_PUBLIC_URL do .env.local.
 * Nenhum valor de credencial e impresso.
 */
/* Copia o banco da aplicação do Turso (SQLite) para o Postgres da Railway.
 *
 * NASCE EM MODO SECO. Sem `--executar` ele lê os dois bancos, mostra o plano e a
 * contagem, e não grava nada. Nada é impresso da string de conexão, em modo nenhum.
 *
 * Ordem das operações, e o porquê de cada uma:
 *
 *   1. Aplica drizzle/0000_baseline_postgres.sql. Nada aplica o schema no deploy —
 *      o railway.json roda só `npm run start`, não existe script de migração e o
 *      drizzle-kit é devDependency, fora da imagem. Quem cria o schema é este
 *      script, porque ele precisa do schema de qualquer jeito para inserir.
 *
 *   2. Registra o baseline em drizzle.__drizzle_migrations. Sem isso, o primeiro
 *      `drizzle-kit migrate` futuro reexecuta a 0000 e aborta com 42P07 ao tentar
 *      recriar tabela que já existe.
 *
 *   3. Copia tabela por tabela na ordem das chaves estrangeiras — ordem derivada do
 *      information_schema, não de uma lista escrita à mão que envelhece.
 *
 *   4. Converte pelo TIPO DA COLUNA NO DESTINO, lido do information_schema. É o
 *      ponto mais perigoso da migração: as 29 colunas de data guardam epoch em
 *      SEGUNDOS (é o que o drizzle grava em mode:'timestamp') e as 7 de bigint
 *      guardam MILISSEGUNDOS (Date.now() cru). Trocar os grupos dá data em 1970 ou
 *      no ano 58000, sem erro nenhum. Derivar do tipo elimina a chance de errar.
 *
 *   5. Limpa NUL e surrogate solto do JSON guardado em texto. `json_extract` nunca
 *      validou nada; `::jsonb` valida o documento inteiro a cada leitura, e UMA
 *      linha ruim derruba o painel do SDR e todo reconcile daquele cliente,
 *      permanentemente. Limpa e LISTA — nunca em silêncio.
 *
 *   6. Confere a contagem nos dois bancos e falha se alguma diferir.
 *
 * Reexecutável: cada tabela é esvaziada antes de receber, e tudo corre numa única
 * transação. Falhou no meio, nada fica pela metade.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const REPO = process.cwd()
const BASELINE = REPO + '/drizzle/0000_baseline_postgres.sql'
const SAIDA_ORFAS = REPO + '/export-tabelas-orfas.json'

const require = createRequire(REPO + '/package.json')
const { createClient } = require('@libsql/client')
const { Client } = require('pg')

const EXECUTAR = process.argv.includes('--executar')
// O schema e passo a parte: criar tabela vazia nao e copiar dado, e sem ele o modo
// seco nao consegue nem ler os tipos para dizer o que faria.
const SCHEMA = process.argv.includes('--schema') || EXECUTAR
const CORRIGIR_EPOCH = process.argv.includes('--corrigir-epoch')

/* Segundos plausiveis ficam na casa de 1,7 bilhao; milissegundos, de 1,7 trilhao.
 * Qualquer coisa acima disto numa coluna de data foi gravada na unidade errada por
 * codigo antigo — lida como segundos, cai no ano 58000. Nao da para adivinhar em
 * silencio nem para copiar fielmente uma data que nao existe: o script para e
 * mostra, e so corrige se voce mandar. */
const LIMITE_SEGUNDOS = 1e11

// `when` da 0000 em drizzle/meta/_journal.json. Só `created_at` é comparado pelo
// drizzle, então o hash pode ser qualquer marcador.
const BASELINE_WHEN = 1790254402836
const BASELINE_HASH = 'baseline-0000_baseline_postgres'

// ─── ambiente ────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  readFileSync(REPO + '/.env.local', 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')] }),
)

for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_PUBLIC_URL']) {
  if (!env[k]) { console.error(`falta ${k} no .env.local`); process.exit(1) }
}

// ─── limpeza de JSON (mesma regra de lib/json-seguro.ts) ─────────────────────

/* Alto sem baixo depois, ou baixo sem alto antes. Um par válido não casa com
 * nenhum dos dois lados e passa intacto — é o que preserva emoji. */
const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/* Limpa no VALOR decodificado, nunca no texto já serializado: uma barra invertida
 * literal seguida de `u0000` termina nos mesmos seis caracteres, e um replace sobre
 * o texto pronto a mutilaria, gerando JSON inválido. */
function limparJson(texto) {
  if (typeof texto !== 'string' || !texto) return { texto, mudou: false }
  let valor
  try { valor = JSON.parse(texto) } catch { return { texto, mudou: false } }

  let mexeu = false
  const limpo = JSON.stringify(valor, function (_chave, v) {
    if (typeof v !== 'string') return v
    const s = v.replace(/\u0000/g, '').replace(SURROGATE_SOLTO, '')
    if (s !== v) mexeu = true
    return s
  })
  // A chave também pode carregar lixo, e o replacer só vê o valor.
  const final = limpo.replace(/\\u0000/g, '')
  if (final !== limpo) mexeu = true
  return { texto: mexeu ? final : texto, mudou: mexeu }
}

// ─── conexões ────────────────────────────────────────────────────────────────

const turso = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

// O proxy TCP da Railway apresenta certificado autoassinado na cadeia (verificado:
// a verificação completa recusa com SELF_SIGNED_CERT_IN_CHAIN). Cifra sim,
// autentica não — é o que a topologia permite de fora do projeto.
const semParametros = env.DATABASE_PUBLIC_URL.includes('?')
  ? env.DATABASE_PUBLIC_URL.slice(0, env.DATABASE_PUBLIC_URL.indexOf('?'))
  : env.DATABASE_PUBLIC_URL
const pg = new Client({
  connectionString: semParametros,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
  statement_timeout: 120_000,
  application_name: 'multi10-copia-turso',
})

const log = (...a) => console.log(...a)
const aviso = (...a) => console.log('  ⚠', ...a)

async function main() {
  await pg.connect()
  log(EXECUTAR ? '=== MODO EXECUÇÃO — vai gravar ===' : '=== MODO SECO — não grava nada (use --executar) ===')
  log('')

  // ── 1. schema ──────────────────────────────────────────────────────────────
  const jaTem = await pg.query(
    "select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
  )
  const tabelasDestino = jaTem.rows[0].n

  if (tabelasDestino === 0) {
    if (!existsSync(BASELINE)) { console.error('baseline não encontrado:', BASELINE); process.exit(1) }
    const sql = readFileSync(BASELINE, 'utf8')
    const comandos = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
    log(`1. schema: destino vazio → aplicar baseline (${comandos.length} comandos)`)
    if (!SCHEMA) log('   (pulado: rode com --schema para criar as tabelas antes do modo seco)')
    if (SCHEMA) {
      await pg.query('begin')
      for (const c of comandos) await pg.query(c)
      await pg.query('commit')
      log('   aplicado')
    }
  } else {
    log(`1. schema: destino já tem ${tabelasDestino} tabelas → não aplica baseline`)
  }

  // ── 2. registro do baseline ────────────────────────────────────────────────
  const temRegistro = await pg.query(
    "select count(*)::int as n from information_schema.tables where table_schema='drizzle' and table_name='__drizzle_migrations'",
  ).then(r => r.rows[0].n > 0)
  const registroPreenchido = temRegistro
    ? await pg.query('select count(*)::int as n from drizzle.__drizzle_migrations').then(r => r.rows[0].n > 0)
    : false

  if (registroPreenchido) {
    log('2. registro do drizzle: já existe')
  } else {
    log('2. registro do drizzle: criar e semear (senão o primeiro `drizzle-kit migrate` aborta com 42P07)')
    if (SCHEMA) {
      await pg.query('create schema if not exists drizzle')
      await pg.query('create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)')
      await pg.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [BASELINE_HASH, BASELINE_WHEN])
      log('   semeado')
    }
  }

  // ── 3. tipos e ordem ───────────────────────────────────────────────────────
  const colunas = await pg.query(`
    select table_name, column_name, data_type, ordinal_position
      from information_schema.columns
     where table_schema='public'
     order by table_name, ordinal_position`)

  if (colunas.rowCount === 0) {
    log('\n(o destino nao tem schema, entao nao da para conferir tipos nem copiar.')
    log(' rode com --schema para cria-lo — e seguro e so cria tabela vazia.')
    await encerrar(0)
  }

  const tipos = new Map()   // tabela -> Map(coluna -> data_type)
  for (const r of colunas.rows) {
    if (!tipos.has(r.table_name)) tipos.set(r.table_name, new Map())
    tipos.get(r.table_name).set(r.column_name, r.data_type)
  }

  const fks = await pg.query(`
    select tc.table_name as filha, ccu.table_name as pai
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
     where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'`)

  const ordem = ordenarPorDependencia([...tipos.keys()], fks.rows)

  // ── 4. o que existe na origem ──────────────────────────────────────────────
  const naOrigem = (await turso.execute(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
  )).rows.map(r => String(r.name))

  const copiaveis = ordem.filter(t => naOrigem.includes(t))
  const orfas = naOrigem.filter(t => !tipos.has(t))
  const semDado = ordem.filter(t => !naOrigem.includes(t))

  log(`\n3. tabelas: ${copiaveis.length} para copiar · ${orfas.length} órfãs (só na origem) · ${semDado.length} sem correspondente na origem`)
  if (orfas.length) log('   órfãs:', orfas.join(', '))
  if (semDado.length) log('   sem dado de origem:', semDado.join(', '))

  // ── 5. órfãs: exportar antes de deixar para trás ───────────────────────────
  if (orfas.length) {
    const dump = {}
    let total = 0
    for (const t of orfas) {
      const r = await turso.execute(`select * from "${t}"`)
      dump[t] = r.rows.map(linha => Object.fromEntries(Object.entries(linha)))
      total += r.rows.length
    }
    log(`\n4. órfãs: ${total} linhas em ${orfas.length} tabelas → ${SAIDA_ORFAS}`)
    if (EXECUTAR) { writeFileSync(SAIDA_ORFAS, JSON.stringify(dump, null, 2), 'utf8'); log('   gravado') }
  } else {
    log('\n4. órfãs: nenhuma')
  }

  // ── 6. cópia ───────────────────────────────────────────────────────────────
  log('\n5. cópia' + (EXECUTAR ? '' : ' (simulada)'))
  const COLUNAS_JSON = new Set([
    'payload', 'extra', 'metadata', 'dimensions', 'tags', 'settings', 'custom_fields',
  ])
  const limpezas = []
  const contagens = []
  const forasDeEscala = []

  if (EXECUTAR) await pg.query('begin')

  for (const tabela of copiaveis) {
    const mapa = tipos.get(tabela)
    const origem = await turso.execute(`select * from "${tabela}"`)
    const nomes = [...mapa.keys()]

    if (EXECUTAR) await pg.query(`truncate table "${tabela}" cascade`)

    let convertidas = { datas: 0, bigints: 0, booleanos: 0 }
    for (const linha of origem.rows) {
      const valores = nomes.map(col => {
        const bruto = linha[col]
        if (bruto === null || bruto === undefined) return null
        const tipo = mapa.get(col)

        if (tipo === 'timestamp with time zone') {
          const n = Number(bruto)
          if (n > LIMITE_SEGUNDOS) {
            // Ja esta em milissegundos: codigo antigo gravou na unidade errada.
            forasDeEscala.push({
              tabela, coluna: col, id: linha.id ?? '(sem id)', bruto: n,
              comoSegundos: new Date(n * 1000).toISOString(),
              comoMs: new Date(n).toISOString(),
            })
            return CORRIGIR_EPOCH ? new Date(n) : new Date(n * 1000)
          }
          // epoch em SEGUNDOS — e o que o drizzle grava em mode:'timestamp'
          convertidas.datas++
          return new Date(n * 1000)
        }
        if (tipo === 'bigint') {
          // epoch em MILISSEGUNDOS (Date.now() cru) — sem conversão
          convertidas.bigints++
          return String(bruto)
        }
        if (tipo === 'boolean') {
          convertidas.booleanos++
          return Number(bruto) === 1
        }
        if (tipo === 'text' && COLUNAS_JSON.has(col)) {
          const { texto, mudou } = limparJson(String(bruto))
          if (mudou) limpezas.push({ tabela, coluna: col, id: linha.id ?? '(sem id)' })
          return texto
        }
        return bruto
      })

      if (EXECUTAR) {
        const marcas = nomes.map((_, i) => `$${i + 1}`).join(', ')
        const cols = nomes.map(n => `"${n}"`).join(', ')
        await pg.query(`insert into "${tabela}" (${cols}) values (${marcas})`, valores)
      }
    }

    contagens.push({ tabela, origem: origem.rows.length })
    const conv = [
      convertidas.datas && `${convertidas.datas} datas`,
      convertidas.bigints && `${convertidas.bigints} bigints`,
      convertidas.booleanos && `${convertidas.booleanos} booleanos`,
    ].filter(Boolean).join(', ')
    log(`   ${String(origem.rows.length).padStart(5)}  ${tabela}${conv ? '   (' + conv + ')' : ''}`)
  }

  if (EXECUTAR) await pg.query('commit')

  // ── 6b. datas na unidade errada ────────────────────────────────────────────
  if (forasDeEscala.length) {
    log(`\n5b. datas fora de escala: ${forasDeEscala.length}`)
    for (const f of forasDeEscala) {
      aviso(`${f.tabela}.${f.coluna} — linha ${f.id}`)
      log(`      valor bruto ${f.bruto}`)
      log(`      como segundos → ${f.comoSegundos}   (data impossivel)`)
      log(`      como ms       → ${f.comoMs}`)
      log(`      ${CORRIGIR_EPOCH ? 'CORRIGIDO: gravado como ms' : 'copiado como esta (use --corrigir-epoch para dividir por 1000)'}`)
    }
    if (!CORRIGIR_EPOCH && EXECUTAR) {
      console.error('\nATENCAO: essas datas foram copiadas como estao, e continuam impossiveis.')
      console.error('Decida antes da virada: --corrigir-epoch as trata como milissegundos.')
    }
  }

  // ── 7. limpezas ────────────────────────────────────────────────────────────
  log(`\n6. limpeza de JSON: ${limpezas.length} ${limpezas.length === 1 ? 'valor alterado' : 'valores alterados'}`)
  for (const l of limpezas) aviso(`${l.tabela}.${l.coluna} — linha ${l.id}: removido NUL e/ou surrogate solto`)
  if (limpezas.length > 50) {
    console.error('\nABORTADO: número implausível de limpezas — isso sugere erro de decodificação, não dado sujo.')
    await encerrar(1)
  }

  // ── 8. conferência ─────────────────────────────────────────────────────────
  log('\n7. conferência de contagens')
  let divergiu = false
  for (const c of contagens) {
    const destino = EXECUTAR
      ? await pg.query(`select count(*)::int as n from "${c.tabela}"`).then(r => r.rows[0].n)
      : null
    if (EXECUTAR && destino !== c.origem) {
      divergiu = true
      console.error(`   DIVERGE  ${c.tabela}: origem ${c.origem} · destino ${destino}`)
    }
  }
  const total = contagens.reduce((s, c) => s + c.origem, 0)
  if (!EXECUTAR) log(`   (modo seco) ${total} linhas seriam copiadas em ${contagens.length} tabelas`)
  else if (divergiu) { console.error('\nCÓPIA INCOMPLETA — veja as divergências acima.'); await encerrar(1) }
  else log(`   todas conferem — ${total} linhas em ${contagens.length} tabelas`)

  log(EXECUTAR ? '\n=== cópia concluída ===' : '\n=== fim do modo seco: nada foi gravado ===')
  await encerrar(0)
}

/** Ordena as tabelas para que a pai venha antes da filha. */
function ordenarPorDependencia(tabelas, arestas) {
  const dependeDe = new Map(tabelas.map(t => [t, new Set()]))
  for (const { filha, pai } of arestas) {
    if (filha !== pai && dependeDe.has(filha) && dependeDe.has(pai)) dependeDe.get(filha).add(pai)
  }
  const saida = []
  const pendentes = new Set(tabelas)
  while (pendentes.size) {
    const prontas = [...pendentes].filter(t => [...dependeDe.get(t)].every(p => !pendentes.has(p)))
    // Ciclo (auto-referência já foi ignorada acima): despeja o resto em ordem estável.
    if (!prontas.length) { saida.push(...[...pendentes].sort()); break }
    prontas.sort()
    for (const t of prontas) { saida.push(t); pendentes.delete(t) }
  }
  return saida
}

async function encerrar(codigo) {
  await pg.end().catch(() => {})
  process.exit(codigo)
}

main().catch(async e => {
  console.error('\nFALHOU:', e.code || '', String(e.message).slice(0, 200))
  if (EXECUTAR) await pg.query('rollback').catch(() => {})
  await encerrar(1)
})
