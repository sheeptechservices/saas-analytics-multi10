import { loadEnv } from './lib/db/load-env'
loadEnv()

import type { Config } from 'drizzle-kit'

/* `generate` não conecta em banco nenhum — lê só `schema` e `out`. O
 * `dbCredentials` abaixo serve a `push`/`migrate`/`studio`, e por isso a URL não
 * tem valor padrão: não existe Postgres local para cair em cima. Sem
 * DATABASE_URL, esses comandos falham dizendo qual variável falta, em vez de
 * tentarem um endereço inventado. */
export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config
