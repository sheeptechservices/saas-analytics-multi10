import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/* A02 — Correção da auditoria de 21/09/2026.
   Seis geometrias de botão primário circulavam pelas telas. Duas propriedades
   novas absorvem todas: `shape` ("rounded" | "pill") e `fullWidth`. O pill era
   o improviso mais comum (settings, ai, kommo, credenciais), então virou uma
   opção legítima em vez de continuar sendo reescrito inline.

   A03 — o primário usa sempre --primary-contrast, nunca --black. */

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger'
type Size = 'sm' | 'md' | 'lg'
type Shape = 'rounded' | 'pill'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  shape?: Shape
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', shape = 'rounded', fullWidth, className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'btn',
        `btn-${variant}`,
        `btn-${size}`,
        shape === 'pill' && 'btn-pill',
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
)
Button.displayName = 'Button'

/* Botão de ícone: quadrado, sem label. Substitui os botões 26×26, 30×30 e
   32×32 escritos inline em dashboard/layout, ranking e kommo. `allow-small`
   isenta do mínimo de 44px no mobile quando há um alvo maior ao redor; quando
   não há, passe className="touch-target" (44×44 só abaixo de 768px). */

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Extract<Variant, 'secondary' | 'ghost' | 'danger'>
  size?: Size
  label: string
}

/* Lados em px explícito: com `html { font-size: 15px }`, w-7/w-8/w-10 dariam
   26.25/30/37.5px em vez dos 28/32/40px pretendidos. */
const iconBox: Record<Size, string> = {
  sm: 'w-[28px] h-[28px]',
  md: 'w-[32px] h-[32px]',
  lg: 'w-[40px] h-[40px]',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', label, className, children, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn('btn', `btn-${variant}`, iconBox[size], 'p-0 allow-small', className)}
      {...props}
    >
      {children}
    </button>
  )
)
IconButton.displayName = 'IconButton'
