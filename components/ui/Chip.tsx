import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/* Chip de filtro: botão de alternância pequeno, em pill. Ativo = tinta cheia
   (--ink / branco); inativo = contorno --line com texto mudo; hover escurece
   texto e borda. Estilo em .chip no globals.css, estado em aria-pressed —
   o mesmo atributo que o leitor de tela anuncia ("pressionado").

   Serve tanto para filtro de escolha única (Todas / Aguardando / Frias) quanto
   para seleção múltipla (etapas visíveis do funil). Agrupe com <ChipGroup>,
   que dá o nome acessível ao conjunto. */

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ active = false, type = 'button', className, children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={cn('chip', className)}
      {...props}
    >
      {children}
    </button>
  )
)
Chip.displayName = 'Chip'

interface ChipGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nome acessível do grupo (ex.: "Filtrar sessões por status"). */
  label: string
}

export function ChipGroup({ label, className, children, ...props }: ChipGroupProps) {
  return (
    <div role="group" aria-label={label} className={cn('chip-group', className)} {...props}>
      {children}
    </div>
  )
}
