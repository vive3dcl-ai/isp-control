import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  apiFetch,
  downloadDbBackup,
  restoreDbBackup,
} from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { PanelShell } from '../components/PanelShell'
import { SettingsSubTabs } from '../components/SettingsSubTabs'
import { SmtpConfigModal } from '../components/SmtpConfigModal'
import type { SystemPlan, SystemPlansAdmin } from '../lib/platform'
import type { PlatformBranding } from '../lib/branding'
import { DEFAULT_PLATFORM_BRANDING } from '../lib/branding'

const inputClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2'

const TABS = [
  { id: 'branding', label: 'Branding' },
  { id: 'urls', label: 'Dominio' },
  { id: 'vpn', label: 'VPN' },
  { id: 'smtp', label: 'SMTP' },
  { id: 'system', label: 'Valor del sistema' },
  { id: 'backup', label: 'Respaldo' },
] as const

type Section = (typeof TABS)[number]['id']

type PublicUrlsResponse = {
  publicApiUrl: string
  publicWebUrl: string
  resolvedApiUrl: string
  resolvedWebUrl: string
  sourceApi: string
  sourceWeb: string
}

export function AdminSettingsPage() {
  const [section, setSection] = useState<Section>('branding')
  const [smtpOpen, setSmtpOpen] = useState(false)

  return (
    <PanelShell
      title="Ajustes"
      subtitle="Configuración global de la plataforma"
      variant="admin"
    >
      <SettingsSubTabs
        tabs={TABS}
        value={section}
        onChange={setSection}
        aria-label="Secciones de ajustes"
      />

      {section === 'branding' && <BrandingPanel />}

      {section === 'urls' && <PublicUrlsPanel />}

      {section === 'vpn' && <WireguardConcentratorPanel />}

      {section === 'smtp' && (
        <div className="mt-5 max-w-xl">
          <p className="mb-4 text-sm text-[var(--text-muted)]">
            SMTP de la plataforma para avisos a administradores (vencimiento de
            módulos de pago único, etc.). Independiente del SMTP de cada
            empresa.
          </p>
          <button
            type="button"
            onClick={() => setSmtpOpen(true)}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Configurar SMTP
          </button>
          <SmtpConfigModal
            open={smtpOpen}
            canWrite
            scope="platform"
            onClose={() => setSmtpOpen(false)}
          />
        </div>
      )}

      {section === 'system' && <SystemValuePanel />}

      {section === 'backup' && <BackupPanel />}
    </PanelShell>
  )
}

