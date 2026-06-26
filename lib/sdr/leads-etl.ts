// Pure ETL helpers shared by /api/sdr/leads/import and /api/sdr/leads/manual.
// No side effects, no DB access, no external dependencies.

const E164_RE = /^\+[1-9]\d{6,14}$/

/** Maps spreadsheet header (PT or EN) to internal canonical key. */
export function mapKey(raw: string): string {
  switch (raw.toLowerCase().trim()) {
    case 'nome':     case 'name':                        return 'name'
    case 'telefone': case 'phone': case 'tel':
    case 'celular':                                      return 'phone'
    case 'empresa':  case 'company':                     return 'company'
    case 'origem':   case 'source':                      return 'source'
    case 'status':                                       return 'status'
    default:                                             return raw.toLowerCase().trim()
  }
}

/**
 * Normalizes a phone string to E.164. Returns null if the result is not valid E.164.
 * Strategy: keep only digits and leading +; if no +, assume Brazil (+55) when < 12 digits.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const stripped = raw.replace(/[^\d+]/g, '')
  if (!stripped) return null

  let normalized: string
  if (stripped.startsWith('+')) {
    normalized = stripped
  } else {
    // No + prefix: use digit count to guess whether country code is present.
    // Brazilian numbers without DDI are 10–11 digits (DDD + number).
    // With +55 they become 12–13 digits.
    normalized = stripped.length >= 12 ? '+' + stripped : '+55' + stripped
  }

  return E164_RE.test(normalized) ? normalized : null
}

/**
 * Canonical dedup key — format-agnostic, comparable across the file and the DB.
 * Produces DDD(2) + 8 digits, collapsing the 9th-digit mobile prefix so that
 * "+5511 9 8888-7777" and the DB value "551188887777" both yield "1188887777".
 * Returns null when the input cannot be reduced to a valid key.
 */
export function phoneKey(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  let national = digits

  // Strip Brazil DDI when present and remainder is 10 or 11 digits (12/13 total)
  if (national.startsWith('55') && (national.length === 12 || national.length === 13)) {
    national = national.slice(2)
  }

  // Remove 9th-digit mobile prefix: DDD(2) + '9' + 8 digits → DDD(2) + 8 digits
  if (national.length === 11 && national[2] === '9') {
    national = national.slice(0, 2) + national.slice(3)
  }

  return national.length >= 10 ? national : null
}

/** Returns the first word of a string, or empty string. */
export function firstWord(s: unknown): string {
  return String(s ?? '').trim().split(/\s+/)[0] ?? ''
}
