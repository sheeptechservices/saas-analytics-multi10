'use client'
import { createContext, useContext } from 'react'
import { moduleKeyForEndpoint } from '@/lib/modules'

const ModulesContext = createContext<string[]>([])

export function ModulesProvider({ modules, children }: { modules: string[]; children: React.ReactNode }) {
  return <ModulesContext.Provider value={modules}>{children}</ModulesContext.Provider>
}

export function useModules(): string[] {
  return useContext(ModulesContext)
}

export function useHasModule(key: string): boolean {
  return useContext(ModulesContext).includes(key)
}

/* Porta única do cliente para o gating por endpoint (issue #98).
 *
 * Quem decide continua sendo o servidor (assertEntitlement). Isto evita montar
 * a requisição que ele responderia com 403 — e, quando bloqueia, devolve a
 * chave do módulo para a tela dizer qual é.
 *
 * A lista de módulos vem do ModulesProvider, que o layout de (app) preenche com
 * getEnabledModuleKeys. Não há segunda fonte: o mapa endpoint → módulo mora em
 * lib/modules.ts, ao lado do mapa rota → módulo.
 *
 * Fora de um ModulesProvider o contexto é [] e tudo o que exige módulo fica
 * bloqueado — falha fechada, como convém a uma verificação de permissão. */
export function useEndpointAllowed(endpoint: string): { permitido: boolean; moduleKey: string | null } {
  const modules = useContext(ModulesContext)
  const moduleKey = moduleKeyForEndpoint(endpoint)
  return { permitido: moduleKey === null || modules.includes(moduleKey), moduleKey }
}
