import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const base = [
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap',
  'rounded-[var(--radius-md)] border cursor-pointer transition-all duration-200',
  'disabled:opacity-40 disabled:cursor-not-allowed',
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--primary-dim)]',
].join(' ')

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--primary)] text-white border-[var(--primary)] shadow-[var(--shadow-sm)] hover:brightness-90 active:brightness-75',
  secondary:
    'bg-[var(--white)] text-[var(--ink-2)] border-[var(--line)] hover:bg-[var(--bg)]',
  ghost:
    'bg-transparent text-[var(--ink-2)] border-transparent hover:bg-[var(--primary-dim)]',
  success:
    'bg-[var(--green)] text-white border-[var(--green)] hover:brightness-90',
  danger:
    'bg-transparent text-[var(--red)] border-[rgba(217,48,37,0.25)] hover:bg-[rgba(217,48,37,0.06)]',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-[13px]',
  lg: 'px-6 py-3 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, children, ...props }, ref) => (
    <button
      ref={ref}
      style={{ fontFamily: 'inherit' }}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  )
)
Button.displayName = 'Button'
