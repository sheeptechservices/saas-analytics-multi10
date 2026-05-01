import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full px-3.5 py-[11px] font-medium text-sm text-[var(--black)] bg-[var(--white)]',
      'border border-[var(--gray3)] rounded-[8px] outline-none transition-all duration-200',
      'placeholder:text-[var(--gray2)] placeholder:font-normal',
      'focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-dim)]',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full px-3.5 py-2.5 font-medium text-sm text-[var(--black)] bg-[var(--white)]',
      'border border-[var(--gray3)] rounded-[8px] outline-none transition-all duration-200 resize-none',
      'placeholder:text-[var(--gray2)] placeholder:font-normal',
      'focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-dim)]',
      className
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
