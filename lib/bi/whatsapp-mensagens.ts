import { sql } from 'drizzle-orm'
import { events } from '@/lib/db/schema'

/* Contagem de MENSAGENS distintas por status mais avançado, para /api/bi/sdr.
 *
 * Fica fora da rota porque o Next valida os exports de um `route.ts` contra uma
 * lista fechada; aqui o teste exercita exatamente o SQL que a rota executa.
 *
 * Contar eventos crus quebraria a relação do funil (um `delivered` perdido faria
 * `read` passar de `delivered` → taxa de leitura acima de 100%). Aqui contamos
 * messageIds distintos com IMPLICAÇÃO: lida ⊆ entregue ⊆ enviada. Exato, sem
 * limite de linhas.
 *
 * `payload::jsonb ->> 'chave'` é o `json_extract(payload, '$.chave')` do SQLite:
 * o `->>` desembrulha e devolve text, o `->` devolveria jsonb (com as aspas).
 * AQUI os dois dariam a MESMA contagem (medido no PGlite: 3 e 3) — duas strings
 * jsonb distintas seguem distintas sob count(distinct). O `->>` está aqui por
 * coerência com lib/blast/reconcile.ts, que é onde a escolha importa de verdade:
 * lá o valor é comparado com texto num `IN (...)`, e com `->` a consulta nem
 * roda — o Postgres tenta ler o literal de texto como json e estoura com
 * "invalid input syntax for type json".
 * O `::jsonb` é necessário porque events.payload é coluna text (ver schema.ts);
 * é por causa desse cast que lib/json-seguro.ts existe.
 *
 * `.mapWith(Number)`: `count()` devolve bigint, que o node-postgres entrega como
 * STRING (o SQLite entregava number). */

const messageId = sql`(${events.payload})::jsonb ->> 'messageId'`

const distintasQuando = (condicao: ReturnType<typeof sql>) =>
  sql<number>`count(distinct case when ${condicao} then ${messageId} end)`.mapWith(Number)

/** As quatro contagens, prontas para entrar num `.select({ ... })`. */
export const contagensDeMensagens = {
  sent: distintasQuando(
    sql`${events.eventType} in ('whatsapp_status_sent','whatsapp_status_delivered','whatsapp_status_read')`,
  ),
  delivered: distintasQuando(
    sql`${events.eventType} in ('whatsapp_status_delivered','whatsapp_status_read')`,
  ),
  read: distintasQuando(sql`${events.eventType} = 'whatsapp_status_read'`),
  failed: distintasQuando(sql`${events.eventType} = 'whatsapp_status_failed'`),
}
