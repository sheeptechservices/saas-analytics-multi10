// Resolve a conexão do Supabase de um tenant a partir da fonte de dados salva.
//
// A credencial fica cifrada em `data_sources.config_enc`; cada rota que fala com
// o banco do cliente precisava repetir o select + decrypt + JSON.parse. Repetir
// isso é como uma credencial vaza: basta uma cópia esquecer um cuidado.
//
// São DUAS recusas, e tratá-las como uma só manda o operador para o lugar errado:
//
//   `nao_configurada` — o tenant não tem fonte, ou tem uma fonte sem
//                       connectionString. O conselho é cadastrar a fonte.
//   `ilegivel`        — a credencial ESTÁ lá e não abre: ENCRYPTION_SECRET trocado
//                       ou valor corrompido. Mandar cadastrar uma fonte que já
//                       existe é beco sem saída; o que resolve é salvar a
//                       credencial de novo, com a chave que está valendo agora.
//
// Por isso o retorno é um union discriminado em vez de `string | null`: a
// `connectionString` só existe no ramo `ok`, então nenhum call site consegue
// esquecer de decidir o que faz com `ilegivel` — o compilador cobra.
//
// Nada daqui carrega texto de erro. O que sai é o discriminante; a mensagem do
// decrypt e a do JSON.parse levam pedaço do valor decifrado e ficam fora até do
// log — de lá vai só o nome do erro e o tenant.

import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

export const PROVIDER_SDR = 'supabase-n8n'

/** O que a fonte do tenant deu. Ver o cabeçalho para o que cada estado significa. */
export type FonteDoTenant =
  | { estado: 'ok'; connectionString: string }
  | { estado: 'nao_configurada' }
  | { estado: 'ilegivel' }

/**
 * Decide o estado a partir do `config_enc` guardado — sem tocar no banco, que é o
 * que deixa esta decisão inteira sob teste (lib/sdr/conexao-tenant.test.ts).
 *
 * `tenantId` entra só para o log: sem ele o operador lê "falhou ao decifrar" e não
 * sabe de quem.
 */
export function lerFonteCifrada(configEnc: string | null | undefined, tenantId: string): FonteDoTenant {
  if (!configEnc) return { estado: 'nao_configurada' }

  let cfg: { connectionString?: unknown }
  try {
    cfg = JSON.parse(decrypt(configEnc)) as { connectionString?: unknown }
  } catch (err) {
    // Só o NOME do erro: a mensagem do decrypt e a do `SyntaxError` do JSON.parse
    // podem trazer trecho do texto decifrado. Este é o único lugar que registra a
    // credencial ilegível — sem esta linha, uma rotação de chave é invisível.
    console.error(
      '[sdr conexao-tenant] credencial ilegível — tenant',
      tenantId,
      err instanceof Error ? err.name : typeof err,
    )
    return { estado: 'ilegivel' }
  }

  // Decifrou, mas a fonte está cadastrada pela metade: isso é "falta configurar",
  // não "não dá para ler" — quem resolve é quem termina o cadastro.
  return typeof cfg.connectionString === 'string' && cfg.connectionString
    ? { estado: 'ok', connectionString: cfg.connectionString }
    : { estado: 'nao_configurada' }
}

export async function conexaoDoTenant(tenantId: string): Promise<FonteDoTenant> {
  const [linha] = await db
    .select({ configEnc: dataSources.configEnc })
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, PROVIDER_SDR),
    ))
    .limit(1)

  return lerFonteCifrada(linha?.configEnc, tenantId)
}
