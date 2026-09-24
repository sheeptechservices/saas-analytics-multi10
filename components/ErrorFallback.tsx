'use client'

import { TriangleAlert, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

/* Tela de falha compartilhada pelas três fronteiras de erro (app/error.tsx,
 * app/(app)/error.tsx e app/global-error.tsx). Uma só receita para não haver
 * três telas de erro diferentes no mesmo produto.
 *
 * Tom: o usuário não tem culpa e não perdeu nada. Sem "Erro 500", sem pilha,
 * sem inglês. O `digest` sai pequeno no rodapé porque é o único fio que liga o
 * relato do cliente ao log do servidor. */

interface ErrorFallbackProps {
  titulo?: string
  descricao?: string
  /** Identificador que o Next gera para o erro; casa com a linha do log. */
  digest?: string
  /** Quando a falha comeu o layout inteiro (raiz e global), a tela é toda dela. */
  ocuparTela?: boolean
  aoTentarNovamente: () => void
}

export function ErrorFallback({
  titulo = 'Não foi possível carregar esta tela',
  descricao = 'A conexão com o servidor falhou por um instante. Nada foi perdido — é só tentar de novo.',
  digest,
  ocuparTela = false,
  aoTentarNovamente,
}: ErrorFallbackProps) {
  return (
    <div
      className={cn(
        'w-full flex items-center justify-center px-[16px] py-[32px]',
        ocuparTela ? 'min-h-[100dvh]' : 'min-h-[60vh]',
      )}
    >
      <div className="card p-[24px] w-full max-w-[440px] text-center" role="alert">
        <div
          className="w-[48px] h-[48px] rounded-full bg-danger-dim flex items-center justify-center mx-auto mb-[16px]"
          aria-hidden="true"
        >
          <TriangleAlert size={22} className="text-danger" />
        </div>

        <h1 className="text-[17px] font-extrabold text-ink tracking-[-0.01em]">{titulo}</h1>
        <p className="text-sm font-medium text-muted mt-[8px]">{descricao}</p>

        <button
          type="button"
          onClick={aoTentarNovamente}
          className="btn btn-primary btn-lg touch-target w-full sm:w-auto mt-[20px]"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Tentar novamente
        </button>

        {digest && <p className="label-data mt-[16px]">código {digest}</p>}
      </div>
    </div>
  )
}
