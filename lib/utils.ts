export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ')
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(date: Date | number | string): string {
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function daysAgo(date: Date | number | string): number {
  const d = new Date(date)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function weekLabel(weeksAgo: number): string {
  if (weeksAgo === 0) return 'Esta sem.'
  if (weeksAgo === 1) return 'Sem. passada'
  const d = new Date()
  d.setDate(d.getDate() - weeksAgo * 7)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
