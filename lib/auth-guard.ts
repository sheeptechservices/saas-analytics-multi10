import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { canActInTenant, isMasterRole } from '@/lib/roles'

// Conta única — ver lib/roles.ts. Aqui só moram as duas portas que as rotas usam:
// uma para o que é do cliente e outra para o que é da plataforma. Não existe mais
// lista de papéis permitidos por rota, porque dentro do tenant não há hierarquia.

/**
 * Ação dentro de um tenant. Passa qualquer usuário autenticado do cliente —
 * inclusive linhas legadas com role 'manager' ou 'user' — e o master.
 */
export function requireTenantUser(session: Session): NextResponse | null {
  if (!canActInTenant(session.user?.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }
  return null
}

/** Ação da plataforma: só o master. */
export function requireMaster(session: Session): NextResponse | null {
  if (!isMasterRole(session.user?.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }
  return null
}
