'use client'
import { useEffect } from 'react'
import { useWhiteLabel } from '@/stores/whiteLabelStore'

interface Props {
  primaryColor: string
  logoUrl: string | null
  brandName: string
}

export function WhiteLabelInit({ primaryColor, logoUrl, brandName }: Props) {
  const { init, logoUrl: storeLogoUrl } = useWhiteLabel()

  useEffect(() => {
    init(primaryColor, logoUrl, brandName)
  }, [primaryColor, logoUrl, brandName, init])

  useEffect(() => {
    const link =
      document.querySelector<HTMLLinkElement>("link[rel~='icon']") ??
      (() => {
        const el = document.createElement('link')
        el.rel = 'icon'
        document.head.appendChild(el)
        return el
      })()

    link.href = storeLogoUrl ?? '/favicon.ico'
  }, [storeLogoUrl])

  return null
}
