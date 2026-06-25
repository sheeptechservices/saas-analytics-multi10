'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWhiteLabel } from '@/stores/whiteLabelStore'
import { useUser } from '@/stores/userStore'
import { initials } from '@/lib/utils'
import { Pencil, Trash2, Clock, Search, Check, Database, KeyRound } from 'lucide-react'
import { ACTION_LABELS, fmtDateTime, fmtDetail } from '@/lib/audit-format'
import { SparkleIcon } from '@/components/icons/SparkleIcon'
import { useModules } from '@/components/ModulesProvider'

const PRESET_COLORS = [
  '#FFB400', '#2563eb', '#1E8A3E', '#D93025',
  '#7C3AED', '#DB2777', '#0891B2', '#059669',
]

type TabKey = 'perfil' | 'marca' | 'integracoes' | 'equipe' | 'auditoria' | 'campanha-sdr'
type IntegStatus = 'loading' | 'connected' | 'disconnected' | 'error' | 'pending'
const TABS: { id: TabKey; label: string; adminOnly?: boolean; moduleGate?: string }[] = [
  { id: 'integracoes',  label: 'Integrações' },
  { id: 'campanha-sdr', label: 'Campanha SDR', moduleGate: 'sdr.parametros' },
  { id: 'equipe',       label: 'Equipe' },
  { id: 'perfil',       label: 'Perfil' },
  { id: 'marca',        label: 'Marca',     adminOnly: true },
  { id: 'auditoria',    label: 'Auditoria', adminOnly: true },
]

// ─── Integration icons ────────────────────────────────────────────────────────

function GoogleAdsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function MetaAdsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}

function TikTokAdsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.88a8.28 8.28 0 0 0 4.83 1.56V7a4.85 4.85 0 0 1-1.06-.31z"/>
    </svg>
  )
}

function YCloudIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#25D366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
    </svg>
  )
}

// ─── Integration groups config ────────────────────────────────────────────────

interface IntegrationItem {
  slug: string
  label: string
  desc: string
  href: string
  iconBg: string
  iconColor?: string
  icon: React.ReactNode
  moduleKey?: string
}

