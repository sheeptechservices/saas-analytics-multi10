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
}

export default nextConfig
