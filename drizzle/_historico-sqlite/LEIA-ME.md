# Histórico — migrações do tempo do SQLite/Turso

Estes 12 arquivos são **DDL de SQLite** e **não rodam no Postgres**. Eles estão
aqui só como registro de como o schema chegou ao formato atual; nada neste
diretório é executado por `drizzle-kit migrate`, que lê apenas `drizzle/`.

O banco do app passou de Turso (libSQL, dialeto SQLite) para Postgres na Railway.
Como o Postgres de destino nasce vazio e é preenchido por um script de cópia, a
linha nova começa de um **baseline único** (`drizzle/0000_*.sql`), gerado pelo
`drizzle-kit` a partir de `lib/db/schema.ts` já em `pgTable`.

## O que aconteceu com as duas migrações recentes

- **`0010_job_locks.sql`** — criava `job_locks` com `CREATE TABLE IF NOT EXISTS`,
  porque `lib/cron-lock.ts` cria a tabela sozinho em tempo de execução (as
  migrações não rodam no deploy). **A intenção sobrevive**: a tabela está no
  baseline novo, e o `JOB_LOCKS_DDL` de `lib/cron-lock.ts` foi reescrito em
  Postgres com a mesma forma (`IF NOT EXISTS`, agora com tratamento da corrida de
  catálogo que o Postgres tem e o SQLite não). Atenção a uma mudança de tipo:
  `locked_until` era `integer` e virou `bigint` — guarda epoch em milissegundos,
  que não cabe no `integer` (int4) do Postgres.

- **`0011_role_admin_unico.sql`** — era um `UPDATE users SET role='admin' WHERE
  role IN ('manager','user')`, limpeza de dados, **não** mudança de estrutura. Ele
  nunca rodou em produção (o comentário do próprio arquivo diz que é opcional), e
  um baseline não carrega UPDATE de dados. **A intenção NÃO está no baseline, e
  isso é de propósito**: quem decide se as linhas legadas viram 'admin' é o
  script de cópia dos dados ou um UPDATE manual depois. O código não depende
  disso — `lib/roles.ts` já trata 'manager' e 'user' como admin do tenant.
