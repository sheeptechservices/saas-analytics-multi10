// Normalização de datas vindas de fontes mistas: Date (Drizzle em Server Components),
// string ISO (serialização JSON de um Date numa API), ou número (ms ou segundos Unix).
// Nunca produz "Invalid Date" — valor ausente/inválido vira null.

export function toMs(ts: Date | string | number | null | undefined): number | null {
  if (ts == null || ts === '') return null
  if (ts instanceof Date) {
    const t = ts.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts   // < 1e12 = epoch em segundos → ms
  const t = Date.parse(ts)                                        // string ISO
  return Number.isNaN(t) ? null : t
}

export function toDate(ts: Date | string | number | null | undefined): Date | null {
  const ms = toMs(ts)
  return ms == null ? null : new Date(ms)
}

// Data curta pt-BR (dd/mm/aaaa) ou '—' se ausente/inválida.
export function fmtDateBr(ts: Date | string | number | null | undefined): string {
  const d = toDate(ts)
  return d ? d.toLocaleDateString('pt-BR') : '—'
}
