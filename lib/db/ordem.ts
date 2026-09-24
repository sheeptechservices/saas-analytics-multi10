import { sql, type SQLWrapper } from 'drizzle-orm'

/* Ordenação de coluna que aceita NULL. LEIA ANTES DE USAR `desc()`/`asc()` cru.
 *
 * SQLite e Postgres discordam sobre onde o NULL entra na ordem, e a discordância
 * é SILENCIOSA — não há erro, só linha na posição errada:
 *
 *   SQLite   NULL é o MENOR valor      → ASC: nulos primeiro | DESC: nulos por último
 *   Postgres NULL é o MAIOR valor      → ASC: nulos por último | DESC: nulos primeiro
 *
 * O `desc()`/`asc()` do drizzle emitem só `desc`/`asc`, sem cláusula NULLS, então
 * herdam o padrão do banco: ao sair do Turso, TODA ordenação por coluna anulável
 * se inverteu nas pontas. Na prática isso colocava contato nunca contatado no topo
 * da primeira página de /api/contacts, e elegia mensagem sem data como a última
 * de uma sessão em /api/ycloud/conversations.
 *
 * Os dois helpers abaixo escrevem a cláusula à mão e reproduzem exatamente o que
 * o SQLite fazia. Use-os em qualquer ORDER BY sobre coluna anulável; para coluna
 * NOT NULL, `desc()`/`asc()` do drizzle seguem corretos (não há NULL para posicionar).
 *
 * DECISÃO: preferimos a cláusula explícita a tornar as colunas NOT NULL.
 * `contacts.last_interaction_at` e `conversations.occurred_at` são nulas por um
 * motivo real — contato nunca contatado, mensagem sem data na origem. Um valor
 * sentinela (epoch 0) resolveria a ordenação e mentiria na tela, aparecendo como
 * 01/01/1970. */

/** `ORDER BY col DESC` com os nulos no fim — o DESC do SQLite. */
export function descNulosPorUltimo(coluna: SQLWrapper) {
  return sql`${coluna} desc nulls last`
}

/** `ORDER BY col ASC` com os nulos no começo — o ASC do SQLite. */
export function ascNulosPrimeiro(coluna: SQLWrapper) {
  return sql`${coluna} asc nulls first`
}
