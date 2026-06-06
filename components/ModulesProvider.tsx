'use client'
import { createContext, useContext } from 'react'

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
