'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorFallback } from '@/components/ErrorFallback'

/* Fronteira da raiz. Pega o que os segmentos abaixo deixam escapar — inclusive o
 * próprio app/(app)/layout.tsx, que roda getEnabledModuleKeys: quando o portão
 * de módulos não pode ser lido, o layout estoura e o erro sobe até aqui, porque
 * uma fronteira nunca pega o erro do seu próprio layout. É de propósito: o
 * portão falha alto, e falhar alto precisa ter onde cair.
 *
 * O reset() sozinho remonta o segmento com o mesmo payload do servidor; o
 * router.refresh() antes dele é quem manda buscar de novo. */

export default function ErroDaRaiz({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[erro:raiz]', error.digest ?? error.message)
  }, [error])

  const router = useRouter()

  return (
    <ErrorFallback
      ocuparTela
      digest={error.digest}
      aoTentarNovamente={() => {
        router.refresh()
        reset()
      }}
    />
  )
}
