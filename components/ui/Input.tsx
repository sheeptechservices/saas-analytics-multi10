import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/* A06 — Correção da auditoria de 21/09/2026.
   Os campos escritos à mão nas telas declaravam outline:'none' sem pôr nada no
   lugar, então quem navega por teclado perdia a posição. O estado de foco agora
   vive na classe .field do globals.css, alcançável também por quem ainda não
   importa este componente.

   `Select` foi adicionado porque os <select> das telas (kommo, settings,
   conversas) eram os únicos controles sem nenhuma origem comum. */

/* Padding, borda e fonte vêm só de .field, que é CSS sem camada e por isso
   anula utilitários como py-2.5 ou border-danger — nem aqui nem no className
   de quem chama eles teriam efeito. O estado inválido sai pelo aria-invalid
   (regra .field[aria-invalid="true"] no globals.css). */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('field', className)}
      {...props}
    />
  )
)
Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('field resize-none', className)}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn('field cursor-pointer', className)} {...props}>
      {children}
    </select>
  )
)
Select.displayName = 'Select'

/* Label + campo + mensagem de erro, para parar de repetir a tripla inline. */

interface FieldProps {
  label: string
  htmlFor?: string
  error?: string | null
  hint?: string
  children: React.ReactNode
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={htmlFor} className="label-data">{label}</label>
      {children}
      {/* text-(--danger-text), não text-danger-text: esse utilitário é do @theme
          novo (--color-danger-text) e pinta outro vermelho. */}
      {error
        ? <span className="text-xs font-semibold text-(--danger-text)">{error}</span>
        : hint
          ? <span className="text-xs font-medium text-muted">{hint}</span>
          : null}
    </div>
  )
}
