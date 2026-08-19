import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import type { CompanyProfile } from '../lib/company'

type TemplateMeta = {
  id: string
  name: string
  description: string
}

type TemplatesResponse = {
  templates: TemplateMeta[]
  defaultId: string
}

type PortalMode = 'internal' | 'external'

const MAX_LOGO_BYTES = 1_000_000
/** Display size in templates ≈ 220×72; 2× for retina */
const LOGO_OPTIMAL = {
  width: 440,
  height: 144,
  label: '440 × 144 px',
}

export function SuspensionPortalSettingsTab({
  canWrite,
}: {
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<PortalMode>('internal')
  const [externalUrl, setExternalUrl] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoError, setLogoError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
  })

  const templatesQuery = useQuery({
    queryKey: ['app', 'settings', 'company', 'suspension-portal', 'templates'],
    queryFn: () =>
      apiFetch<TemplatesResponse>(
        '/app/settings/company/suspension-portal/templates',
      ),
  })

  useEffect(() => {
    if (!companyQuery.data) return
    setSelectedId(
      companyQuery.data.suspensionPortalTemplateId ||
        templatesQuery.data?.defaultId ||
        'midnight',
    )
    setMode(
      companyQuery.data.suspensionPortalMode === 'external'
        ? 'external'
        : 'internal',
    )
    setExternalUrl(companyQuery.data.suspensionPortalExternalUrl ?? '')
    setLogoUrl(companyQuery.data.suspensionPortalLogoUrl ?? '')
  }, [companyQuery.data, templatesQuery.data?.defaultId])

  const activeId =
    selectedId ||
    companyQuery.data?.suspensionPortalTemplateId ||
    templatesQuery.data?.defaultId ||
    'midnight'

  const savedLogo = companyQuery.data?.suspensionPortalLogoUrl ?? ''
  const previewQuery = useQuery({
    queryKey: [
      'app',
      'settings',
      'company',
      'suspension-portal',
      'preview',
      activeId,
      savedLogo.slice(0, 64),
    ],
    queryFn: () =>
      apiFetch<{ html: string }>(
        `/app/settings/company/suspension-portal/preview?templateId=${encodeURIComponent(activeId)}`,
      ),
    enabled: !!activeId && mode === 'internal',
  })

  const saveMutation = useMutation({
    mutationFn: (payload: {
      suspensionPortalTemplateId?: string
      suspensionPortalMode: PortalMode
      suspensionPortalExternalUrl: string
      suspensionPortalLogoUrl?: string
    }) =>
      apiFetch<CompanyProfile>('/app/settings/company', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      void queryClient.setQueryData(['app', 'settings', 'company'], data)
      void queryClient.invalidateQueries({
        queryKey: [
          'app',
          'settings',
          'company',
          'suspension-portal',
          'preview',
        ],
      })
      if (data.suspensionPortalNeedsMikrotikReconfigure) {
        setMsg(
          'Guardado. Debes reconfigurar MikroTik: el destino del portal cambió.',
        )
      } else {
        setMsg('Configuración del portal guardada')
      }
    },
  })

  const company = companyQuery.data
  const templates = templatesQuery.data?.templates ?? []
  const portalUrl = company?.suspensionPortalUrl ?? ''
  const needsReconfigure = !!company?.suspensionPortalNeedsMikrotikReconfigure
  const companyLogo = company?.logoUrl ?? ''
  const previewLogo = logoUrl.trim() || companyLogo

  const dirty =
    mode !== (company?.suspensionPortalMode ?? 'internal') ||
    (mode === 'external' &&
      externalUrl.trim() !== (company?.suspensionPortalExternalUrl ?? '')) ||
    (mode === 'internal' &&
      (!!selectedId && selectedId !== company?.suspensionPortalTemplateId ||
        logoUrl !== (company?.suspensionPortalLogoUrl ?? '')))

  function onLogoFile(file: File | undefined) {
    setLogoError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLogoError('El archivo debe ser una imagen (PNG, JPG, WebP o SVG)')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('La imagen supera 1 MB; usa una más liviana')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setMsg(null)
      setLogoUrl(String(reader.result))
    }
    reader.onerror = () => setLogoError('No se pudo leer la imagen')
    reader.readAsDataURL(file)
  }

  function onSave() {
    setMsg(null)
    saveMutation.mutate({
      suspensionPortalMode: mode,
      suspensionPortalExternalUrl: mode === 'external' ? externalUrl.trim() : '',
      ...(mode === 'internal'
        ? {
            suspensionPortalLogoUrl: logoUrl,
            ...(selectedId
              ? { suspensionPortalTemplateId: selectedId }
              : {}),
          }
        : {}),
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Portal de suspensión</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Elige portal interno (plantillas) o un enlace externo. HTTPS no
            redirige (solo HTTP + allow-list de pagos). IPv6 no se corta. Sin
            IP WAN o MikroTik, el corte es disable en la OLT.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            disabled={!dirty || saveMutation.isPending}
            onClick={onSave}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>

      {needsReconfigure && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">Reconfiguración MikroTik necesaria</p>
          <p className="mt-1 text-[13px] text-amber-100/85">
            El destino del portal cambió respecto a lo aplicado en los routers.
            Ve a{' '}
            <Link
              to="/app/settings"
              className="underline underline-offset-2 hover:text-white"
            >
              Ajustes → Empresa
            </Link>{' '}
            y pulsa <strong>Configurar MikroTik</strong> en todos los routers
            seleccionados para actualizar NAT y reglas con el nuevo enlace.
          </p>
          {company?.suspensionPortalAppliedUrl && (
            <p className="mt-2 font-mono text-[11px] text-amber-100/70">
              Antes: {company.suspensionPortalAppliedUrl}
              <br />
              Ahora: {portalUrl}
            </p>
          )}
        </div>
      )}

      {(msg || saveMutation.error) && (
        <p
          className={
            saveMutation.error
              ? 'text-sm text-[var(--danger)]'
              : 'text-sm text-emerald-400'
          }
        >
          {saveMutation.error?.message ?? msg}
        </p>
      )}

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
        <p className="text-sm font-medium">Tipo de portal</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="portal-mode"
              disabled={!canWrite}
              className="mt-1"
              checked={mode === 'internal'}
              onChange={() => {
                setMsg(null)
                setMode('internal')
              }}
            />
            <span>
              <span className="font-medium">Interno</span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                Página de ISP Control con plantillas
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="portal-mode"
              disabled={!canWrite}
              className="mt-1"
              checked={mode === 'external'}
              onChange={() => {
                setMsg(null)
                setMode('external')
              }}
            />
            <span>
              <span className="font-medium">Externo</span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                Tu propio portal (pega el enlace)
              </span>
            </span>
          </label>
        </div>

        {mode === 'internal' && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              URL única del tenant
            </p>
            <p className="mt-1 break-all font-mono text-sm">
              {portalUrl || '—'}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              En el dominio del panel:{' '}
              <code>/{'{slug}'}/suspension</code> (no bajo <code>/api</code>).
            </p>
          </div>
        )}

        {mode === 'external' && (
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              Enlace del portal externo
            </span>
            <input
              type="url"
              disabled={!canWrite}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
              placeholder="https://pagos.tuisp.com/suspendido"
              value={externalUrl}
              onChange={(e) => {
                setMsg(null)
                setExternalUrl(e.target.value)
              }}
            />
            <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
              Debe ser alcanzable desde los MikroTik (IP/host público o de la
              VPN). Cambiar este enlace exige reconfigurar los routers.
            </span>
          </label>
        )}
      </section>

      {mode === 'internal' && (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
          <div>
            <p className="text-sm font-medium">Logo del portal</p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Dimensiones óptimas: <strong>{LOGO_OPTIMAL.label}</strong> (ancho
              × alto), PNG o WebP con fondo transparente. En pantalla se muestra
              hasta ~220×72 px (retina 2×). Máximo 1 MB. Si no subes uno, se usa
              el logo de Empresa.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-3">
              {previewLogo ? (
                <img
                  src={previewLogo}
                  alt="Logo portal"
                  className="max-h-16 max-w-full object-contain"
                />
              ) : (
                <span className="text-center text-[11px] text-[var(--text-muted)]">
                  Sin logo
                </span>
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                className="hidden"
                disabled={!canWrite}
                onChange={(e) => onLogoFile(e.target.files?.[0])}
              />
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-elevated)]"
                  >
                    Subir logo
                  </button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setMsg(null)
                        setLogoUrl('')
                        setLogoError(null)
                        if (fileRef.current) fileRef.current.value = ''
                      }}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                    >
                      Quitar (usar el de empresa)
                    </button>
                  )}
                </div>
              )}
              {!logoUrl && companyLogo && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Mostrando logo de Empresa hasta que subas uno del portal.
                </p>
              )}
              {logoError && (
                <p className="text-sm text-[var(--danger)]">{logoError}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {mode === 'external' ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="border-b border-[var(--border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Vista previa externa
          </div>
          <div className="bg-[#0a0a0a] p-2 sm:p-3">
            {externalUrl.trim() ? (
              <iframe
                title="Vista previa portal externo"
                src={externalUrl.trim()}
                className="h-[520px] w-full rounded-lg border-0 bg-white"
              />
            ) : (
              <div className="flex h-[280px] items-center justify-center text-sm text-[var(--text-muted)]">
                Pega un enlace para previsualizar
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
            <div className="border-b border-[var(--border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Vista previa
            </div>
            <div className="bg-[#0a0a0a] p-2 sm:p-3">
              {previewQuery.isLoading && (
                <div className="flex h-[520px] items-center justify-center text-sm text-[var(--text-muted)]">
                  Cargando vista previa…
                </div>
              )}
              {previewQuery.error && (
                <div className="flex h-[520px] items-center justify-center px-4 text-center text-sm text-[var(--danger)]">
                  {previewQuery.error.message}
                </div>
              )}
              {previewQuery.data?.html && (
                <iframe
                  title="Vista previa del portal de suspensión"
                  srcDoc={previewQuery.data.html}
                  className="h-[520px] w-full rounded-lg border-0 bg-white"
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Plantillas</p>
            {templatesQuery.isLoading && (
              <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
            )}
            <ul className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {templates.map((t) => {
                const active = t.id === activeId
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={!canWrite && !active}
                      onClick={() => {
                        setMsg(null)
                        setSelectedId(t.id)
                      }}
                      className={[
                        'w-full rounded-xl border px-3 py-3 text-left transition',
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-elevated)]',
                      ].join(' ')}
                    >
                      <span className="block text-sm font-semibold">
                        {t.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                        {t.description}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
