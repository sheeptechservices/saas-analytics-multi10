/* Degradação suave de leitura acessória.
 *
 * Fica separado de lib/db/index.ts de propósito: quem importa daqui (lib/tenant.ts,
 * lib/user.ts) não precisa do cliente, e o arquivo continua valendo quando o banco
 * por baixo mudar. */

/** Percorre erro.cause até o fim, com trava contra ciclo. */
export function cadeiaDeCausas(erro: unknown): unknown[] {
  const cadeia: unknown[] = []
  const vistos = new Set<unknown>()
  let atual: unknown = erro
  while (atual && typeof atual === 'object' && !vistos.has(atual)) {
    vistos.add(atual)
    cadeia.push(atual)
    atual = (atual as { cause?: unknown }).cause
  }
  return cadeia
}

/** Diz se o erro (ou alguma causa dele) tem `code`, marca de erro de driver ou
 *  de rede. Sem isso, é bug nosso: TypeError, ReferenceError e parentes. */
export function temCodigo(erro: unknown): boolean {
  return cadeiaDeCausas(erro).some(no => {
    const codigo = (no as { code?: unknown }).code
    return typeof codigo === 'string' && codigo.length > 0
  })
}

/** Resumo do erro para log: só código e nome. Nunca a mensagem inteira, que pode
 *  arrastar URL com token ou cabeçalho de autorização para o console. */
export function resumoDoErro(erro: unknown): string {
  for (const no of cadeiaDeCausas(erro)) {
    const codigo = (no as { code?: unknown }).code
    if (typeof codigo === 'string' && codigo) return codigo
  }
  const nome = (erro as { name?: unknown } | null)?.name
  return typeof nome === 'string' && nome ? nome : 'erro desconhecido'
}

/**
 * Se a consulta falhar, devolve o valor padrão e deixa uma linha no log em vez
 * de derrubar a árvore inteira.
 *
 * Só para dado decorativo — marca e perfil. **Não** use em consulta que decide
 * permissão: ali o padrão silencioso vira brecha, e a falha tem de subir.
 */
export async function comFallback<T>(
  consulta: () => Promise<T>,
  padrao: T,
  rotulo: string,
  registrar: (linha: string) => void = linha => console.warn(linha),
): Promise<T> {
  try {
    return await consulta()
  } catch (erro) {
    registrar(`[${rotulo}] consulta falhou (${resumoDoErro(erro)}) — seguindo com o valor padrão`)
    /* Erro de driver traz `code` e a mensagem pode carregar URL com token, por
     * isso o log acima é resumido. Um erro sem `code` é bug nosso (TypeError e
     * afins) e não vaza credencial: fora de produção, mostra ele inteiro, senão
     * o bug vira um padrão silencioso que ninguém acha. */
    if (process.env.NODE_ENV !== 'production' && !temCodigo(erro)) {
      console.warn(`[${rotulo}] detalhe do erro sem código (provável bug):`, erro)
    }
    return padrao
  }
}
