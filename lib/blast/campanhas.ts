import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients, users } from '@/lib/db/schema'

/* A consulta de GET /api/sdr/blast/campaigns mora aqui, e não dentro da rota,
 * porque o Next valida os exports de um `route.ts` contra uma lista fechada
 * (GET, POST, dynamic, ...): exportar daqui é a única forma de o teste exercitar
 * a consulta de verdade em vez de reescrevê-la. E ela precisa de teste de
 * verdade: na primeira passada da migração esta função devolvia 500 para todo
 * mundo e o teste que a "cobria" era uma cópia do SQL. */

export type FiltroDeTipo = 'manual' | 'campanha' | null

/* `.mapWith(Number)` não é enfeite: `SUM(CASE ... THEN 1 ELSE 0 END)` devolve
 * bigint, e o node-postgres entrega bigint como STRING. O PGlite, usado nos
 * testes, entrega como number — por isso nenhum teste que só leia o resultado
 * contra PGlite consegue proteger esta linha. Quem protege é
 * lib/db/agregados.test.ts, que inspeciona o decodificador do próprio fragmento. */
const porStatus = (status: string) =>
  sql<number>`SUM(CASE WHEN ${blastRecipients.status} = ${status} THEN 1 ELSE 0 END)`.mapWith(Number)

/** Exportado para o teste conseguir inspecionar os fragmentos de verdade. */
export const contagensPorStatus = {
  pendente: porStatus('pendente'),
  enviado:  porStatus('enviado'),
  entregue: porStatus('entregue'),
  lido:     porStatus('lido'),
  falhou:   porStatus('falhou'),
}

/** Campanhas do cliente com a contagem de destinatários por status. */
export async function listarCampanhas(tenantId: string, tipo: FiltroDeTipo) {
  return db
    .select({
      id:              blastCampaigns.id,
      kind:            blastCampaigns.kind,
      template:        blastCampaigns.template,
      totalSolicitado: blastCampaigns.totalSolicitado,
      skipped:         blastCampaigns.skipped,
      started:         blastCampaigns.started,
      status:          blastCampaigns.status,
      createdAt:       blastCampaigns.createdAt,
      createdByName:   users.name,
      ...contagensPorStatus,
    })
    .from(blastCampaigns)
    .leftJoin(users, eq(blastCampaigns.createdBy, users.id))
    .leftJoin(blastRecipients, eq(blastRecipients.campaignId, blastCampaigns.id))
    .where(
      tipo
        ? and(eq(blastCampaigns.tenantId, tenantId), eq(blastCampaigns.kind, tipo))
        : eq(blastCampaigns.tenantId, tenantId),
    )
    /* `users.name` TEM de estar no GROUP BY. O SQLite aceitava a coluna solta; o
     * Postgres recusa com 42803, porque agrupar pela chave primária de
     * blast_campaigns determina funcionalmente só as colunas DAQUELA tabela —
     * nunca as do leftJoin. É erro de PLANO: estourava com zero linhas também, ou
     * seja, a tela de Disparos devolvia 500 para todo mundo, o tempo todo.
     * Agrupar também por users.name não parte grupo nenhum: cada campanha tem um
     * criador só. */
    .groupBy(blastCampaigns.id, users.name)
    .orderBy(desc(blastCampaigns.createdAt))
}
