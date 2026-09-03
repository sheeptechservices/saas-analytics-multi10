'use client'
import { create } from 'zustand'
import { applyBrandTokens, DEFAULT_PRIMARY, DEFAULT_BRAND_NAME } from '@/lib/brand'

/**
 * O store não decide cor.
 *
 * Quem resolve a marca é o servidor, a partir do tenant, e imprime as variáveis
 * no HTML da primeira resposta (app/(app)/layout.tsx). Aqui ficam só o nome, o
 * logo e a cor como estado de leitura para os componentes.
 *
 * A única escrita no documento é a pré-visualização ao vivo: enquanto o admin
 * digita uma cor na tela de Marca, `setPrimaryColor` aplica os tokens para ele
 * ver o efeito sem recarregar. `init` não aplica nada — aplicar na carga é o que
 * produzia o flash de marca, com a cor padrão pintando antes da cor do cliente.
 */

interface WhiteLabelState {
  primaryColor: string
  logoUrl: string | null
  brandName: string
  /** Pré-visualização ao vivo: muda o estado e repinta os tokens no documento. */
  setPrimaryColor: (color: string) => void
  setLogoUrl: (url: string | null) => void
  setBrandName: (name: string) => void
  /** Recebe o que o servidor já resolveu. Não escreve no documento. */
  init: (color: string, logo: string | null, name: string) => void
}

export const useWhiteLabel = create<WhiteLabelState>()(
  (set) => ({
    primaryColor: DEFAULT_PRIMARY,
    logoUrl: null,
    brandName: DEFAULT_BRAND_NAME,
    setPrimaryColor: (color) => {
      set({ primaryColor: color })
      applyBrandTokens(color)
    },
    setLogoUrl: (url) => set({ logoUrl: url }),
    setBrandName: (name) => set({ brandName: name }),
    init: (color, logo, name) => {
      set({ primaryColor: color, logoUrl: logo, brandName: name })
    },
  })
)
