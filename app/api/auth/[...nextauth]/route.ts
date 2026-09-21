import { NextRequest } from 'next/server'
import { handlers } from '@/auth'
import { requestOrigin } from '@/lib/origin'

// Fora da Vercel, o Next entrega ao handler um req.url com o endereço em que o
// servidor escuta (http://localhost:PORT): o host público do proxy não chega na URL.
// O next-auth monta a origem do handler com new URL(req.url) (@auth/core,
// toInternalRequest), e a URL que ele devolve no signOut do cliente vira
// window.location — o usuário saía do app direto para localhost.
//
// Aqui a URL passa a usar a origem que a requisição declara: a mesma regra do
// middleware, e a mesma que o next-auth já aplica no caminho do servidor
// (createActionURL lê x-forwarded-host quando trustHost está ligado). A técnica é
// a de reqWithEnvURL (next-auth/lib/env.js), com a origem do pedido no lugar de
// uma origem fixa em variável.
function comOrigemDoPedido(req: NextRequest): NextRequest {
  const origem = requestOrigin(req)
  const { href, origin } = req.nextUrl
  if (!origem || origem === origin) return req
  return new NextRequest(href.replace(origin, origem), req)
}

export const GET = (req: NextRequest) => handlers.GET(comOrigemDoPedido(req))
export const POST = (req: NextRequest) => handlers.POST(comOrigemDoPedido(req))
