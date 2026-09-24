'use client'

import { useEffect } from 'react'
import './globals.css'
import { ErrorFallback } from '@/components/ErrorFallback'

/* Último anteparo: só entra quando o próprio app/layout.tsx falha (cookie,
 * sessão, fonte). Como ele substitui o layout raiz, o <html> e o <body> saem
 * daqui — e o globals.css também, porque o import do layout não chega a rodar.
 *
 * Sem router: o layout raiz é justamente o que não montou, então reset() é a
 * única saída, e é o que o botão faz. As variáveis de marca do tenant também
 * não existem aqui; a tela sai com a cor padrão do globals.css, que é o
 * esperado quando nem a sessão pôde ser lida. */

export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[erro:global]', error.digest ?? error.message)
  }, [error])

  return (
    <html lang="pt-BR">
      <body>
        <ErrorFallback
          ocuparTela
          titulo="A aplicação não conseguiu iniciar"
          descricao="Houve uma falha ao carregar a plataforma. Nada foi perdido — é só tentar de novo."
          digest={error.digest}
          aoTentarNovamente={reset}
        />
      </body>
    </html>
  )
}
