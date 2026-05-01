import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const base = 'inline-flex items-center justify-center gap-2 font-bold rounded-[100px] border cursor-pointer transition-all duration-200 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed'

const variants: Record<Variant, string> = {
  primary:   'bg-primary text-[var(--black)] border-primary hover:brightness-90',
  secondary: 'bg-[var(--white)] text-[var(--black)] border-[var(--gray3)] hover:border-primary-mid hover:bg-primary-dim',
  ghost:     'bg-transparent text-[var(--gray)] border-transparent hover:text-[var(--black)] hover:bg-[var(--bg)]',
  success:   'bg-[var(--green)] text-white border-[var(--green)] hover:bg-green-800',
  danger:    'bg-transparent text-[var(--red)] border-[rgba(217,48,37,0.25)] hover:bg-[rgba(217,48,37,0.06)]',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-[13px]',
  lg: 'px-7 py-3.5 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, children, ...props }, ref) => (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  )
)
Button.displayName = 'Button'
