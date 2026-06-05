import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Fix Turbopack panic on non-ASCII path chars ("Área de Trabalho").
  // By default Turbopack roots at C:\Users\gui-z (stray package-lock.json there),
  // making identifiers include "Área" which breaks Rust's UTF-8 byte slicing.
  // Rooting at the project dir keeps identifiers ASCII-safe.
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      { source: '/integration',            destination: '/settings/integrations/kommo',      permanent: true },
      { source: '/integration/ai',         destination: '/settings/integrations/ai',          permanent: true },
      { source: '/integration/google-ads', destination: '/settings/integrations/google-ads',  permanent: true },
      { source: '/integration/meta-ads',   destination: '/settings/integrations/meta-ads',    permanent: true },
      { source: '/integration/tiktok-ads', destination: '/settings/integrations/tiktok-ads',  permanent: true },
    ]
  },
}

export default nextConfig
