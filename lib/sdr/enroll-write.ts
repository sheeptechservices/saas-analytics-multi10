// Inscrição de leads na campanha do SDR — escreve `lead_actions` na base do cliente.
//
// POR QUE EXISTE
// Isto era um webhook do n8n: a app mandava `{ tenantId, leadIds, fase, agendarPara }`
// e o fluxo montava um INSERT por lead com os valores COLADOS NO TEXTO DO SQL. Dois
// problemas de uma vez. O primeiro é injeção: uma fase com aspas deixava de ser dado
// e virava comando. O segundo é a contagem — a tela mostrava o que o n8n tivesse
// devolvido, quando devolvia, e o número não tinha relação com as linhas criadas.
// Aqui é UMA consulta parametrizada, e o que volta é o que o banco realmente gravou.
//
// AS DUAS GUARDAS vêm do fluxo antigo e continuam valendo:
//   1. o lead tem de existir em `leads`;
//   2. o lead não pode já ter uma `lead_actions` com `ativo = true`.
// Elas ficam dentro do próprio INSERT porque é assim que um lead ausente ou já
// inscrito é PULADO em vez de virar erro — o pedido inteiro não cai por causa de um.
//
// REGRA DO PRODUTO: este é um dos poucos arquivos que ESCREVE na base do cliente.
// Nada aqui lê ou deriva credencial: a string de conexão chega pronta de quem chamou
// (lib/sdr/conexao-tenant) e nunca entra em log nem em mensagem de erro.

import { withSdrDb } from './pg'

export type InscricaoPedido = {
  leadIds: string[]
  fase: string
  agendarPara?: string
}

export type ResultadoInscricao = {
  /** Linhas realmente criadas em `lead_actions`. */
  inscritos: number
  /** Os `lead_id` que entraram — os pulados pelas guardas não aparecem aqui. NÃO são
   *  as chaves primárias das `lead_actions` criadas; o `RETURNING` devolve o lead. */
  leadIds: string[]
}

/**
 * Pedido malformado, não falha de banco. Fica separado de `SdrDbError` de propósito:
 * a resposta certa para isto é 400 (o cliente mandou errado), não 502.
 */
export class InscricaoInvalida extends Error {
  readonly code = 'agendar_para_invalido' as const

  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'InscricaoInvalida'
  }
}

/* Uma instrução só para o lote inteiro: `jsonb_to_recordset` abre o array de ids em
 * linhas, e o JOIN implícito com as duas guardas decide, lead a lead, quem entra. O
 * `RETURNING` é o que permite contar sem confiar em palpite. Nenhum valor é
 * concatenado neste texto — os quatro chegam como $1..$4. */
const SQL_INSCREVER = `
INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
SELECT p.lead_id, $2::text, $3::int, true, $4::timestamptz
  FROM jsonb_to_recordset($1::jsonb) AS p(lead_id uuid)
 WHERE EXISTS (SELECT 1 FROM leads l WHERE l.id = p.lead_id)
   AND NOT EXISTS (SELECT 1 FROM lead_actions a WHERE a.lead_id = p.lead_id AND a.ativo = true)
RETURNING lead_id`

/**
 * Número da fase a partir do nome dela: "Template 7" → 7. É o mesmo cálculo que o
 * fluxo do n8n fazia (`String(fase).match(/(\d+)/)`), inclusive o padrão 1 quando o
 * nome não tem dígito nenhum — mudar isso aqui mudaria a fase de quem já está na
 * campanha.
 */
function idDaFase(fase: string): number {
  const achado = String(fase).match(/(\d+)/)
  return achado ? parseInt(achado[1], 10) : 1
}

/**
 * Desduplica preservando a ordem, e descarta o que não é texto com conteúdo — o
 * mesmo filtro do fluxo antigo (`typeof v === 'string' && v.trim()`, depois `.trim()`).
 *
 * A desduplicação NÃO é zelo: dentro de uma única instrução, o `NOT EXISTS
 * (... ativo = true)` enxerga a tabela como ela estava ANTES do INSERT, então as
 * linhas que a própria instrução insere não aparecem umas para as outras. O mesmo id
 * repetido no mesmo lote passaria duas vezes pela guarda e criaria DUAS ações ativas
 * para a mesma pessoa. Quem impede isso é este `Set`; a guarda do banco, sozinha, não.
 *
 * O QUE ISTO NÃO GARANTE: dois PEDIDOS simultâneos com o mesmo lead. Cada um lê a
 * tabela antes do INSERT do outro, os dois passam pela guarda e os dois gravam — duas
 * ações ativas para a mesma pessoa, de novo. O `Set` enxerga um pedido só, então daqui
 * não dá para fechar; é o mesmo buraco que o fluxo do n8n tinha e continua aberto de
 * propósito. Fechar de verdade pede um índice único NA BASE DO CLIENTE (na linha de
 * `UNIQUE (lead_id) WHERE ativo`), que não é nosso para criar. E não é hipótese: um
 * censo de leitura na base em produção achou 3 leads exatamente assim.
 */