const INTEGRATION_GROUPS: { group: string; items: IntegrationItem[] }[] = [
  {
    group: 'CRM',
    items: [
      {
        slug: 'kommo',
        label: 'Kommo CRM',
        desc: 'Sincronize leads e funis do seu CRM Kommo.',
        href: '/settings/integrations/kommo',
        iconBg: '#fff7ed',
        iconColor: '#ea580c',
        icon: <Clock size={20} />,
      },
    ],
  },
  {
    group: 'Fontes de Dados',
    items: [
      {
        slug: 'sdr-source',
        label: 'Fonte de Dados SDR',
        desc: 'Conecte o banco Postgres do projeto 300 (Supabase) para sincronizar os dados.',
        href: '/settings/integrations/sdr-source',
        iconBg: '#f0f4ff',
        iconColor: '#3b82f6',
        icon: <Database size={20} />,
      },
    ],
  },
  {
    group: 'Anúncios',
    items: [
      {
        slug: 'google-ads',
        label: 'Google Ads',
        desc: 'Sincronize campanhas e métricas do Google Ads.',
        href: '/settings/integrations/google-ads',
        iconBg: '#f8f9fa',
        icon: <GoogleAdsIcon />,
      },
      {
        slug: 'meta-ads',
        label: 'Meta Ads',
        desc: 'Campanhas e insights do Facebook e Instagram Ads.',
        href: '/settings/integrations/meta-ads',
        iconBg: '#eff6ff',
        icon: <MetaAdsIcon />,
      },
      {
        slug: 'tiktok-ads',
        label: 'TikTok Ads',
        desc: 'Campanhas e performance do TikTok for Business.',
        href: '/settings/integrations/tiktok-ads',
        iconBg: '#111',
        icon: <TikTokAdsIcon />,
      },
    ],
  },
  {
    group: 'Mensageria',
    items: [
      {
        slug: 'ycloud-whatsapp',
        label: 'YCloud (WhatsApp)',
        desc: 'Receba mensagens WhatsApp via webhook e sincronize conversas.',
        href: '/settings/integrations/ycloud',
        iconBg: '#f0fdf4',
        iconColor: '#16a34a',
        icon: <YCloudIcon />,
      },
    ],
  },
  {
    group: 'IA',
    items: [
      {
        slug: 'ai',
        label: 'Claude IA',
        desc: 'Assistente de IA para análises e insights.',
        href: '/settings/integrations/ai',
        iconBg: 'var(--primary-dim)',
        iconColor: 'var(--primary-text)',
        icon: <SparkleIcon size={20} />,
      },
    ],
  },
  {
    group: 'Automação',
    items: [
      {
        slug: 'credenciais',
        moduleKey: 'sdr.parametros',
        label: 'Credenciais',
        desc: 'URLs e segredos de integração usados pela automação de campanha.',
        href: '/settings/integrations/credenciais',
        iconBg: '#f5f3ff',
        iconColor: '#7c3aed',
        icon: <KeyRound size={20} />,
      },
    ],
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const qc = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = (searchParams.get('tab') ?? 'integracoes') as TabKey
  const modules = useModules()

  const { primaryColor, logoUrl, brandName, setPrimaryColor, setLogoUrl, setBrandName } = useWhiteLabel()
  const { setName: setUserName, setPhotoUrl: setUserPhoto } = useUser()
  const [localColor, setLocalColor] = useState(primaryColor)
  const [localLogo, setLocalLogo] = useState(logoUrl ?? '')
  const [localName, setLocalName] = useState(brandName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [manageEquipe, setManageEquipe] = useState(false)
  const [equipeSearch, setEquipeSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  // Profile state
  const [profileName, setProfileName] = useState('')
  const [profilePhoto, setProfilePhoto] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)

  // Integration statuses — fetched once when the integracoes tab is first opened
  const [integStatuses, setIntegStatuses] = useState<Record<string, IntegStatus>>({})
  const [integFetched, setIntegFetched] = useState(false)
  const [sdrSyncMeta, setSdrSyncMeta] = useState<{ error: string | null; lastSyncAt: number | null } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()),
  })

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => fetch('/api/me').then(r => r.json()),
  })

  useEffect(() => {
    if (data?.tenant) {
      setLocalColor(data.tenant.primaryColor ?? '#FFB400')
      setLocalLogo(data.tenant.logoUrl ?? '')
      setLocalName(data.tenant.name ?? '300 Franchising')
    }
  }, [data])

  useEffect(() => {
    if (meData?.user) {
      setProfileName(meData.user.name ?? '')
      setProfilePhoto(meData.user.photoUrl ?? '')
    }
  }, [meData])

  useEffect(() => {
    if (tab !== 'equipe') { setManageEquipe(false); setEquipeSearch(''); setInviteOpen(false) }
  }, [tab])

  useEffect(() => {
    if (!meData) return
    if (!visibleTabs.some(t => t.id === tab)) {
      router.replace(`/settings?tab=${visibleTabs[0].id}`)
    }
  }, [meData, tab])

  // Fetch all integration statuses in parallel, once per page load when tab is visited
  useEffect(() => {
    if (tab !== 'integracoes' || integFetched) return
    setIntegFetched(true)
    setIntegStatuses({ kommo: 'loading', 'google-ads': 'loading', 'meta-ads': 'loading', 'tiktok-ads': 'loading', ai: 'loading', 'sdr-source': 'loading', 'ycloud-whatsapp': 'loading' })

    Promise.all([
      fetch('/api/kommo/sync').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ads/google_ads').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ads/meta_ads').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ads/tiktok_ads').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ai-settings').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/sdr/source').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ycloud/source').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([kommo, google, meta, tiktok, ai, sdrSource, ycloud]) => {
      const sdrStatus: IntegStatus = !sdrSource?.configured
        ? 'disconnected'
        : sdrSource.lastSyncStatus === 'error'
          ? 'error'
          : sdrSource.lastSyncStatus === 'ok'
            ? 'connected'
            : 'pending'
      setIntegStatuses({
        'kommo':            kommo?.status === 'connected' ? 'connected' : 'disconnected',
        'google-ads':       google?.accountId != null ? 'connected' : 'disconnected',
        'meta-ads':         meta?.accountId != null ? 'connected' : 'disconnected',
        'tiktok-ads':       tiktok?.accountId != null ? 'connected' : 'disconnected',
        'ai':               ai?.configured ? 'connected' : 'disconnected',
        'sdr-source':       sdrStatus,
        'ycloud-whatsapp':  ycloud?.configured ? 'connected' : 'disconnected',
      })
      setSdrSyncMeta(sdrSource?.configured
        ? { error: sdrSource.lastSyncError ?? null, lastSyncAt: sdrSource.lastSyncAt ?? null }
        : null)
    })
  }, [tab, integFetched])

  function handleColorChange(color: string) {
    setLocalColor(color)
  }

  async function save() {
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryColor: localColor, logoUrl: localLogo || null, name: localName }),
    })
    setPrimaryColor(localColor)
    setLogoUrl(localLogo || null)
    setBrandName(localName)
    qc.invalidateQueries({ queryKey: ['settings'] })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function saveProfile() {
    if (!profileName.trim()) return
    setSavingProfile(true)
    await fetch('/api/me', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: profileName, photoUrl: profilePhoto || null }),
    })
    setUserName(profileName)
    setUserPhoto(profilePhoto || null)
    qc.invalidateQueries({ queryKey: ['me'] })
    qc.invalidateQueries({ queryKey: ['settings'] })
    setSavingProfile(false)
    setSavedProfile(true)
    setTimeout(() => setSavedProfile(false), 3000)
  }

  const users = data?.users ?? []
  const me = meData?.user
  const isAdmin = me?.role === 'admin' || me?.role === 'master'
  const visibleTabs = TABS.filter(t =>
    (!t.adminOnly || isAdmin) &&
    (!t.moduleGate || modules.includes(t.moduleGate))
  )
  const equipeQ = equipeSearch.trim().toLowerCase()
  const filteredEquipeUsers: any[] = equipeQ
    ? users.filter((u: any) => u.name?.toLowerCase().includes(equipeQ) || u.email?.toLowerCase().includes(equipeQ))
    : users

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (isLoading) {
    const sk = (w: string | number, h: number, r = 8) => (
      <div className="shimmer-bar" style={{ width: w, height: h, borderRadius: r, background: 'var(--gray3)', flexShrink: 0 }} />
    )
    return (
      <div style={{ animation: 'fadeIn .3s ease both' }}>
        <div style={{ marginBottom: 24 }}>{sk(160, 22, 6)}</div>
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--gray3)', marginBottom: 28, paddingBottom: 12 }}>
          {[60, 50, 90, 55].map((w, i) => <div key={i}>{sk(w, 14, 4)}</div>)}
        </div>
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 560 }}>
          {sk('40%', 11, 4)}
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sk('30%', 11, 4)}{sk('100%', 40, 8)}
            </div>
          ))}
          {sk('100%', 44, 100)}
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Configurações</div>
      </div>

      {/* Tab bar */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', borderBottom: '1px solid var(--gray3)', marginBottom: 28 }}>
        {visibleTabs.map(t => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            style={{
              fontSize: 13, fontWeight: 700,
              color: tab === t.id ? 'var(--black)' : 'var(--gray2)',
              textDecoration: 'none',
              padding: '10px 16px',
              borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -1,
              display: 'block',
              transition: 'color .15s',
            }}
            onMouseEnter={e => { if (tab !== t.id) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--black)' }}
            onMouseLeave={e => { if (tab !== t.id) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray2)' }}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── Perfil ─────────────────────────────────────────────────────────── */}
      {tab === 'perfil' && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Coluna esquerda — formulário */}
          <div className="animate-slide-up delay-2" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow)', flex: '1 1 380px', maxWidth: 520 }}>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>NOME</label>
              <input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>URL DA FOTO (opcional)</label>
              <input
                value={profilePhoto}
                onChange={e => setProfilePhoto(e.target.value)}
                placeholder="https://…/foto.jpg"
                style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {savedProfile && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.25)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#145c2a' }}>
                ✓ Perfil atualizado com sucesso
              </div>
            )}

            <button
              onClick={saveProfile}
              disabled={savingProfile}
              style={{ padding: '11px 28px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)' }}
            >
              {savingProfile ? 'Salvando…' : 'Salvar perfil'}
            </button>
          </div>

          {/* Coluna direita — preview do usuário */}
          <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow)', flex: '1 1 260px', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', alignSelf: 'flex-start' }}>Pré-visualização</div>
            <div style={{ width: 80, height: 80, borderRadius: '50%', flexShrink: 0, background: me?.avatarColor ?? 'var(--primary)', overflow: 'hidden', border: '2px solid var(--gray3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
              {profilePhoto ? (
                <img src={profilePhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <span style={{ fontSize: 26, fontWeight: 800, color: me?.avatarBg ?? '#121316' }}>{initials(profileName || me?.name || '?')}</span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)' }}>{profileName || me?.name}</div>
              <div style={{ fontSize: 12, color: 'var(--gray2)', marginTop: 2 }}>{me?.email}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{me?.role}</span>
          </div>
        </div>
      )}

      {/* ── Marca ──────────────────────────────────────────────────────────── */}
      {tab === 'marca' && isAdmin && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Coluna esquerda — formulário */}
          <div className="animate-slide-up delay-2" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow)', flex: '1 1 380px', maxWidth: 520 }}>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>NOME DA MARCA</label>
              <input
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 10 }}>COR PRIMÁRIA</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {PRESET_COLORS.map(color => {
                  const selected = localColor === color
                  return (
                    <button
                      key={color}
                      onClick={() => handleColorChange(color)}
                      aria-label={color}
                      style={{
                        width: 32, height: 32, borderRadius: 8, background: color, cursor: 'pointer',
                        border: '2px solid var(--white)',
                        boxShadow: selected ? `0 0 0 2px ${color}` : '0 0 0 1px var(--gray3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all .15s',
                      }}
                    >
                      {selected && <Check size={16} color="#fff" strokeWidth={3} style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))' }} />}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="color"
                  value={localColor}
                  onChange={e => handleColorChange(e.target.value)}
                  style={{ width: 40, height: 36, borderRadius: 6, border: '1px solid var(--gray3)', cursor: 'pointer', padding: 2 }}
                />
                <input
                  value={localColor}
                  onChange={e => handleColorChange(e.target.value)}
                  style={{ flex: 1, padding: '10px 14px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                  onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>URL DA LOGO (opcional)</label>
              <input
                value={localLogo}
                onChange={e => setLocalLogo(e.target.value)}
                placeholder="https://…/logo.png"
                style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {saved && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.25)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#145c2a' }}>
                ✓ Configurações salvas com sucesso
              </div>
            )}

            <button
              onClick={save}
              disabled={saving}
              style={{ padding: '11px 28px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)' }}
            >
              {saving ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </div>

          {/* Coluna direita — preview de marca */}
          <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow)', flex: '1 1 260px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)' }}>Pré-visualização</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: localColor, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {localLogo
                  ? <img src={localLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  : <span style={{ fontSize: 18, fontWeight: 800, color: textOn(localColor) }}>{initials(localName || 'M')}</span>}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)' }}>{localName || 'Sua marca'}</div>
            </div>
            <button type="button" disabled style={{ width: '100%', padding: '11px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: localColor, color: textOn(localColor), border: 'none', borderRadius: 100, cursor: 'default' }}>Botão primário</button>
            <div>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100, background: localColor, color: textOn(localColor), textTransform: 'uppercase', letterSpacing: '0.06em' }}>Badge</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Integrações ────────────────────────────────────────────────────── */}
      {tab === 'integracoes' && (
        <div className="animate-slide-up delay-2">
          {INTEGRATION_GROUPS
            .map(g => ({ ...g, items: g.items.filter(i => modules.includes(i.moduleKey ?? ('integration.' + i.slug))) }))
            .filter(g => g.items.length > 0)
            .map(group => (
            <div key={group.group} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gray2)', marginBottom: 12 }}>
                {group.group}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.items.map(item => {
                  const st = integStatuses[item.slug] ?? 'loading'
                  const connected = st === 'connected'
                  const isError   = st === 'error'
                  const isPending = st === 'pending'
                  const sdrTooltip = isError && item.slug === 'sdr-source' && sdrSyncMeta
                    ? [sdrSyncMeta.error ?? 'Erro no sync', sdrSyncMeta.lastSyncAt ? relTime(sdrSyncMeta.lastSyncAt) : null].filter(Boolean).join(' · ')
                    : undefined
                  return (
                    <Link
                      key={item.slug}
                      href={item.href}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 16,
                        padding: '14px 16px',
                        background: 'var(--white)', border: '1px solid var(--gray3)',
                        borderRadius: 12, textDecoration: 'none',
                        transition: 'border-color .15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--gray2)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--gray3)' }}
                    >
                      {/* Icon box */}
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        background: item.iconBg,
                        color: item.iconColor ?? 'inherit',
                        border: '1px solid rgba(0,0,0,0.06)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.icon}
                      </div>

                      {/* Label + desc */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>{item.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginTop: 2 }}>{item.desc}</div>
                      </div>

                      {/* Status badge */}
                      <div
                        title={sdrTooltip}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginRight: 8 }}
                      >
                        {st === 'loading' ? (
                          <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>—</span>
                        ) : (
                          <>
                            <div style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: connected ? 'var(--green)' : isError ? '#d97706' : isPending ? 'var(--gray2)' : 'var(--gray3)',
                            }} />
                            <span style={{
                              fontSize: 12, fontWeight: 600,
                              color: connected ? 'var(--green)' : isError ? '#d97706' : 'var(--gray2)',
                            }}>
                              {connected ? 'Conectado' : isError ? 'Atenção' : isPending ? 'Pendente' : 'Não conectado'}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Action pill */}
                      <div style={{
                        padding: '6px 14px', borderRadius: 99, flexShrink: 0,
                        background: 'var(--bg)', border: '1px solid var(--gray3)',
                        fontSize: 12, fontWeight: 700, color: 'var(--gray)',
                      }}>
                        {st === 'disconnected' ? 'Conectar' : 'Gerenciar'}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Auditoria ──────────────────────────────────────────────────────── */}
      {tab === 'campanha-sdr' && (
        <div className="animate-slide-up delay-2">
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow)', maxWidth: 520 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)', marginBottom: 8 }}>Campanha SDR</div>
            <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 20 }}>
              Configure o agente de prospecção: tom, objetivo, horários, templates e limites de disparo.
            </div>
            <Link
              href="/sdr-ia/parametros"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 22px', borderRadius: 100,
                background: 'var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >
              Abrir configuração da campanha
            </Link>
          </div>
        </div>
      )}

      {tab === 'auditoria' && isAdmin && (
        <div className="animate-slide-up delay-2">
          <AuditSection />
        </div>
      )}

      {/* ── Equipe ─────────────────────────────────────────────────────────── */}
      {tab === 'equipe' && (
        <div className="animate-slide-up delay-2">
          {/* Shared header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 0 }}>
            {manageEquipe ? (
              <button
                onClick={() => setManageEquipe(false)}
                style={{ padding: '6px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, background: 'var(--bg)', color: 'var(--gray)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer', flexShrink: 0 }}
              >
                ← Ver equipe
              </button>
            ) : (
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', flexShrink: 0 }}>
                Equipe
              </div>
            )}
            <div style={{ flex: 1, maxWidth: 280, position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray2)', pointerEvents: 'none' }} />
              <input
                value={equipeSearch}
                onChange={e => setEquipeSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 14px 7px 30px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>
            {me?.role === 'admin' && (
              manageEquipe ? (
                <button
                  onClick={() => setInviteOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, background: 'var(--primary)', color: 'var(--primary-contrast)', border: 'none', borderRadius: 100, cursor: 'pointer', flexShrink: 0 }}
                >
                  + Convidar usuário
                </button>
              ) : (
                <button
                  onClick={() => setManageEquipe(true)}
                  style={{ padding: '6px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, background: 'var(--primary)', color: 'var(--primary-contrast)', border: 'none', borderRadius: 100, cursor: 'pointer', flexShrink: 0 }}
                >
                  Gerenciar usuários
                </button>
              )
            )}
          </div>

          {/* Body */}
          {me?.role === 'admin' && manageEquipe ? (
            <UsersSection meId={me.id} search={equipeSearch} inviteOpen={inviteOpen} onInviteOpenChange={setInviteOpen} />
          ) : (
            <div>
              {filteredEquipeUsers.length === 0 && equipeQ ? (
                <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Nenhum membro encontrado.</div>
              ) : filteredEquipeUsers.map((u: any) => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--gray3)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 100, flexShrink: 0, background: u.avatarColor, color: u.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                    {initials(u.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>{u.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)' }}>
                    {u.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  avatarColor: string
  avatarBg: string
  createdAt: string | number
}

const ROLE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  admin:   { bg: '#dbeafe', color: '#1e40af', label: 'Admin' },
  manager: { bg: '#fef3c7', color: '#92400e', label: 'Gerente' },
  user:    { bg: '#f3f4f6', color: '#374151', label: 'Usuário' },
  master:  { bg: '#ede9fe', color: '#5b21b6', label: 'Master' },
}

const ROLE_OPTIONS = [
  { value: 'admin',   label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'user',    label: 'Usuário' },
]

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
  color: 'var(--black)', background: 'var(--white)',
  border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
}

function relTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)}h`
  return `há ${Math.floor(diff / 86_400_000)}d`
}

function textOn(hex: string) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#FFFFFF'
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16)
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? '#121316' : '#FFFFFF'
}

function fmtDate(d: string | number) {
  try {
    const dt = typeof d === 'number' ? new Date(d * 1000) : new Date(d)
    return dt.toLocaleDateString('pt-BR')
  } catch { return '—' }
}

function Field({ value, onChange, type = 'text', placeholder, disabled }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
      style={{ ...fieldStyle, ...(disabled ? { background: 'var(--bg)', color: 'var(--gray)', cursor: 'not-allowed' } : {}) }}
      onFocus={e => { if (!disabled) { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' } }}
      onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
    />
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 32px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'modalSlideUp .2s ease both' }}>
        {children}
      </div>
    </div>
  )
}

function BtnRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>{children}</div>
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: '10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'var(--bg)', color: 'var(--gray)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer' }}>
      Cancelar
    </button>
  )
}

function SubmitBtn({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading} style={{ flex: 2, padding: '10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: loading ? 'var(--gray3)' : 'var(--primary)', color: loading ? 'var(--gray)' : 'var(--primary-contrast)', border: 'none', borderRadius: 100, cursor: loading ? 'not-allowed' : 'pointer' }}>
      {children}
    </button>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>{children}</label>
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '10px 14px', background: 'rgba(217,48,37,0.06)', border: '1px solid rgba(217,48,37,0.2)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
      {msg}
    </div>
  )
}

// ─── UsersSection ─────────────────────────────────────────────────────────────

function UsersSection({ meId, search, inviteOpen, onInviteOpenChange }: { meId: string; search: string; inviteOpen: boolean; onInviteOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
  })

  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('user')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)

  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const userList: UserRow[] = data?.users ?? []
  const searchQ = search.trim().toLowerCase()
  const filteredList: UserRow[] = searchQ
    ? userList.filter(u => u.name.toLowerCase().includes(searchQ) || u.email.toLowerCase().includes(searchQ))
    : userList

  useEffect(() => {
    if (inviteOpen) {
      setInviteName(''); setInviteEmail(''); setInviteRole('user')
      setInviteError(''); setInviteSuccess(false)
    }
  }, [inviteOpen])

  function openEdit(u: UserRow) {
    setEditUser(u); setEditName(u.name); setEditRole(u.role); setEditError('')
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true); setInviteError('')
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inviteName, email: inviteEmail, role: inviteRole }),
    })
    const body = await res.json()
    setInviteLoading(false)
    if (res.ok) {
      setInviteSuccess(true)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      setTimeout(() => { onInviteOpenChange(false); setInviteSuccess(false) }, 1800)
    } else {
      setInviteError(body.error || 'Erro ao enviar convite.')
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setEditLoading(true); setEditError('')
    const res = await fetch(`/api/users/${editUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, role: editRole }),
    })
    const body = await res.json()
    setEditLoading(false)
    if (res.ok) { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditUser(null) }
    else setEditError(body.error || 'Erro ao salvar.')
  }

  async function handleDelete() {
    if (!deleteUser) return
    setDeleteLoading(true)
    await fetch(`/api/users/${deleteUser.id}`, { method: 'DELETE' })
    setDeleteLoading(false)
    setDeleteUser(null)
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }

  return (
    <>
      <div className="animate-slide-up delay-4" style={{ marginTop: 4 }}>
          {isLoading && (
            <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Carregando…</div>
          )}
          {isError && (
            <div style={{ padding: '24px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>Erro ao carregar usuários.</div>
              <button onClick={() => refetch()} style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary-text)', background: 'var(--primary-dim)', border: 'none', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
                Tentar novamente
              </button>
            </div>
          )}

          {!isLoading && !isError && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['', 'Nome', 'E-mail', 'Role', 'Membro desde', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--gray2)', letterSpacing: '0.06em', borderBottom: '1px solid var(--gray3)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredList.map((u, i) => {
                  const badge = ROLE_BADGE[u.role] ?? ROLE_BADGE.user
                  const isMe = u.id === meId
                  return (
                    <tr key={u.id} style={{ borderBottom: i < filteredList.length - 1 ? '1px solid var(--gray3)' : 'none' }}>
                      <td style={{ padding: '10px 16px', width: 44 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: u.avatarColor || 'var(--primary)', color: u.avatarBg || '#121316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                          {initials(u.name)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)', whiteSpace: 'nowrap' }}>
                        {u.name}
                        {isMe && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray2)' }}>(você)</span>}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--gray)' }}>{u.email}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: badge.bg, color: badge.color, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.04em' }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--gray2)', whiteSpace: 'nowrap' }}>
                        {fmtDate(u.createdAt)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <IconBtn title="Editar" onClick={() => openEdit(u)} hoverColor="var(--primary-text)" hoverBorder="var(--primary)">
                            <Pencil size={13} />
                          </IconBtn>
                          {!isMe && (
                            <IconBtn title="Remover" onClick={() => setDeleteUser(u)} hoverColor="var(--red)" hoverBorder="var(--red)">
                              <Trash2 size={13} />
                            </IconBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filteredList.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Nenhum usuário encontrado.</td></tr>
                )}
              </tbody>
            </table>
          )}
      </div>

      {inviteOpen && (
        <Overlay onClose={() => onInviteOpenChange(false)}>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--black)', marginBottom: 4 }}>Convidar usuário</div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>O usuário receberá um link para criar sua senha.</div>
          {inviteSuccess ? (
            <div style={{ padding: 20, background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.25)', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#145c2a', textAlign: 'center' }}>
              ✓ Convite enviado com sucesso!
            </div>
          ) : (
            <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><FieldLabel>NOME *</FieldLabel><Field value={inviteName} onChange={e => setInviteName((e.target as HTMLInputElement).value)} placeholder="Nome completo" required /></div>
              <div><FieldLabel>E-MAIL *</FieldLabel><Field type="email" value={inviteEmail} onChange={e => setInviteEmail((e.target as HTMLInputElement).value)} placeholder="email@exemplo.com" required /></div>
              <div>
                <FieldLabel>PERFIL *</FieldLabel>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {inviteError && <ErrorBanner msg={inviteError} />}
              <BtnRow><CancelBtn onClick={() => onInviteOpenChange(false)} /><SubmitBtn loading={inviteLoading}>{inviteLoading ? 'Enviando…' : 'Enviar convite'}</SubmitBtn></BtnRow>
            </form>
          )}
        </Overlay>
      )}

      {editUser && (
        <Overlay onClose={() => setEditUser(null)}>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--black)', marginBottom: 24 }}>Editar usuário</div>
          <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><FieldLabel>E-MAIL</FieldLabel><Field value={editUser.email} disabled /></div>
            <div><FieldLabel>NOME</FieldLabel><Field value={editName} onChange={e => setEditName((e.target as HTMLInputElement).value)} placeholder="Nome completo" required /></div>
            <div>
              <FieldLabel>PERFIL</FieldLabel>
              {editUser.id === meId ? (
                <Field value={ROLE_BADGE[editUser.role]?.label ?? editUser.role} disabled />
              ) : (
                <select value={editRole} onChange={e => setEditRole(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
            {editError && <ErrorBanner msg={editError} />}
            <BtnRow><CancelBtn onClick={() => setEditUser(null)} /><SubmitBtn loading={editLoading}>{editLoading ? 'Salvando…' : 'Salvar'}</SubmitBtn></BtnRow>
          </form>
        </Overlay>
      )}

      {deleteUser && (
        <Overlay onClose={() => setDeleteUser(null)}>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--black)', marginBottom: 12 }}>Remover usuário</div>
          <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 24 }}>
            Tem certeza que deseja remover <strong style={{ color: 'var(--black)' }}>{deleteUser.name}</strong>? Esta ação não pode ser desfeita.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <CancelBtn onClick={() => setDeleteUser(null)} />
            <button
              onClick={handleDelete}
              disabled={deleteLoading}
              style={{ flex: 2, padding: '10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: deleteLoading ? 'var(--gray3)' : 'var(--red)', color: deleteLoading ? 'var(--gray)' : '#fff', border: 'none', borderRadius: 100, cursor: deleteLoading ? 'not-allowed' : 'pointer' }}
            >
              {deleteLoading ? 'Removendo…' : 'Remover'}
            </button>
          </div>
        </Overlay>
      )}
    </>
  )
}