function PublicUrlsPanel() {
  const queryClient = useQueryClient()
  const [apiUrl, setApiUrl] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['admin', 'settings', 'public-urls'],
    queryFn: () =>
      apiFetch<PublicUrlsResponse>('/admin/settings/public-urls'),
  })

  useEffect(() => {
    if (!query.data) return
    setApiUrl(query.data.publicApiUrl ?? '')
    setWebUrl(query.data.publicWebUrl ?? '')
  }, [query.data])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<PublicUrlsResponse>('/admin/settings/public-urls', {
        method: 'PATCH',
        body: JSON.stringify({
          publicApiUrl: apiUrl.trim(),
          publicWebUrl: webUrl.trim(),
        }),
      }),
    onSuccess: (data) => {
      setApiUrl(data.publicApiUrl)
      setWebUrl(data.publicWebUrl)
      setMsg('URLs públicas guardadas')
      void queryClient.setQueryData(
        ['admin', 'settings', 'public-urls'],
        data,
      )
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'company'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  const exampleSlug = 'demo'
  const examplePortal = query.data?.resolvedWebUrl
    ? `${query.data.resolvedWebUrl.replace(/\/$/, '')}/${exampleSlug}/suspension`
    : '—'

  return (
    <div className="mt-5 max-w-2xl space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Dominio público del panel en producción. El portal de suspensión queda
        en el panel (<code>/{'{slug}'}/suspension</code>), no bajo{' '}
        <code>/api</code>. La URL de la API se usa para el backend y bootstrap
        VPN. Si dejas vacío, se usan variables de entorno (o se deriva el
        origen del panel quitando <code>/api</code>).
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-[var(--text-muted)]">
          URL pública de la API
        </span>
        <input
          className={`${inputClass} w-full`}
          placeholder="https://panel.tuisp.com/api"
          value={apiUrl}
          onChange={(e) => {
            setMsg(null)
            setApiUrl(e.target.value)
          }}
        />
        <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
          Debe ser alcanzable desde los MikroTik (no uses localhost en
          producción).
        </span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-[var(--text-muted)]">
          URL pública del panel web
        </span>
        <input
          className={`${inputClass} w-full`}
          placeholder="https://panel.tuisp.com"
          value={webUrl}
          onChange={(e) => {
            setMsg(null)
            setWebUrl(e.target.value)
          }}
        />
        <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
          Origen del panel. Aquí vive el portal cautivo{' '}
          <code>/{'{slug}'}/suspension</code>.
        </span>
      </label>

      {query.data && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            Efectivo ahora
          </p>
          <p className="mt-1 break-all font-mono text-xs">
            API ({query.data.sourceApi}): {query.data.resolvedApiUrl}
          </p>
          <p className="mt-1 break-all font-mono text-xs">
            Web ({query.data.sourceWeb}): {query.data.resolvedWebUrl}
          </p>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Ejemplo portal tenant «{exampleSlug}»:
          </p>
          <p className="break-all font-mono text-xs text-[var(--text)]">
            {examplePortal}
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {mutation.isPending ? 'Guardando…' : 'Guardar dominio'}
      </button>

      {msg && (
        <p
          className={
            mutation.isError
              ? 'text-sm text-[var(--danger)]'
              : 'text-sm text-emerald-400'
          }
        >
          {msg}
        </p>
      )}
    </div>
  )
}

type WgConcentratorResponse = {
  host: string
  listenPort: number
  publicKey: string
  peerCount: number
  peers: Array<{
    tenant: string
    tunnel: string
    clientAddress: string
    serverAddress: string
    clientPublicKey: string
  }>
  conf: string
}

type OpenVpnConcentratorResponse = {
  host: string
  ports: { openvpn_tcp: number; openvpn_udp: number }
  userCount: number
  users: Array<{
    tenant: string
    tunnel: string
    username: string
    protocol: string
    port: number
    clientAddress: string
    serverAddress: string
  }>
  conf: string
  mikrotikCommands: string
}

function WireguardConcentratorPanel() {
  const [copied, setCopied] = useState<string | null>(null)
  const wgQuery = useQuery({
    queryKey: ['admin', 'vpn', 'wireguard-concentrator'],
    queryFn: () =>
      apiFetch<WgConcentratorResponse>('/admin/vpn/wireguard-concentrator'),
  })
  const ovpnQuery = useQuery({
    queryKey: ['admin', 'vpn', 'openvpn-concentrator'],
    queryFn: () =>
      apiFetch<OpenVpnConcentratorResponse>('/admin/vpn/openvpn-concentrator'),
  })

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    window.setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mt-5 max-w-2xl space-y-8">
      <p className="text-sm text-[var(--text-muted)]">
        Concentrador multi-tenant en <code>VPN_PUBLIC_HOST</code>. WireGuard
        usa <code>VPN_PORT_WIREGUARD</code>; OpenVPN{' '}
        <code>VPN_PORT_OPENVPN_TCP</code> / <code>VPN_PORT_OPENVPN_UDP</code>.
        Los MikroTik hacen <code>connect-to</code> a ese host; el servicio{' '}
        <code>vpn-concentrator</code> sincroniza peers/usuarios desde la API.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">WireGuard</h3>
        {wgQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {wgQuery.error && (
          <p className="text-sm text-[var(--danger)]">
            {wgQuery.error.message}
          </p>
        )}
        {wgQuery.data && (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">Endpoint</dt>
                <dd className="font-mono text-xs">
                  {wgQuery.data.host}:{wgQuery.data.listenPort}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Peers</dt>
                <dd>{wgQuery.data.peerCount}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--text-muted)]">Public key</dt>
                <dd className="break-all font-mono text-xs">
                  {wgQuery.data.publicKey}
                </dd>
              </div>
            </dl>
            <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
              {wgQuery.data.conf}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyText(wgQuery.data!.conf, 'wg')}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
              >
                {copied === 'wg' ? 'Copiado' : 'Copiar wg0.conf'}
              </button>
              <button
                type="button"
                onClick={() => void wgQuery.refetch()}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Actualizar
              </button>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">OpenVPN</h3>
        {ovpnQuery.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {ovpnQuery.error && (
          <p className="text-sm text-[var(--danger)]">
            {ovpnQuery.error.message}
          </p>
        )}
        {ovpnQuery.data && (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">Host</dt>
                <dd className="font-mono text-xs">{ovpnQuery.data.host}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Puertos</dt>
                <dd className="font-mono text-xs">
                  TCP {ovpnQuery.data.ports.openvpn_tcp} · UDP{' '}
                  {ovpnQuery.data.ports.openvpn_udp}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Usuarios</dt>
                <dd>{ovpnQuery.data.userCount}</dd>
              </div>
            </dl>
            <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs whitespace-pre-wrap">
              {ovpnQuery.data.conf || '# Sin túneles OpenVPN'}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!ovpnQuery.data.conf}
                onClick={() => void copyText(ovpnQuery.data!.conf, 'ovpn')}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {copied === 'ovpn' ? 'Copiado' : 'Copiar usuarios/CCD'}
              </button>
              <button
                type="button"
                disabled={!ovpnQuery.data.mikrotikCommands}
                onClick={() =>
                  void copyText(ovpnQuery.data!.mikrotikCommands, 'ovpn-mt')
                }
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
              >
                {copied === 'ovpn-mt' ? 'Copiado' : 'Copiar cmds MikroTik'}
              </button>
              <button
                type="button"
                onClick={() => void ovpnQuery.refetch()}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Actualizar
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function SystemValuePanel() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<SystemPlan[]>([])
  const [blockPrice, setBlockPrice] = useState(40)
  const [blockSize, setBlockSize] = useState(50)
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['admin', 'settings', 'system-plans'],
    queryFn: () =>
      apiFetch<SystemPlansAdmin>('/admin/settings/system-plans'),
  })

  useEffect(() => {
    if (!query.data) return
    setDraft(query.data.plans)
    setBlockPrice(query.data.extraBlockPriceUsd)
    setBlockSize(query.data.extraBlockSize)
  }, [query.data])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<SystemPlansAdmin>('/admin/settings/system-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          plans: draft.map((p) => ({
            code: p.code,
            priceUsd: Number(p.priceUsd),
            enabled: p.enabled,
            isFree: !!p.isFree,
          })),
          extraBlockPriceUsd: Number(blockPrice),
        }),
      }),
    onSuccess: (data) => {
      setDraft(data.plans)
      setBlockPrice(data.extraBlockPriceUsd)
      setBlockSize(data.extraBlockSize)
      setMsg('Planes guardados')
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'settings', 'system-plans'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  return (
    <div className="mt-5 max-w-2xl">
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Planes mensuales por cupo de ONUs (usuarios). Marca <strong>Gratis</strong>
        para que la landing (y el cobro) lo muestren sin costo; el precio USD se
        conserva para cuando lo desactives. El primer mes y los cambios se
        prorratean a mes calendario. Las empresas pueden contratar bloques
        extra de {blockSize} usuarios.
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <ul className="space-y-3">
        {draft.map((p) => (
          <li
            key={p.code}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3"
          >
            <div className="min-w-[8rem]">
              <p className="text-sm font-medium">{p.label}</p>
              <p className="text-xs text-[var(--text-muted)]">
                Cupo {p.userLimit} ONUs · mensual
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-muted)]">USD/mes</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} w-28`}
                disabled={mutation.isPending}
                value={p.priceUsd}
                onChange={(e) => {
                  setMsg(null)
                  const v = Number(e.target.value)
                  setDraft((prev) =>
                    prev.map((x) =>
                      x.code === p.code
                        ? { ...x, priceUsd: Number.isFinite(v) ? v : 0 }
                        : x,
                    ),
                  )
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!p.isFree}
                disabled={mutation.isPending}
                onChange={(e) => {
                  setMsg(null)
                  setDraft((prev) =>
                    prev.map((x) =>
                      x.code === p.code
                        ? { ...x, isFree: e.target.checked }
                        : x,
                    ),
                  )
                }}
              />
              Gratis
            </label>
            <label className="ml-auto flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={p.enabled}
                disabled={mutation.isPending}
                onChange={(e) => {
                  setMsg(null)
                  setDraft((prev) =>
                    prev.map((x) =>
                      x.code === p.code
                        ? { ...x, enabled: e.target.checked }
                        : x,
                    ),
                  )
                }}
              />
              Disponible
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
        <div className="min-w-[10rem]">
          <p className="text-sm font-medium">Bloque extra</p>
          <p className="text-xs text-[var(--text-muted)]">
            +{blockSize} usuarios
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)]">USD/mes</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className={`${inputClass} w-28`}
            disabled={mutation.isPending}
            value={blockPrice}
            onChange={(e) => {
              setMsg(null)
              const v = Number(e.target.value)
              setBlockPrice(Number.isFinite(v) ? v : 0)
            }}
          />
        </label>
      </div>

      {msg && (
        <p
          className={`mt-3 text-sm ${
            msg.includes('guardados')
              ? 'text-emerald-400'
              : 'text-[var(--danger)]'
          }`}
        >
          {msg}
        </p>
      )}

      <button
        type="button"
        disabled={mutation.isPending || draft.length === 0}
        onClick={() => mutation.mutate()}
        className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        {mutation.isPending ? 'Guardando…' : 'Guardar precios'}
      </button>
    </div>
  )
}