function idsUnicos(leadIds: unknown): string[] {
  if (!Array.isArray(leadIds)) return []

  const vistos = new Set<string>()
  for (const bruto of leadIds) {
    if (typeof bruto !== 'string') continue
    const id = bruto.trim()
    if (id) vistos.add(id)
  }
  return Array.from(vistos)
}

/* A forma aceita: ISO 8601, data sozinha ou data com hora e fuso opcionais — o que a
 * API recebe hoje (a tela de leads nem manda `agendarPara`; quem manda é quem chama a
 * rota direto). Os três grupos são ano, mês e dia: é por eles que o calendário é
 * conferido, porque a hora e o fuso o `Date` já recusa sozinho quando não existem. */
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Momento do primeiro disparo. Ausente significa "agora", como no fluxo antigo
 * (`body.agendarPara || new Date().toISOString()`).
 *
 * TRÊS CONFERÊNCIAS, e nenhuma delas é redundante:
 *   1. a FORMA tem de ser ISO 8601 — sem isso não há componentes de calendário para
 *      olhar, e sobraria o `Date.parse`, que aceita quase qualquer coisa;
 *   2. o CALENDÁRIO tem de sobreviver à ida e volta. `new Date('2026-02-30')` não
 *      falha: ele ROLA para 2 de março. Quem digitou 30 de fevereiro não pode ser
 *      mudado de mansinho para outro dia — tem de ouvir que a data não existe. Sem
 *      esta volta, o valor chegava ao Postgres, que é estrito, e o 22008 dele virava
 *      um 502 "falha ao consultar a base do SDR" — o banco levando a culpa do typo;
 *   3. o INSTANTE tem de existir: hora 47, fuso impossível e afins morrem aqui.
 *
 * O que sai é o instante normalizado em UTC, não o texto cru. É o mesmo ponto no tempo
 * (a coluna é `timestamptz`), com uma diferença que importa: um texto sem fuso seria
 * resolvido pelo `TimeZone` do servidor de banco, e aí o que foi gravado não seria o
 * que foi conferido aqui. Assim o que o Postgres recebe é exatamente o que validamos.
 */
function quandoAgendar(agendarPara: string | undefined): string {
  if (agendarPara === undefined) return new Date().toISOString()

  const texto  = agendarPara.trim()
  const partes = ISO_8601.exec(texto)
  if (!partes) throw new InscricaoInvalida('agendarPara não é uma data/hora ISO 8601 válida')

  const ano = Number(partes[1])
  const mes = Number(partes[2])
  const dia = Number(partes[3])

  // `setUTCFullYear` em vez de `Date.UTC` porque este não tem a herança de tratar ano
  // de dois dígitos como 19xx — com ele, "0099-01-01" viraria 1999 e seria recusado.
  const calendario = new Date(0)
  calendario.setUTCFullYear(ano, mes - 1, dia)
  if (
    calendario.getUTCFullYear() !== ano ||
    calendario.getUTCMonth() !== mes - 1 ||
    calendario.getUTCDate() !== dia
  ) {
    throw new InscricaoInvalida(`agendarPara tem uma data que não existe no calendário: ${texto}`)
  }

  const instante = new Date(texto)
  if (Number.isNaN(instante.getTime())) {
    throw new InscricaoInvalida('agendarPara não é uma data/hora ISO 8601 válida')
  }
  return instante.toISOString()
}

/**
 * Cria uma `lead_actions` ativa para cada lead que existe e ainda não tem uma.
 *
 * Lote vazio não abre conexão. Erro de banco sobe como `SdrDbError` (é o `withSdrDb`
 * que traduz) e erro de pedido, como `InscricaoInvalida` — nenhum dos dois é engolido:
 * devolver "ok" para uma inscrição que não aconteceu é o pior resultado possível aqui.
 */
export async function inscreverLeads(
  connectionString: string,
  pedido: InscricaoPedido,
): Promise<ResultadoInscricao> {
  // Antes do curto-circuito do lote vazio: pedido inválido é inválido mesmo quando
  // não haveria nada a gravar.
  const quando = quandoAgendar(pedido.agendarPara)

  const ids = idsUnicos(pedido.leadIds)
  if (ids.length === 0) return { inscritos: 0, leadIds: [] }

  const linhas = ids.map(lead_id => ({ lead_id }))

  const res = await withSdrDb(connectionString, sdr =>
    sdr.query<{ lead_id: string }>(SQL_INSCREVER, [
      JSON.stringify(linhas),
      pedido.fase,
      idDaFase(pedido.fase),
      quando,
    ]),
  )

  const gravados = res.rows.map(r => r.lead_id)
  return { inscritos: gravados.length, leadIds: gravados }
}