// ─── AuditSection ─────────────────────────────────────────────────────────────

type AuditLog = {
  id: string
  createdAt: string
  actorName: string | null
  actorEmail: string | null
  actorRole: string | null
  action: string
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown>
  ip: string | null
}

const LIMIT = 50

function AuditSection() {
  const [actionFilter, setActionFilter] = useState('')
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  async function load(newOffset: number, newAction: string, append: boolean) {
    if (newOffset === 0) setLoading(true); else setLoadingMore(true)
    setError('')
    try {
      const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(newOffset), ...(newAction ? { action: newAction } : {}) })
      const res = await fetch(`/api/audit-logs?${qs}`)
      if (!res.ok) { setError('Erro ao carregar logs.'); return }
      const data = await res.json() as { logs: AuditLog[]; total: number }
      setLogs(prev => append ? [...prev, ...data.logs] : data.logs)
      setTotal(data.total)
      setOffset(newOffset)
    } catch { setError('Erro ao carregar logs.') }
    finally { setLoading(false); setLoadingMore(false) }
  }

  useEffect(() => {
    load(0, actionFilter, false)
  }, [actionFilter])

  const hasMore = logs.length < total

  const thStyle: React.CSSProperties = { padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--gray2)', letterSpacing: '0.06em', borderBottom: '1px solid var(--gray3)', whiteSpace: 'nowrap' }
  const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 12, color: 'var(--gray)', verticalAlign: 'top' }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', flexShrink: 0 }}>
          Auditoria
        </div>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setOffset(0) }}
          style={{ padding: '6px 12px', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none', cursor: 'pointer' }}
        >
          <option value="">Todas as ações</option>
          {Object.entries(ACTION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>{total} registro{total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Skeleton */}
      {loading && (
        <div style={{ padding: '24px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="shimmer-bar" style={{ height: 36, borderRadius: 6, background: 'var(--gray3)' }} />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ padding: '24px 14px' }}>
          <ErrorBanner msg={error} />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && logs.length === 0 && (
        <div style={{ padding: '40px 14px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
          Nenhum registro de auditoria encontrado.
        </div>
      )}

      {/* Table */}
      {!loading && !error && logs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={thStyle}>Quando</th>
                <th style={thStyle}>Quem</th>
                <th style={thStyle}>Ação</th>
                <th style={thStyle}>Detalhe</th>
                <th style={thStyle}>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id} style={{ borderBottom: i < logs.length - 1 ? '1px solid var(--gray3)' : 'none' }}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--black)', fontWeight: 500 }}>
                    {fmtDateTime(log.createdAt)}
                  </td>
                  <td style={{ ...tdStyle, minWidth: 140 }}>
                    <div style={{ fontWeight: 700, color: 'var(--black)', fontSize: 12 }}>{log.actorName ?? '—'}</div>
                    <div style={{ color: 'var(--gray2)', fontSize: 11 }}>{log.actorEmail ?? ''}</div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)' }}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 320, wordBreak: 'break-word' }}>
                    {fmtDetail(log.action, log.entityType, log.entityId, log.metadata)}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                    {log.ip ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {!loading && !error && hasMore && (
        <div style={{ padding: '16px 14px', textAlign: 'center' }}>
          <button
            onClick={() => load(offset + LIMIT, actionFilter, true)}
            disabled={loadingMore}
            style={{ padding: '8px 24px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: loadingMore ? 'var(--gray3)' : 'var(--bg)', color: loadingMore ? 'var(--gray)' : 'var(--black)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: loadingMore ? 'not-allowed' : 'pointer' }}
          >
            {loadingMore ? 'Carregando…' : `Carregar mais (${total - logs.length} restantes)`}
          </button>
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, title, onClick, hoverColor, hoverBorder }: { children: React.ReactNode; title: string; onClick: () => void; hoverColor: string; hoverBorder: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--gray3)', borderRadius: 6, cursor: 'pointer', color: 'var(--gray)', transition: 'all .15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = hoverBorder; e.currentTarget.style.color = hoverColor }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--gray3)'; e.currentTarget.style.color = 'var(--gray)' }}
    >
      {children}
    </button>
  )
}
