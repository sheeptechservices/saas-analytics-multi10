// Slug do tenant.
//
// Com roteamento por subdomínio, o slug deixa de ser identificador interno e vira
// endereço público: cliente-a.dominio. Por isso o formato segue o que um rótulo de
// DNS aceita — minúsculas, dígitos e hífen, 3 a 63 caracteres, sem hífen na ponta —
// e por isso existe lista de reservados: quem pegar 'app' ou 'api' fica com um
// endereço que a plataforma precisa para si.

export const SLUG_MIN = 3
export const SLUG_MAX = 63

const FORMATO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/**
 * Nomes que a plataforma usa, ou vai usar, como subdomínio próprio. Um tenant com
 * qualquer um deles sequestra um endereço do produto — ou recebe o tráfego dele.
 */
export const SLUGS_RESERVADOS = [
  'www', 'app', 'api', 'admin', 'master', 'login', 'auth', 'static',
  'assets', 'cdn', 'mail', 'ftp', 'blog', 'docs', 'status', 'help', 'support',
] as const

export type SlugInvalido =
  | 'vazio'
  | 'curto'
  | 'longo'
  | 'formato'
  | 'hifen-na-ponta'
  | 'reservado'

const MOTIVOS: Record<SlugInvalido, string> = {
  'vazio':          'Informe o endereço do cliente.',
  'curto':          `O endereço precisa de pelo menos ${SLUG_MIN} caracteres.`,
  'longo':          `O endereço passa de ${SLUG_MAX} caracteres.`,
  'formato':        'Use apenas letras minúsculas, números e hífen.',
  'hifen-na-ponta': 'O endereço não pode começar nem terminar com hífen.',
  'reservado':      'Este endereço é reservado pela plataforma.',
}

export function slugErrorMessage(motivo: SlugInvalido): string {
  return MOTIVOS[motivo]
}

/** Null quando o slug serve; o motivo quando não serve. */
export function validateSlug(valor: unknown): SlugInvalido | null {
  const slug = typeof valor === 'string' ? valor.trim() : ''
  if (!slug)                                   return 'vazio'
  if (slug.length < SLUG_MIN)                  return 'curto'
  if (slug.length > SLUG_MAX)                  return 'longo'
  if (slug.startsWith('-') || slug.endsWith('-')) return 'hifen-na-ponta'
  if (!FORMATO.test(slug))                     return 'formato'
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) return 'reservado'
  return null
}

export function isValidSlug(valor: unknown): boolean {
  return validateSlug(valor) === null
}

/**
 * Sugestão a partir do nome do cliente — ponto de partida para quem cadastra,
 * nunca o valor final: o resultado ainda passa por validateSlug.
 */
export function slugFromName(nome: string): string {
  return String(nome ?? '')
    .normalize('NFD')
    .split('')
    .filter(c => { const n = c.normalize('NFD').charCodeAt(0); return n < 0x0300 || n > 0x036f })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}
