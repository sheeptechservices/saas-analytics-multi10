'use client'
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/* Campo de senha com o olho de mostrar/ocultar.
 *
 * Existe como componente porque são três campos em duas telas (login e
 * redefinição, que tem "nova senha" e "confirmar senha"). Repetir a lógica três
 * vezes garantiria que uma delas ficasse sem o `type="button"` — e aí o olho
 * submeteria o formulário, que é o erro clássico deste controle.
 *
 * Cada campo guarda a própria visibilidade: em "nova senha" e "confirmar senha",
 * revelar as duas de uma vez não ajuda ninguém a conferir se digitou igual.
 *
 * O <input> mantém estilo em linha de propósito: ele precisa ficar idêntico ao
 * campo de e-mail logo acima, que é do bloco legado e ainda não migrou. Já o
 * botão vive no CSS (.campo-senha-olho), porque hover em estilo em linha obriga
 * a onMouseEnter/Leave — que não existem para teclado nem para toque.
 */

interface Props {
  value: string
  onChange: (valor: string) => void
  /** Sugestão ao gerenciador de senhas: 'current-password' ao entrar, 'new-password' ao trocar. */
  autoComplete?: 'current-password' | 'new-password'
  placeholder?: string
  required?: boolean
  /** A tela de redefinicao exige 8; o login nao exige nada (senha antiga pode ser menor). */
  minLength?: number
  id?: string
}

export function CampoSenha({
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  required,
  minLength,
  id,
}: Props) {
  const [visivel, setVisivel] = useState(false)

  return (
    <div className="campo-senha">
      <input
        id={id}
        type={visivel ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        style={{
          width: '100%', padding: '11px 14px',
          // Espaço à direita para o botão não cobrir o que está sendo digitado.
          paddingRight: 46,
          fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
          color: 'var(--black)', background: 'var(--white)',
          border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
          transition: 'border-color .2s, box-shadow .2s',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
        onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
      />
      <button
        type="button"
        /* `type="button"` nao e detalhe: dentro de um <form>, o padrao de um
         * <button> e submit — sem isto, clicar no olho tentaria entrar. */
        onClick={() => setVisivel(v => !v)}
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visivel}
        title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        /* .touch-target da 44x44 no celular; no desktop o botao fica do tamanho
         * do icone, como os outros botoes de icone destas telas. */
        className="campo-senha-olho touch-target"
      >
        {visivel ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
      </button>
    </div>
  )
}
