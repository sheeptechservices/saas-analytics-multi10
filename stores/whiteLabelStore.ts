'use client'
import { create } from 'zustand'
import { brandVars, DEFAULT_PRIMARY, DEFAULT_BRAND_NAME } from '@/lib/brand'

// A conta das variáveis mora em lib/brand.ts, porque o servidor faz a mesma para
// imprimir a marca no HTML. Aqui é só a reaplicação ao vivo: trocar a cor em
// Configurações muda a tela sem recarregar.
function applyPrimaryVars(color: string) {
  if (typeof document === 'undefined') return
  for (const [nome, valor] of Object.entries(brandVars(color))) {
    document.documentElement.style.setProperty(nome, valor)
  }
}

interface WhiteLabelState {
  primaryColor: string
  logoUrl: string | null
  brandName: string
  setPrimaryColor: (color: string) => void
  setLogoUrl: (url: string | null) => void
  setBrandName: (name: string) => void
  init: (color: string, logo: string | null, name: string) => void
}

export const useWhiteLabel = create<WhiteLabelState>()(
  (set) => ({
    primaryColor: DEFAULT_PRIMARY,
    logoUrl: null,
    brandName: DEFAULT_BRAND_NAME,
    setPrimaryColor: (color) => {
      set({ primaryColor: color })
      applyPrimaryVars(color)
    },
    setLogoUrl: (url) => set({ logoUrl: url }),
    setBrandName: (name) => set({ brandName: name }),
    init: (color, logo, name) => {
      set({ primaryColor: color, logoUrl: logo, brandName: name })
      applyPrimaryVars(color)
    },
  })
)
