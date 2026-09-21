// Origem (protocolo + host) da requisição em curso.
//
// Com um tenant por subdomínio não existe mais "a" origem da aplicação: cliente-a
// chega por cliente-a.dominio, cliente-b por cliente-b.dominio, e o mesmo código
// responde aos dois. Origem fixa em variável de ambiente manda todo mundo para a
// origem de um só — em desenvolvimento, manda para uma porta onde não há nada.
//
// Cabeçalho de host é dado do cliente, então há dois níveis:
//   requestOrigin  — o que a requisição diz ser (para redirecionar dentro do app,
//                    onde o pior caso é o navegador voltar para onde já estava).
//   trustedOrigin  — o mesmo, mas só se o host for conhecido; senão cai na origem
//                    configurada. É o que vale para link que sai por e-mail, onde
//                    host forjado viraria link de phishing com token real.

const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Origem configurada — usada como reserva e como parte da lista de conhecidos. */
export function configuredOrigin(): string {
  const url = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
  try {
    return new URL(url).origin
  } catch {
    return 'http://localhost:3000'
  }
}

function hostDaRequisicao(req: { headers: Headers }): string | null {
  const encaminhado = req.headers.get('x-forwarded-host')
  const host = (encaminhado || req.headers.get('host') || '').trim()
  if (!host || host.includes(',') || /\s/.test(host)) return null
  return host
}

function protocoloDaRequisicao(req: { headers: Headers }, host: string): string {
  const encaminhado = (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim()
  if (encaminhado === 'http' || encaminhado === 'https') return encaminhado
  const semPorta = host.replace(/:\d+$/, '')
  return LOCAIS.has(semPorta) ? 'http' : 'https'
}

/** Origem que a requisição declara. Null quando o cabeçalho de host não serve. */
export function requestOrigin(req: { headers: Headers }): string | null {
  const host = hostDaRequisicao(req)
  if (!host) return null
  return `${protocoloDaRequisicao(req, host)}://${host}`
}

/** Host conhecido: local, o host configurado, ou o domínio raiz e seus subdomínios. */
export function isKnownHost(host: string): boolean {
  const semPorta = host.replace(/:\d+$/, '').toLowerCase()
  if (LOCAIS.has(semPorta)) return true

  try {
    if (semPorta === new URL(configuredOrigin()).hostname.toLowerCase()) return true
  } catch { /* origem configurada inválida — segue para a raiz */ }

  const raiz = (process.env.APP_ROOT_DOMAIN || '').trim().toLowerCase().replace(/^\./, '')
  if (raiz && (semPorta === raiz || semPorta.endsWith('.' + raiz))) return true

  return false
}

/**
 * Origem para link que sai da aplicação (e-mail de convite, recuperação de senha).
 * Host desconhecido cai na origem configurada, nunca no que o cabeçalho pediu.
 */
export function trustedOrigin(req: { headers: Headers }): string {
  const host = hostDaRequisicao(req)
  if (!host || !isKnownHost(host)) return configuredOrigin()
  return `${protocoloDaRequisicao(req, host)}://${host}`
}
