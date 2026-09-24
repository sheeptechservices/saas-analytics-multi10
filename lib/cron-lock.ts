import { randomUUID } from 'crypto'

// Trava global dos jobs agendados. Mora no Postgres da Railway (o banco do
// próprio app) porque, durante a migração Vercel → Railway, as duas implantações
// dividem o mesmo banco: se o agendador disparar duas vezes, ou as duas
// implantações forem chamadas, só uma execução trabalha — a outra volta sem
// fazer nada.
//
// A tabela se cria sozinha porque as migrações não rodam no deploy (o
// startCommand da Railway é só `npm run start`). Ela também está em
// lib/db/schema.ts e na migração de baseline, só para registro.
//
// locked_until é epoch em MILISSEGUNDOS: por isso bigint, e não integer. O
// `integer` do Postgres é int4 e estoura em 2.147.483.647; Date.now() vale
// ~1,77e12. No SQLite, onde INTEGER é de 64 bits, `integer` bastava.
export const JOB_LOCKS_DDL =
  'CREATE TABLE IF NOT EXISTS job_locks ("name" text PRIMARY KEY NOT NULL, "locked_until" bigint NOT NULL, "owner" text)'

/** O mínimo que precisamos de um executor de SQL. Tanto o `Pool` do `pg` quanto
 *  uma instância de PGlite (usada nos testes) satisfazem esta forma. */
type Executor = {
  query(texto: string, valores?: unknown[]): Promise<{ rows: unknown[] }>
}

interface AcquireOptions {
  /** Validade da trava. Uma execução que morre no meio (deploy, timeout) não
   *  chega ao release: vencido o prazo, a próxima assume. */
  ttlMs: number
  /** Prefixo do dono gravado na linha (ex.: 'railway'), só para diagnóstico. */
  label?: string
  /** Relógio em ms — injetável nos testes. */
  now?: number
}

/** `CREATE TABLE IF NOT EXISTS` do Postgres NÃO é livre de corrida: duas sessões
 *  que o executam ao mesmo tempo numa base onde a tabela ainda não existe podem
 *  colidir no catálogo (42P07 duplicate_table, ou 23505 no índice único do
 *  pg_type). E este arquivo existe justamente para ser chamado em paralelo. Quem
 *  perder a corrida encontra a tabela pronta, que é o resultado desejado — então
 *  os dois códigos são engolidos e o INSERT logo abaixo é quem diz a verdade. */
const CORRIDA_NO_CATALOGO = new Set(['42P07', '23505'])

async function garantirTabela(client: Executor): Promise<void> {
  try {
    await client.query(JOB_LOCKS_DDL)
  } catch (err: unknown) {
    const codigo = (err as { code?: unknown })?.code
    if (typeof codigo === 'string' && CORRIDA_NO_CATALOGO.has(codigo)) return
    throw err
  }
}

/** Tenta tomar a trava `name`. Devolve o identificador do dono, a ser passado
 *  ao releaseJobLock, ou null se outra execução ainda a segura.
 *
 *  Um único comando atômico: insere a linha ou, se ela já existe, só a
 *  sobrescreve quando o prazo anterior venceu. No Postgres o `ON CONFLICT ... DO
 *  UPDATE ... WHERE` trava a linha em conflito e reavalia o WHERE sobre a versão
 *  mais nova dela — então de duas execuções simultâneas, a que chegar depois vê
 *  o prazo já renovado pela primeira e não escreve. O RETURNING só traz linha
 *  quando houve escrita: as duas nunca saem com a trava. */
export async function acquireJobLock(client: Executor, name: string, opts: AcquireOptions): Promise<string | null> {
  const now = opts.now ?? Date.now()
  const owner = opts.label ? `${opts.label}:${randomUUID()}` : randomUUID()
  await garantirTabela(client)
  const rs = await client.query(
    `INSERT INTO job_locks ("name", "locked_until", "owner") VALUES ($1, $2, $3)
     ON CONFLICT ("name") DO UPDATE SET "locked_until" = excluded."locked_until", "owner" = excluded."owner"
     WHERE job_locks."locked_until" < $4
     RETURNING "owner"`,
    [name, now + opts.ttlMs, owner, now],
  )
  return rs.rows.length > 0 ? owner : null
}

/** Solta a trava, mas só se ela ainda for deste dono: se o prazo venceu e outra
 *  execução assumiu, a trava dela fica intacta. Zera o prazo em vez de apagar a
 *  linha — o próximo acquire a sobrescreve. */
export async function releaseJobLock(client: Executor, name: string, owner: string): Promise<void> {
  await client.query(
    'UPDATE job_locks SET "locked_until" = 0 WHERE "name" = $1 AND "owner" = $2',
    [name, owner],
  )
}
