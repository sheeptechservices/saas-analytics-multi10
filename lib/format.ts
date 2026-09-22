// Formatação de dado para leitura — número, data curta, tempo relativo e campo vazio.
//
// Um lugar só, porque a variação hoje é ruído: a mesma contagem sai "1.284" numa
// tela e "1284" na outra, e o campo sem valor aparece como traço, vazio ou nada,
// dependendo do arquivo. Quem lê a tabela não sabe se mudou o dado ou o formato.
//
// Locale e fuso ficam fixos em pt-BR / America/Sao_Paulo: a plataforma é
// brasileira e o servidor não roda no fuso de quem lê. Sem fixar, a mesma data
// sai com hora diferente conforme o processo que renderizou.

import { toDate } from '@/lib/date'

export const FUSO_BR = 'America/Sao_Paulo'
const LOCALE_BR = 'pt-BR'

/** Marca de valor ausente. Traço de meia-quadratim, nunca hífen de teclado. */
export const TRACO_VAZIO = '—'

// ─── Tempo relativo ───────────────────────────────────────────────────────────

/**
 * Distância até agora, curta: "agora", "12min", "3h", "5d".
 *
 * Assinatura preservada — é consumida por Contatos e Conversas. O absoluto
 * correspondente vai no `title` do elemento, com formatDateTimeLong.
 */
export function timeAgo(ms: number | null): string {
  if (!ms) return TRACO_VAZIO
  const diff = Date.now() - ms
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'agora'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

// ─── Número ───────────────────────────────────────────────────────────────────

/**
 * Número em pt-BR: ponto de milhar, vírgula decimal, sem casas por padrão.
 *
 * Formatar não alinha coluna: para os dígitos ficarem uns sobre os outros, a
 * célula precisa de `tabular-nums` no CSS, porque a fonte é proporcional.
 */
export function formatNumber(valor: number | null | undefined, casas = 0): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO_VAZIO
  return valor.toLocaleString(LOCALE_BR, {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

/** Dinheiro em reais. Ausente vira traço, nunca "R$ 0,00" — zero é um valor. */
export function formatCurrency(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO_VAZIO
  return valor.toLocaleString(LOCALE_BR, {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Percentual já na escala de exibição (42.5 → "42,5%"), que é como a API
 * devolve — não recebe fração.
 */
export function formatPercent(valor: number | null | undefined, casas = 1): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO_VAZIO
  return `${formatNumber(valor, casas)}%`
}

// ─── Data ─────────────────────────────────────────────────────────────────────

function partesBr(data: Date): Record<string, string> {
  const partes = new Intl.DateTimeFormat(LOCALE_BR, {
    timeZone: FUSO_BR,
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(data)
  return Object.fromEntries(partes.map(p => [p.type, p.value]))
}

/**
 * Data curta com hora: `31/08 09:12`. Sem ano, porque em lista de operação o
 * ano é o corrente e ocuparia coluna sem informar. O absoluto completo vai no
 * `title`, com formatDateTimeLong.
 */
export function formatShortDateTime(ts: Date | string | number | null | undefined): string {
  const d = toDate(ts)
  if (!d) return TRACO_VAZIO
  const p = partesBr(d)
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

/** Absoluto para o `title`: `31/08/2026 09:12`. */
export function formatDateTimeLong(ts: Date | string | number | null | undefined): string {
  const d = toDate(ts)
  if (!d) return TRACO_VAZIO
  const p = partesBr(d)
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

// ─── Campo vazio ──────────────────────────────────────────────────────────────

/**
 * Os rótulos de campo sem valor, num lugar só.
 *
 * Cada um nomeia o que falta em vez de um traço mudo: quem lê "Sem origem" sabe
 * que o lead entrou sem canal registrado, não que a tela falhou ao carregar.
 * Traço puro fica para número ausente, onde o rótulo não caberia na coluna.
 */
export const ROTULOS_VAZIO = {
  empresa:   'Sem empresa',
  origem:    'Sem origem',
  interacao: 'Sem interação',
  nome:      'Sem nome',
  negocio:   'Sem negócio',
} as const

export type CampoVazio = keyof typeof ROTULOS_VAZIO

/** True quando o valor deve ser exibido como campo vazio. */
export function isEmptyValue(valor: unknown): boolean {
  return valor == null || (typeof valor === 'string' && valor.trim() === '')
}

/** Valor preenchido volta como está (aparado); ausente vira o rótulo do campo. */
export function orEmptyLabel(valor: string | null | undefined, campo: CampoVazio): string {
  return isEmptyValue(valor) ? ROTULOS_VAZIO[campo] : String(valor).trim()
}
