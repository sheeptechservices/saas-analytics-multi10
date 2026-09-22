import { cn } from '@/lib/utils'

/* A07 — Correção da auditoria de 21/09/2026.
   Quatro receitas de cartão conviviam no produto:
     r16 + gray3 + sem sombra   (dashboard, settings, leads)
     r12 + gray3 + --shadow     (marketing)
     r12 + line  + --shadow-md  (KpiCard, + faixa de 4px)
     r14 + gray3 + sem sombra   (disparos)
   Duas bastavam, e estão em .card / .card-tight no globals.css (mais .card-flat,
   ver abaixo). Este componente só as embala e adiciona o cabeçalho opcional,
   que também era repetido inline.

   As três sombras literais (0 20px 60px .18 / .2, 0 8px 32px .14) viraram
   --shadow-modal e --shadow-menu.

   Espaçamentos em px explícito (p-[24px], mb-[16px]...), não na escala do
   Tailwind: o app define `html { font-size: 15px }`, então px-6 daria 22.5px
   em vez dos 24px do spec, e mb-4 daria 15px em vez de 16px. */

/* 'flat' é a terceira receita, criada no redesenho do dashboard Visão geral:
   r12 + hairline --line, SEM sombra e sem hover, padding 20px 22px. Painéis
   de dado se separam pela borda, não pela elevação. */
type CardVariant = 'section' | 'tight' | 'flat'

const variantClass: Record<CardVariant, string> = {
  section: 'card',
  tight:   'card-tight',
  flat:    'card-flat',
}

const variantPadding: Record<CardVariant, string> = {
  section: 'p-[24px]',
  tight:   'px-[20px] py-[18px]',
  flat:    'px-[22px] py-[20px]',
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  /** Faixa de accent à esquerda, espessura --rail. */
  accent?: string
  padded?: boolean
}

export function Card({
  variant = 'section', accent, padded = true, className, style, children, ...props
}: CardProps) {
  return (
    <div
      className={cn(
        variantClass[variant],
        accent && 'card-rail',
        padded && variantPadding[variant],
        className
      )}
      style={accent ? { ...style, ['--accent' as string]: accent } : style}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  sub?: string
  action?: React.ReactNode
}

export function CardHeader({ title, sub, action }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-[16px] mb-[16px]">
      <div>
        <h3 className="text-[15px] font-extrabold text-ink tracking-[-0.01em]">{title}</h3>
        {sub && <p className="text-xs font-medium text-muted mt-[4px]">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

/* Modal: r20 + --shadow-modal. Antes eram r16 e r20 com sombras literais
   diferentes em disparos:535 e settings:806. */

interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number
}

export function ModalCard({ width = 460, className, style, children, ...props }: ModalProps) {
  return (
    <div
      className={cn('modal w-full flex flex-col overflow-hidden', className)}
      style={{ maxWidth: width, animation: 'modalSlideUp .2s ease both', ...style }}
      {...props}
    >
      {children}
    </div>
  )
}
