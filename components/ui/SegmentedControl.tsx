'use client'
import { useRef } from 'react'
import { cn } from '@/lib/utils'

/* Controle segmentado: escolha única entre poucas opções vizinhas (ex.: o
   período do dashboard). Substitui as pills vermelhas escritas inline.

   Acessibilidade: padrão WAI-ARIA de radiogroup — só o item marcado entra na
   ordem do Tab (roving tabindex); setas ←/→ (e ↑/↓), Home e End movem a
   seleção e o foco juntos. O estado sai em aria-checked, que também é o
   gancho do estilo em .segmented-item[aria-checked="true"] (globals.css). */

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Nome acessível do grupo (ex.: "Período"). */
  label: string
  className?: string
}

export function SegmentedControl<T extends string>({
  options, value, onChange, label, className,
}: SegmentedControlProps<T>) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const checkedIndex = options.findIndex(o => o.value === value)
  // Sem item marcado (valor fora da lista), o primeiro recebe o Tab.
  const tabbableIndex = checkedIndex >= 0 ? checkedIndex : 0

  function select(index: number) {
    const opt = options[index]
    if (!opt) return
    if (opt.value !== value) onChange(opt.value)
    itemRefs.current[index]?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = options.length - 1
    let next: number | null = null
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': next = index === last ? 0 : index + 1; break
      case 'ArrowLeft':
      case 'ArrowUp':   next = index === 0 ? last : index - 1; break
      case 'Home':      next = 0; break
      case 'End':       next = last; break
    }
    if (next === null) return
    e.preventDefault()
    select(next)
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn('segmented', className)}>
      {options.map((opt, i) => {
        const checked = i === checkedIndex
        return (
          <button
            key={opt.value}
            ref={el => { itemRefs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === tabbableIndex ? 0 : -1}
            className="segmented-item"
            onClick={() => select(i)}
            onKeyDown={e => handleKeyDown(e, i)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
