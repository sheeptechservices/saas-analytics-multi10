import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // O lint roda antes do build, pelo script: npm run build = npm run lint && next
  // build. Rodar de novo aqui dobraria o tempo, e o passo embutido sai no Next 16 —
  // o gate precisa viver no script para sobreviver a essa remoção.
  eslint: { ignoreDuringBuilds: true },
  // Fix Turbopack panic on non-ASCII path chars ("Área de Trabalho").
  // By default Turbopack roots at C:\Users\gui-z (stray package-lock.json there),
  // making identifiers include "Área" which breaks Rust's UTF-8 byte slicing.
  // Rooting at the project dir keeps identifiers ASCII-safe.
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      // não permanente: navegadores que guardaram o 308 antigo (para a tela do CRM removido) se recuperam
      { source: '/integration',            destination: '/settings?tab=integracoes',         permanent: false },
      { source: '/integration/ai',         destination: '/settings/integrations/ai',          permanent: true },
      { source: '/integration/google-ads', destination: '/settings/integrations/google-ads',  permanent: true },
      { source: '/integration/meta-ads',   destination: '/settings/integrations/meta-ads',    permanent: true },
      { source: '/integration/tiktok-ads', destination: '/settings/integrations/tiktok-ads',  permanent: true },
    ]
  },
}

export default nextConfig
