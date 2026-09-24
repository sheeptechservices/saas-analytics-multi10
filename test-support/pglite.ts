/* Postgres de verdade dentro do processo de teste — SÓ PARA TESTES.
 *
 * Mora fora de `lib/` de propósito: é código de teste, importa uma dependência de
 * desenvolvimento (`@electric-sql/pglite`) e nenhum arquivo de produção o importa.
 *
 * O PGlite é o Postgres compilado para WASM: mesmo analisador, mesmo planejador,
 * mesmos tipos, sem Docker, sem `initdb` e sem servidor. É o que permite
 * `npm test` rodar em qualquer máquina e na CI sem DATABASE_URL — e,
 * principalmente, é o que permite provar a migração em Postgres de verdade, e não
 * numa imitação.
 *
 * O schema não é criado à mão aqui: o harness executa os .sql de `drizzle/`, os
 * mesmos que vão rodar no banco da Railway. Ou seja, todo teste que usa este
 * harness prova de quebra que a migração de baseline é Postgres válido.
 *
 * LIMITE CONHECIDO, que nenhum teste daqui cobre: o PGlite tem os próprios
 * conversores de tipo e devolve `bigint`/`count(*)` já como number, enquanto o
 * `pg` (node-postgres, o driver de produção) devolve como STRING. Por isso o
 * código de produção não confia nisso: as colunas bigint usam
 * `bigint({ mode: 'number' })` e os agregados usam `.mapWith(Number)`, que
 * normalizam nos dois drivers. */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@/lib/db/schema'

const DIR_MIGRACOES = fileURLToPath(new URL('../drizzle/', import.meta.url))

/** Os .sql de `drizzle/`, em ordem. `_historico-sqlite/` fica de fora sozinho:
 *  é diretório, não termina em `.sql`. */
export function arquivosDeMigracao(): string[] {
  return readdirSync(DIR_MIGRACOES).filter(n => n.endsWith('.sql')).sort()
}

export type DbDeTeste = ReturnType<typeof drizzle<typeof schema>>

export interface BancoDeTeste {
  pg: PGlite
  db: DbDeTeste
  fechar: () => Promise<void>
}

/**
 * Sobe um Postgres em memória com o schema do app aplicado.
 * `comSchema: false` devolve a base crua — é o que o teste do cron-lock usa para
 * provar que ele cria a própria tabela num banco sem migração nenhuma.
 */
export async function bancoDeTeste(opts: { comSchema?: boolean } = {}): Promise<BancoDeTeste> {
  const pg = new PGlite()

  if (opts.comSchema !== false) {
    for (const arquivo of arquivosDeMigracao()) {
      const texto = readFileSync(join(DIR_MIGRACOES, arquivo), 'utf8')
      // `--> statement-breakpoint` é o separador que o próprio drizzle-kit escreve.
      for (const comando of texto.split('--> statement-breakpoint')) {
        const limpo = comando.trim()
        if (limpo) await pg.exec(limpo)
      }
    }
  }

  return {
    pg,
    db: drizzle(pg, { schema }),
    fechar: () => pg.close(),
  }
}

type EscopoDb = typeof globalThis & { __pgPool?: unknown; __pgDb?: unknown }

/**
 * Faz `db` de `@/lib/db` apontar para este banco de teste, para que módulos de
 * PRODUÇÃO (lib/sync/runner, lib/blast/reconcile, ...) rodem de verdade contra
 * PGlite — em vez de o teste reescrever o SQL deles e testar a cópia.
 *
 * Não existe truque nem alteração de produção: `lib/db/index.ts` já resolve o
 * banco com `escopoGlobal.__pgDb ??= novoDb(obterPool())`. Preencher `__pgDb`
 * antes do primeiro uso faz o `??=` devolver o que está lá e NEM CHEGAR a criar
 * o Pool do `pg` — é a mesma porta que o HMR usa em desenvolvimento.
 *
 * O `as unknown` é porque a fachada está tipada como NodePgDatabase e aqui entra
 * uma PgliteDatabase; as duas descendem de PgDatabase e montam SQL idêntico —
 * muda só a sessão que executa.
 */
export function usarComoBancoDoApp(db: DbDeTeste): void {
  ;(globalThis as EscopoDb).__pgDb = db as unknown
}

/** Desfaz `usarComoBancoDoApp`. */
export function soltarBancoDoApp(): void {
  const escopo = globalThis as EscopoDb
  delete escopo.__pgDb
  delete escopo.__pgPool
}
