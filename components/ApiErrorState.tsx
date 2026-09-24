'use client'
import { AlertTriangle, Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { TextoDaFalha } from '@/lib/api-error'

/* Estado visível de falha (issue #98). Três situações, três textos — quem
 * escolhe o texto é lib/api-error (textoDaFalha / textoDeModuloDesligado);
 * aqui só se pinta.
 *
 * Sem largura em pixel e sem consultar o tamanho da tela em JavaScript: o
 * layout é por classe, como o resto do produto depois do trabalho de mobile.
 * No celular a mensagem ocupa a linha inteira e o botão desce. */

interface Props {
  texto: TextoDaFalha
  /** Só aparece quando `texto.podeTentarDeNovo` — 403 não se resolve insistindo. */
  onRetry?: () => void
  /** Faixa enxuta, para uma seção dentro de uma tela que já carregou. */
  compacto?: boolean
  className?: string
}

export function ApiErrorState({ texto, onRetry, compacto, className }: Props) {
  const bloqueado = !texto.podeTentarDeNovo
  const Icone = bloqueado ? Lock : AlertTriangle
  // Bloqueio de plano não é erro do sistema: âmbar, não vermelho.
  const tom = bloqueado
    ? { borda: 'border-(--warn-mid)', fundo: 'bg-(--warn-dim)', texto: 'text-(--warn-text)' }
    : { borda: 'border-(--danger-mid)', fundo: 'bg-(--danger-dim)', texto: 'text-(--danger-text)' }

  if (compacto) {
    return (
      /* `alert` e não `status`: a variante compacta é uma faixa que aparece ACIMA
       * de uma tela que continua carregada, muitas vezes com a pessoa no meio de
       * um formulário. Interromper a leitura é o certo aqui — e é o que o
       * components/ErrorFallback.tsx já faz. */
      <div
        role="alert"
        className={`flex flex-wrap items-start gap-3 rounded-(--radius-md) border ${tom.borda} ${tom.fundo} p-4 ${className ?? ''}`}
      >
        <div className="max-md:basis-full flex flex-1 items-start gap-3">
          <Icone size={14} className={`mt-px shrink-0 ${tom.texto}`} aria-hidden />
          <div className={`max-lg:wrap-anywhere text-13 font-medium ${tom.texto}`}>
            <span className="font-bold">{texto.titulo}.</span> {texto.detalhe}
          </div>
        </div>
        {texto.podeTentarDeNovo && onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw size={13} /> Tentar novamente
          </Button>
        )}
      </div>
    )
  }

  return (
    /* Sem `role` de região viva, ao contrário da variante compacta: esta versão
     * SUBSTITUI o conteúdo da tela, então o texto já nasce na ordem de leitura e
     * o título o anuncia. Uma região viva aqui dispararia na primeira pintura,
     * repetindo em voz alta o que a pessoa já vai ler. */
    <div
      className={`flex flex-col items-center justify-center gap-3 px-4 py-12 text-center ${className ?? ''}`}
    >
      <Icone size={28} className={`${tom.texto} opacity-70`} aria-hidden />
      <div className="text-15 font-extrabold text-(--ink)">{texto.titulo}</div>
      <p className="max-lg:wrap-anywhere max-w-prose text-13 text-(--gray2)">{texto.detalhe}</p>
      {texto.podeTentarDeNovo && onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={13} /> Tentar novamente
        </Button>
      )}
    </div>
  )
}
