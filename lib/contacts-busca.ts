import { and, eq, ilike, or, type SQL } from 'drizzle-orm'
import { contacts } from '@/lib/db/schema'
import { descNulosPorUltimo } from '@/lib/db/ordem'

/* Os pedaços de consulta de GET /api/contacts moram aqui, e não dentro da rota,
 * por um motivo prático: o Next valida os exports de um `route.ts` contra uma
 * lista fechada (GET, POST, dynamic, revalidate...), então exportar um helper de
 * lá é erro de tipo no build. Fora da rota, o teste chama exatamente o mesmo
 * código que a rota chama — trocar `ilike` por `like` aqui quebra um teste de
 * comportamento, não um teste que lê o arquivo. */

/** Filtro da lista de contatos do WhatsApp, com a busca opcional por `q`. */
export function filtroDeContatos(tenantId: string, q: string): SQL | undefined {
  const base = and(
    eq(contacts.tenantId, tenantId),
    eq(contacts.source, 'ycloud-whatsapp'),
  )
  if (!q) return base

  /* ILIKE, não LIKE. O LIKE do SQLite ignorava maiúsculas/minúsculas em ASCII
   * por padrão; o do Postgres NÃO ignora. Manter `like` faria a busca por "joao"
   * parar de achar "Joao" — sem erro nenhum, só resultado a menos.
   * (Diferença que sobra: o ILIKE também ignora o caso em acentuados,
   * "josé"/"JOSÉ", o que o SQLite não fazia. É a favor do usuário brasileiro.) */
  return and(base, or(
    ilike(contacts.name,  `%${q}%`),
    ilike(contacts.phone, `%${q}%`),
  ))
}

/* Mais recente primeiro, com quem nunca interagiu no fim. Sem o `nulls last`, o
 * Postgres põe os NULL no topo do DESC e a primeira página vira uma lista de
 * gente nunca contatada — o oposto do que a tela quer mostrar. */
export const ordemDeContatos = descNulosPorUltimo(contacts.lastInteractionAt)
