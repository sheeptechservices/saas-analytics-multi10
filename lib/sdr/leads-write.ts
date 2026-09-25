// Gravação dos leads importados na base do cliente (Supabase).
//
// POR QUE EXISTE
// A importação já fazia todo o ETL aqui — normalização, classificação, deduplicação
// — e mandava só o INSERT/UPDATE final para um webhook do n8n. O salto custava uma
// chamada HTTP que podia falhar depois de a tela dizer "ok" e, pior, devolvia
// contagens que a app não tinha como conferir: o relatório mostrava quantos leads
// foram ENVIADOS, não quantos foram gravados. Aqui a app escreve direto, e o número
// que aparece na tela é o que o banco devolveu.
//
// AS DUAS OPERAÇÕES NUMA INSTRUÇÃO SÓ
// `SdrPool` não expõe `connect()` de propósito (ver o cabeçalho de lib/sdr/pg.ts):
// cada `query()` pega e devolve a conexão sozinha, então não existe `BEGIN`/`COMMIT`
// atravessando duas chamadas. A saída não é acrescentar `connect()` à interface — é
// escrever uma instrução única com CTEs. O Postgres trata cada instrução como uma
// transação implícita, então o INSERT e o UPDATE confirmam juntos ou nenhum dos dois
// confirma.
//
// SNAPSHOT ÚNICO — é o comportamento desejado, não descuido
// Todas as CTEs de uma instrução enxergam o MESMO snapshot: o UPDATE não vê as
// linhas que o INSERT acabou de criar. É exatamente o que queremos — o UPDATE só
// completa campos vazios de leads que JÁ existiam, e o lead recém-inserido fica com
// o que o INSERT lhe deu. lib/sdr/leads-write.test.ts prende as duas coisas, e em
// testes separados: a regra do snapshot num teste de SQL cru, e a instrução única
// pela contagem de consultas que o adaptador registra.
//
// A SEMÂNTICA É A DO FLUXO QUE ISTO SUBSTITUI, linha por linha: mesmos defaults
// (`import`/`novo`), mesmo `phone_adjusted` (só os dígitos de `phone`), mesmo UPDATE
// que só preenche coluna vazia. Nada aqui foi "melhorado" — mudar qualquer um desses
// pontos muda dado de cliente que já está gravado.
//
// O NOT EXISTS DO INSERT FECHA UMA CORRIDA, NÃO SUBSTITUI A DEDUP
// A rota lê para deduplicar e só depois grava; entre uma coisa e outra cabe outra
// importação do mesmo arquivo, e as duas inserem o mesmo lead — que o fluxo de
// disparo então aborda duas vezes. A tabela do cliente não tem índice único e não
// podemos criar um, então a guarda é no próprio SELECT do INSERT. Ela é ESTRITAMENTE
// mais estreita que o `phoneKey` da app (que ainda tira o 55 e o nono dígito): só
// pula linha que a dedup da app também pularia — e nem vê o lead cujo
// `phone_adjusted` está nulo, porque `= NULL` não casa com nada. E as contagens
// continuam honestas porque saem do `RETURNING` — linha pulada não volta, logo não
// entra em `idsInseridos` nem no "importados" da tela.
//
// Custo: o planejador vira o NOT EXISTS em anti-join com hash, então é UMA varredura
// da tabela do cliente por importação, não uma por linha da planilha. Medido em
// 60 mil linhas × lote de 1000: ~20 ms, bem dentro do teto de 10 s do perfil padrão.

import { withSdrDb } from './pg'

/* Caracteres que o analisador de JSON do Postgres NÃO carrega — e que a coluna
 * `text` também não guardaria: o byte NUL (`\u0000`, que derruba
 * `jsonb_to_recordset` com SQLSTATE 22P05 e a coluna com 22021) e a metade solta de
 * um par surrogate (JSON inválido, 22P02). Uma única célula com qualquer um deles
 * abortava a instrução inteira: mil linhas na planilha, zero gravadas, e o operador
 * lia "Falha ao consultar a base de dados do SDR" sem saber qual linha era. */
const SEM_REPRESENTACAO =
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Tira do texto o que não tem como ser gravado. Tirar é a única saída fiel: não
 * existe valor equivalente para pôr no lugar — o Postgres não guarda nenhum desses
 * caracteres numa coluna `text` — e recusar a linha custaria um contato real por
 * causa de um byte invisível, que o operador não vê na planilha nem sabe corrigir.
 *
 * Exportada porque o ETL da rota também limpa aqui (o mapa `names` do disparo sai
 * da planilha, não do banco): as duas pontas têm de concordar sobre o nome do lead.
 */
export function limparParaPostgres(texto: string): string {
  return texto.replace(SEM_REPRESENTACAO, '')
}

