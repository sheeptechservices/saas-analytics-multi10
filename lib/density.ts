// Densidade da interface (compacto/confortável) — preferência por usuário.
//
// Mora em cookie, não em localStorage, porque quem decide é o servidor: o atributo
// data-density precisa sair no <html> da primeira resposta. Em localStorage, a
// escolha só chegaria depois de hidratar e a tela mudaria de densidade na frente do
// usuário — o mesmo defeito que a cor da marca tinha (lib/brand.ts).
//
// Os valores são 'compact' e 'comfortable', em inglês, porque são chave técnica:
// o seletor que os lê está no globals.css (`:root[data-density="compact"]`). O que
// aparece para o usuário continua em português, na etiqueta do alternador.

import { isTenantRole } from '@/lib/roles'

export type Density = 'compact' | 'comfortable'

export const DENSITY_COOKIE = 'densidade'

/** Um ano: é preferência de trabalho, não sessão. */
export const DENSITY_MAX_AGE = 60 * 60 * 24 * 365

export function parseDensity(valor: string | null | undefined): Density | null {
  return valor === 'compact' || valor === 'comfortable' ? valor : null
}

/**
 * Padrão de quem ainda não escolheu.
 *
 * Com a conta única não há mais hierarquia dentro do cliente: todo usuário do
 * tenant é admin, trabalha nas telas de configuração, com formulário e texto —
 * confortável. Linha legada com 'manager' ou 'user' cai aqui também, porque é
 * admin na prática (lib/roles.ts). Master e visitante sem sessão ficam no
 * compacto, que é o padrão da plataforma.
 */
export function defaultDensityForRole(role: string | null | undefined): Density {
  return isTenantRole(role) ? 'comfortable' : 'compact'
}

export function resolveDensity(
  cookieValue: string | null | undefined,
  role: string | null | undefined,
): Density {
  return parseDensity(cookieValue) ?? defaultDensityForRole(role)
}
