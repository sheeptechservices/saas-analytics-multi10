// Conta única: dentro de um cliente não existe hierarquia.
//
// Todo usuário de um tenant tem acesso completo ao próprio tenant — não há mais
// "gerente" nem "usuário comum" com menos permissão que o administrador. O único
// papel que continua valendo alguma coisa é o `master`, que é da plataforma: ele
// atravessa tenants e manda em /master/*.
//
// A coluna `users.role` continua aceitando os valores antigos ('manager', 'user')
// e há linhas legadas gravadas assim no banco. Nada aqui compara com 'admin':
// quem não é `master` é usuário do tenant, com acesso completo, seja qual for o
// valor gravado na linha. A migração drizzle/0011_role_admin_unico.sql só limpa o
// texto da coluna — o código não depende dela ter rodado.
//
// Estas funções são puras de propósito (nada de NextResponse aqui): valem tanto
// no servidor, dentro de lib/auth-guard.ts, quanto no cliente, em hooks de UI.

/** Papel da plataforma. É o único papel que ainda muda o que a pessoa pode fazer. */
export const MASTER_ROLE = 'master'

/** Papel gravado em toda conta de cliente criada a partir da conta única. */
export const TENANT_ROLE = 'admin'

export function isMasterRole(role: string | null | undefined): boolean {
  return role === MASTER_ROLE
}

/**
 * Usuário de um cliente: qualquer papel autenticado que não seja `master`,
 * incluindo os legados 'manager' e 'user'. Sem papel nenhum, nada feito — a
 * checagem falha fechada.
 */
export function isTenantRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim() !== '' && !isMasterRole(role)
}

/**
 * Quem pode agir dentro de um tenant: o usuário do próprio cliente e o master,
 * que mantém o acesso que sempre teve.
 */
export function canActInTenant(role: string | null | undefined): boolean {
  return isMasterRole(role) || isTenantRole(role)
}

type Actor = { role?: string | null; tenantId?: string | null }

/**
 * O alvo pertence ao tenant de quem pediu?
 *
 * O master atravessa tenants — é o que ele já fazia. O usuário do cliente só
 * enxerga o próprio tenant, e isso vale para qualquer papel de tenant: o
 * isolamento nunca dependeu de o papel ser 'admin'.
 */
export function sharesTenant(actor: Actor, targetTenantId: string | null | undefined): boolean {
  if (isMasterRole(actor.role)) return true
  if (!actor.tenantId || !targetTenantId) return false
  return actor.tenantId === targetTenantId
}

/**
 * Etiqueta do papel na interface.
 *
 * São duas, e só duas: a da plataforma e a do cliente. Linha legada com
 * 'manager' ou 'user' lê "Administrador", que é o acesso que ela tem de verdade
 * — mostrar "Gerente" para quem pode tudo é mentir para o usuário.
 */
export function roleLabel(role: string | null | undefined): string {
  if (isMasterRole(role)) return 'Master'
  if (isTenantRole(role)) return 'Administrador'
  return ''
}
