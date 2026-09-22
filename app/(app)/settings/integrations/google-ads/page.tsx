import Link from 'next/link'
import { AdProviderPage } from '@/components/integration/AdProviderPage'

export default function GoogleAdsPage() {
  return (
    <div>
      <Link
        href="/settings?tab=integracoes"
        className="max-md:min-h-10"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 600, color: 'var(--gray)',
          textDecoration: 'none', marginBottom: 20,
        }}
      >
        ← Voltar para Integrações
      </Link>
      <AdProviderPage provider="google_ads" />
    </div>
  )
}
