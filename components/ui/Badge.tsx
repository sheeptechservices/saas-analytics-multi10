import { cn } from '@/lib/utils'

/* A04 — Correção da auditoria de 21/09/2026.
   Oito geometrias de pill circulavam (9 a 12px, peso 700 e 800, raio 4/99/100).
   Uma só geometria, definida em .pill no globals.css, com as quatro famílias
   semânticas de A05. As cores literais saíram: agora vêm dos tokens, então o
   verde de "sucesso" é o mesmo em todas as telas.

   `dot` é opt-out: o ponto interno ajuda em status, atrapalha em rótulo de
   papel ou contagem — antes ele era obrigatório e as telas contornavam
   escrevendo a pill à mão. */

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'danger' | 'warn' | 'info'

interface BadgeProps {
  variant?: BadgeVariant
  dot?: boolean
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'neutral', dot = true, children, className }: BadgeProps) {
  return (
    <span className={cn('pill', `pill-${variant}`, dot && 'pill-dot', className)}>
      {children}
    </span>
  )
}

/* Mapa dos nomes antigos, para migração sem quebra:
   draft   → primary
   pending → warn   (era vermelho; "pendente" é alerta, não erro)
   Manter até o grep por variant="draft" voltar vazio. */
export const legacyBadgeVariant: Record<string, BadgeVariant> = {
  draft: 'primary',
  pending: 'warn',
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  danger: 'danger',
  primary: 'primary',
}