/** Serializa o lote já limpo — ver `limparParaPostgres`. */
function loteEmJson(lote: unknown): string {
  return JSON.stringify(lote, (_chave, valor: unknown) =>
    typeof valor === 'string' ? limparParaPostgres(valor) : valor,
  )
}

export type LeadNovo = {
  name:    string
  phone:   string
  company: string
  source:  string
  status:  string
}

export type LeadUpdate = {
  id:      string
  name:    string
  company: string
  source:  string
  status:  string
}

export type ResultadoEscrita = {
  /**
   * Um id por lead novo GRAVADO — é o que a tela usa para inscrever os leads depois.
   * Pode ser menor que `novos`: quem já tinha o mesmo `phone_adjusted` na base é
   * pulado pela guarda de corrida do INSERT e não volta no `RETURNING`.
   */
  idsInseridos: string[]
  /** Quantas linhas o UPDATE tocou de verdade. */
  atualizados: number
}

/* O `\D` do regexp_replace precisa chegar ao Postgres como barra + D. No literal de
 * TypeScript isso se escreve `\\D`: `'\D'` viraria só `D`, e o phone_adjusted sairia
 * com todo caractere que não fosse a letra D. */
const SQL_GRAVAR = `
WITH inseridos AS (
  INSERT INTO leads (id, name, phone, phone_adjusted, company, source, status, ativo, created_at)
  SELECT
    gen_random_uuid(),
    x.name,
    x.phone,
    regexp_replace(x.phone, '\\D', '', 'g'),
    NULLIF(x.company, ''),
    COALESCE(NULLIF(x.source, ''), 'import'),
    COALESCE(NULLIF(x.status, ''), 'novo'),
    true,
    now()
  FROM jsonb_to_recordset($1::jsonb)
    AS x(name text, phone text, company text, source text, status text)
  WHERE NOT EXISTS (
    SELECT 1 FROM leads l
     WHERE l.phone_adjusted = regexp_replace(x.phone, '\\D', '', 'g')
  )
  RETURNING id
), atualizados AS (
  UPDATE leads AS l SET
    name    = CASE WHEN COALESCE(l.name,'')    = '' THEN NULLIF(u.name,'')    ELSE l.name    END,
    company = CASE WHEN COALESCE(l.company,'') = '' THEN NULLIF(u.company,'') ELSE l.company END,
    source  = CASE WHEN COALESCE(l.source,'')  = '' THEN NULLIF(u.source,'')  ELSE l.source  END,
    status  = CASE WHEN COALESCE(l.status,'')  = '' THEN NULLIF(u.status,'')  ELSE l.status  END
  FROM jsonb_to_recordset($2::jsonb)
    AS u(id uuid, name text, company text, source text, status text)
  WHERE l.id = u.id
  RETURNING l.id
)
SELECT
  COALESCE((SELECT array_agg(id::text) FROM inseridos), ARRAY[]::text[]) AS ids_inseridos,
  (SELECT count(*) FROM atualizados)::int                                AS atualizados
`

/* Uma linha só: os dois agregados saem da mesma instrução, então não há como o
 * relatório contar um INSERT que não confirmou junto com o UPDATE. */
type LinhaEscrita = {
  ids_inseridos: string[] | null
  atualizados:   number | string | null
}

/**
 * Grava os leads novos e completa os campos vazios dos já existentes, numa única
 * instrução — ou seja, atomicamente, sem transação explícita.
 *
 * Qualquer falha SOBE: `withSdrDb` já traduz o erro do driver em `SdrDbError`
 * (mensagem em português, sem host nem credencial). Nada é engolido aqui de
 * propósito — quem chama precisa saber que a gravação falhou para não dizer ao
 * usuário que a importação deu certo.
 */
export async function gravarLeads(
  connectionString: string,
  novos: LeadNovo[],
  updates: LeadUpdate[],
): Promise<ResultadoEscrita> {
  // Nada a gravar: não vale abrir conexão nem gastar uma ida à base do cliente.
  if (novos.length === 0 && updates.length === 0) {
    return { idsInseridos: [], atualizados: 0 }
  }

  const res = await withSdrDb(connectionString, sdr =>
    sdr.query<LinhaEscrita>(SQL_GRAVAR, [loteEmJson(novos), loteEmJson(updates)]),
  )

  const linha = res.rows[0]
  return {
    idsInseridos: linha?.ids_inseridos ?? [],
    // `count(*)` volta number no PGlite e string no `pg` conforme o tipo; o cast
    // para int já resolve, e o Number() garante que nenhum driver devolva texto.
    atualizados: Number(linha?.atualizados ?? 0),
  }
}