type BrandingForm = {
  productName: string
  shortName: string
  pageTitle: string
  metaDescription: string
  metaKeywords: string
  logoUrl: string
  faviconUrl: string
  ogImageUrl: string
  footerText: string
  footerCopyright: string
  loginTagline: string
}

const emptyBrandingForm = (): BrandingForm => ({
  productName: '',
  shortName: '',
  pageTitle: '',
  metaDescription: '',
  metaKeywords: '',
  logoUrl: '',
  faviconUrl: '',
  ogImageUrl: '',
  footerText: '',
  footerCopyright: '',
  loginTagline: '',
})

function BrandingPanel() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<BrandingForm>(emptyBrandingForm)
  const [msg, setMsg] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['admin', 'settings', 'branding'],
    queryFn: () => apiFetch<PlatformBranding>('/admin/settings/branding'),
  })

  useEffect(() => {
    if (!query.data) return
    const raw = query.data.raw
    setForm({
      productName: raw?.productName ?? '',
      shortName: raw?.shortName ?? '',
      pageTitle: raw?.pageTitle ?? '',
      metaDescription: raw?.metaDescription ?? '',
      metaKeywords: raw?.metaKeywords ?? '',
      logoUrl: raw?.logoUrl ?? query.data.logoUrl ?? '',
      faviconUrl: raw?.faviconUrl ?? query.data.faviconUrl ?? '',
      ogImageUrl: raw?.ogImageUrl ?? query.data.ogImageUrl ?? '',
      footerText: raw?.footerText ?? '',
      footerCopyright: raw?.footerCopyright ?? '',
      loginTagline: raw?.loginTagline ?? '',
    })
  }, [query.data])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<PlatformBranding>('/admin/settings/branding', {
        method: 'PATCH',
        body: JSON.stringify(form),
      }),
    onSuccess: (data) => {
      setMsg('Branding guardado')
      void queryClient.setQueryData(['admin', 'settings', 'branding'], data)
      void queryClient.invalidateQueries({ queryKey: ['public', 'branding'] })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  function set<K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) {
    setMsg(null)
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function onImageFile(
    field: 'logoUrl' | 'faviconUrl' | 'ogImageUrl',
    file: File | undefined,
  ) {
    setFileError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setFileError('El archivo debe ser una imagen')
      return
    }
    if (file.size > 1_500_000) {
      setFileError('La imagen supera 1,5 MB; usa una más liviana')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set(field, String(reader.result))
    reader.onerror = () => setFileError('No se pudo leer la imagen')
    reader.readAsDataURL(file)
  }

  const preview = {
    productName: form.productName.trim() || DEFAULT_PLATFORM_BRANDING.productName,
    shortName: form.shortName.trim() || DEFAULT_PLATFORM_BRANDING.shortName,
  }

  return (
    <div className="mt-5 max-w-3xl space-y-6">
      <p className="text-sm text-[var(--text-muted)]">
        Identidad de la plataforma: logos unificados, nombre, SEO, footer y
        textos de login. Los logos de cada empresa siguen en Ajustes → Empresa
        del tenant.
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Identidad</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Nombre del producto
            </span>
            <input
              className={`${inputClass} w-full`}
              value={form.productName}
              placeholder={DEFAULT_PLATFORM_BRANDING.productName}
              onChange={(e) => set('productName', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Nombre corto (badge sin logo)
            </span>
            <input
              className={`${inputClass} w-full`}
              value={form.shortName}
              placeholder={DEFAULT_PLATFORM_BRANDING.shortName}
              onChange={(e) => set('shortName', e.target.value)}
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Tagline de login
          </span>
          <input
            className={`${inputClass} w-full`}
            value={form.loginTagline}
            placeholder={DEFAULT_PLATFORM_BRANDING.loginTagline}
            onChange={(e) => set('loginTagline', e.target.value)}
          />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Logos</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <ImageField
            label="Logo principal"
            hint="Sidebar y login"
            value={form.logoUrl}
            onClear={() => set('logoUrl', '')}
            onFile={(f) => onImageFile('logoUrl', f)}
            previewSize={56}
            fallback={
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-md bg-[var(--accent)] text-sm font-bold text-white">
                {preview.shortName.slice(0, 4)}
              </span>
            }
          />
          <ImageField
            label="Favicon"
            hint="Pestaña del navegador"
            value={form.faviconUrl}
            onClear={() => set('faviconUrl', '')}
            onFile={(f) => onImageFile('faviconUrl', f)}
            previewSize={32}
          />
          <ImageField
            label="Imagen OG"
            hint="Redes / Open Graph"
            value={form.ogImageUrl}
            onClear={() => set('ogImageUrl', '')}
            onFile={(f) => onImageFile('ogImageUrl', f)}
            previewSize={56}
          />
        </div>
        {fileError && (
          <p className="text-sm text-[var(--danger)]">{fileError}</p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">SEO</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Título de la página
          </span>
          <input
            className={`${inputClass} w-full`}
            value={form.pageTitle}
            placeholder={DEFAULT_PLATFORM_BRANDING.pageTitle}
            onChange={(e) => set('pageTitle', e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Meta descripción
          </span>
          <textarea
            className={`${inputClass} w-full`}
            rows={3}
            value={form.metaDescription}
            placeholder={DEFAULT_PLATFORM_BRANDING.metaDescription}
            onChange={(e) => set('metaDescription', e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Keywords (separadas por coma)
          </span>
          <input
            className={`${inputClass} w-full`}
            value={form.metaKeywords}
            placeholder={DEFAULT_PLATFORM_BRANDING.metaKeywords}
            onChange={(e) => set('metaKeywords', e.target.value)}
          />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Footer del panel</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Texto izquierdo
            </span>
            <input
              className={`${inputClass} w-full`}
              value={form.footerText}
              placeholder={DEFAULT_PLATFORM_BRANDING.footerText}
              onChange={(e) => set('footerText', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Copyright (texto completo)
            </span>
            <input
              className={`${inputClass} w-full`}
              value={form.footerCopyright}
              placeholder={DEFAULT_PLATFORM_BRANDING.footerCopyright}
              onChange={(e) => set('footerCopyright', e.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          A la derecha se muestra: «
          {form.footerCopyright.trim() ||
            DEFAULT_PLATFORM_BRANDING.footerCopyright}{' '}
          {new Date().getFullYear()}» (el año se agrega solo).
        </p>
      </section>

      {msg && (
        <p
          className={`text-sm ${
            msg.includes('guardado')
              ? 'text-emerald-400'
              : 'text-[var(--danger)]'
          }`}
        >
          {msg}
        </p>
      )}

      <button
        type="button"
        disabled={mutation.isPending || query.isLoading}
        onClick={() => mutation.mutate()}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        {mutation.isPending ? 'Guardando…' : 'Guardar branding'}
      </button>
    </div>
  )
}

function ImageField({
  label,
  hint,
  value,
  onClear,
  onFile,
  previewSize,
  fallback,
}: {
  label: string
  hint: string
  value: string
  onClear: () => void
  onFile: (file: File | undefined) => void
  previewSize: number
  fallback?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <p className="text-sm font-medium">{label}</p>
      <p className="mb-2 text-[11px] text-[var(--text-muted)]">{hint}</p>
      <div className="mb-2 flex min-h-[3.5rem] items-center justify-center">
        {value ? (
          <img
            src={value}
            alt={label}
            className="object-contain"
            style={{ maxWidth: previewSize * 2, maxHeight: previewSize }}
          />
        ) : (
          (fallback ?? (
            <span className="text-xs text-[var(--text-muted)]">Sin imagen</span>
          ))
        )}
      </div>
      <input
        type="file"
        accept="image/*"
        className="block w-full text-xs"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 text-xs text-[var(--danger)] hover:underline"
        >
          Quitar
        </button>
      )}
    </div>
  )
}

function BackupPanel() {
  const { user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin'
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function onDownload() {
    setErr(null)
    setMsg(null)
    setDownloading(true)
    try {
      await downloadDbBackup()
      setMsg('Respaldo descargado.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al descargar')
    } finally {
      setDownloading(false)
    }
  }

  async function onRestore() {
    setErr(null)
    setMsg(null)
    if (!file) {
      setErr('Selecciona un archivo .backup')
      return
    }
    if (confirmText.trim() !== 'RESTORE') {
      setErr('Escribe RESTORE para confirmar la restauración.')
      return
    }
    setRestoring(true)
    try {
      const result = await restoreDbBackup(file)
      setMsg(result.message)
      setFile(null)
      setConfirmText('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al restaurar')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="mt-5 max-w-xl space-y-6">
      <p className="text-sm text-[var(--text-muted)]">
        Respaldo completo de Postgres: esquema{' '}
        <code className="text-xs">public</code> y todos los{' '}
        <code className="text-xs">tenant_*</code>. Al actualizar imágenes Docker
        los datos no se borran (volúmenes); esto sirve para copias de seguridad y
        recuperación.
      </p>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Descargar</h3>
        <p className="mt-1 mb-3 text-xs text-[var(--text-muted)]">
          Genera un archivo <code>.backup</code> (formato personalizado de
          PostgreSQL).
        </p>
        <button
          type="button"
          disabled={downloading}
          onClick={() => void onDownload()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {downloading ? 'Generando…' : 'Descargar respaldo'}
        </button>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Restaurar</h3>
        <p className="mt-1 mb-3 text-xs text-[var(--danger)]">
          Reemplaza todos los datos actuales. Operación irreversible. Solo
          superadmin.
        </p>
        {!isSuperadmin ? (
          <p className="text-sm text-[var(--text-muted)]">
            Tu rol no puede restaurar. Pide a un superadmin.
          </p>
        ) : (
          <div className="space-y-3">
            <input
              type="file"
              accept=".backup,.dump,application/octet-stream"
              className="block w-full text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <label className="block text-xs text-[var(--text-muted)]">
              Escribe <strong>RESTORE</strong> para confirmar
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className={`mt-1 block w-full ${inputClass}`}
                placeholder="RESTORE"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              disabled={restoring || !file || confirmText.trim() !== 'RESTORE'}
              onClick={() => void onRestore()}
              className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {restoring ? 'Restaurando…' : 'Restaurar base de datos'}
            </button>
          </div>
        )}
      </section>

      {msg && (
        <p className="text-sm text-[var(--success,var(--accent))]">{msg}</p>
      )}
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
    </div>
  )
}
