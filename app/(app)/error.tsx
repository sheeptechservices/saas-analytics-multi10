'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorFallback } from '@/components/ErrorFallback'

/* Fronteira das telas logadas. Esta renderiza *dentro* do AppShell: menu,
 * cabeçalho e marca continuam no lugar, e só a área de conteúdo vira a tela de
 * falha. É a diferença que interessa — uma consulta que falhou em /dashboard não
 * tira o usuário de dentro do produto. */

export default function ErroDaArea({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[erro:app]', error.digest ?? error.message)
  }, [error])

  const router = useRouter()

  return (
    <ErrorFallback
      titulo="Não foi possível carregar esta tela"
      descricao="Os dados não vieram do servidor desta vez. Nada foi perdido — é só tentar de novo."
      digest={error.digest}
      aoTentarNovamente={() => {
        router.refresh()
        reset()
      }}
    />
  )
}
