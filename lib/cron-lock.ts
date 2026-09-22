import { randomUUID } from 'crypto'
import type { Client } from '@libsql/client'

// Trava global dos jobs agendados. Mora no Turso porque, durante a migração
// Vercel → Railway, as duas implantações dividem o mesmo banco: se o agendador
// disparar duas vezes, ou as duas implantações forem chamadas, só uma execução
// trabalha — a outra volta sem fazer nada.
//
// A tabela se cria sozinha porque as migrações não rodam no deploy (o
// startCommand da Railway é só `npm run start`). Ela também está em
// lib/db/schema.ts e na migração 0010 (com IF NOT EXISTS), só para registro.
export const JOB_LOCKS_DDL =
  'CREATE TABLE IF NOT EXISTS job_locks (name TEXT PRIMARY KEY NOT NULL, locked_until INTEGER NOT NULL, owner TEXT)'

type Executor = Pick<Client, 'execute'>

interface AcquireOptions {
  /** Validade da trava. Uma execução que morre no meio (deploy, timeout) não
   *  chega ao release: vencido o prazo, a próxima assume. */
  ttlMs: number
  /** Prefixo do dono gravado na linha (ex.: 'railway'), só para diagnóstico. */
  label?: string
  /** Relógio em ms — injetável nos testes. */
  now?: number
}

/** Tenta tomar a trava `name`. Devolve o identificador do dono, a ser passado
 *  ao releaseJobLock, ou null se outra execução ainda a segura.
 *
 *  Um único comando atômico: insere a linha ou, se ela já existe, só a
 *  sobrescreve quando o prazo anterior venceu. O RETURNING só traz linha quando
 *  houve escrita — duas execuções simultâneas nunca saem as duas com a trava. */
export async function acquireJobLock(client: Executor, name: string, opts: AcquireOptions): Promise<string | null> {
  const now = opts.now ?? Date.now()
  const owner = opts.label ? `${opts.label}:${randomUUID()}` : randomUUID()
  await client.execute(JOB_LOCKS_DDL)
  const rs = await client.execute({
    sql: `INSERT INTO job_locks (name, locked_until, owner) VALUES (?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until, owner = excluded.owner
          WHERE job_locks.locked_until < ?
          RETURNING owner`,
    args: [name, now + opts.ttlMs, owner, now],
  })
  return rs.rows.length > 0 ? owner : null
}

/** Solta a trava, mas só se ela ainda for deste dono: se o prazo venceu e outra
 *  execução assumiu, a trava dela fica intacta. Zera o prazo em vez de apagar a
 *  linha — o próximo acquire a sobrescreve. */
export async function releaseJobLock(client: Executor, name: string, owner: string): Promise<void> {
  await client.execute({
    sql: 'UPDATE job_locks SET locked_until = 0 WHERE name = ? AND owner = ?',
    args: [name, owner],
  })
}
