'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function applyPrimaryVars(color: string) {
  if (typeof document === 'undefined') return
  const hex = color.replace('#', '')
  if (hex.length !== 6) return
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const contrast = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#121316' : '#FFFFFF'
  // Darken the primary color for text on dim backgrounds (multiply by ~0.55)
  const dr = Math.round(r * 0.55)
  const dg = Math.round(g * 0.55)
  const db = Math.round(b * 0.55)
  const primaryText = `#${dr.toString(16).padStart(2,'0')}${dg.toString(16).padStart(2,'0')}${db.toString(16).padStart(2,'0')}`
  document.documentElement.style.setProperty('--primary', color)
  document.documentElement.style.setProperty('--primary-dim', `rgba(${r},${g},${b},0.12)`)
  document.documentElement.style.setProperty('--primary-mid', `rgba(${r},${g},${b},0.40)`)
  document.documentElement.style.setProperty('--primary-contrast', contrast)
  document.documentElement.style.setProperty('--primary-text', primaryText)
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
  persist(
    (set) => ({
      primaryColor: '#FFB400',
      logoUrl: null,
      brandName: 'Multi10',
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
    }),
    { name: 'white-label' }
  )
)
