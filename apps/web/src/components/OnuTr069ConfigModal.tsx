import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type {
  ApplyTr069OnuConfigBody,
  ApplyTr069OnuConfigResponse,
  Tr069OnuConfig,
} from '../lib/onu-tr069-config'
import type { TenantModuleCard } from '../lib/modules'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

type Tab = 'wifi' | 'users' | 'ethernet' | 'info'

export function OnuTr069ConfigModal({
  onuId,
  canWrite,
  onClose,
}: {
  onuId: string
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('wifi')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoRefreshDone = useRef(false)

  const [wifiDraft, setWifiDraft] = useState<
    Record<number, { ssid: string; key: string; enabled: boolean }>
  >({})
  const [ethDraft, setEthDraft] = useState<Record<number, boolean>>({})
  const [userDraft, setUserDraft] = useState<
    Record<number, { username: string; password: string }>
  >({})

  const configQuery = useQuery({
    queryKey: ['app', 'onus', onuId, 'tr069-config'],
    queryFn: () =>
      apiFetch<Tr069OnuConfig>(`/app/onus/${onuId}/tr069-config`),
  })
  const modulesQuery = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
    staleTime: 60_000,
  })

  useEffect(() => {
    const c = configQuery.data
    if (!c) return
    const w: typeof wifiDraft = {}
    for (const r of c.wifi) {
      w[r.index] = {
        ssid: r.ssid ?? '',
        key: r.key ?? '',
        enabled: r.enabled ?? true,
      }
    }
    setWifiDraft(w)
    const e: typeof ethDraft = {}
    for (const p of c.ethernet) {
      e[p.index] = p.enabled ?? true
    }
    setEthDraft(e)
    const u: typeof userDraft = {}
    for (const usr of c.webUsers) {
      u[usr.index] = {
        username: usr.username ?? '',
        password: '',
      }
    }
    setUserDraft(u)
  }, [configQuery.data])

  const applyMutation = useMutation({
    mutationFn: (body: ApplyTr069OnuConfigBody) =>
      apiFetch<ApplyTr069OnuConfigResponse>(
        `/app/onus/${onuId}/tr069-config`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: (r) => {
      setMsg(r.message)
      setError(null)
      void queryClient.setQueryData(
        ['app', 'onus', onuId, 'tr069-config'],
        r.config,
      )
      void queryClient.invalidateQueries({
        queryKey: ['app', 'onus', onuId, 'tr069-config'],
      })
    },
    onError: (e: Error) => {
      setError(e.message)
      setMsg(null)
    },
  })

  // First Inform often only has DeviceInfo — pull LAN/WiFi tree on open.
  useEffect(() => {
    const c = configQuery.data
    if (!c?.inAcs || autoRefreshDone.current) return
    if (c.wifi.length > 0 || c.ethernet.length > 0 || c.webUsers.length > 0) {
      return
    }
    autoRefreshDone.current = true
    setMsg('Solicitando Wi‑Fi / Ethernet al ACS…')
    void applyMutation.mutateAsync({ refresh: true })
    // mutateAsync identity is stable enough; only react to first empty config
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on open
  }, [configQuery.data])

  function buildPatch(): ApplyTr069OnuConfigBody {
    const c = configQuery.data
    if (!c) return {}
    const wifi: NonNullable<ApplyTr069OnuConfigBody['wifi']> = []
    for (const r of c.wifi) {
      const d = wifiDraft[r.index]
      if (!d) continue
      const patch: (typeof wifi)[number] = { index: r.index }
      let changed = false
      if (d.ssid !== (r.ssid ?? '')) {
        patch.ssid = d.ssid
        changed = true
      }
      if (d.key && d.key !== (r.key ?? '')) {
        patch.key = d.key
        changed = true
      }
      if (d.enabled !== (r.enabled ?? true)) {
        patch.enabled = d.enabled
        changed = true
      }
      if (changed) wifi.push(patch)
    }
    const ethernet: NonNullable<ApplyTr069OnuConfigBody['ethernet']> = []
    for (const p of c.ethernet) {
      const enabled = ethDraft[p.index]
      if (enabled == null) continue
      if (enabled !== (p.enabled ?? true)) {
        ethernet.push({ index: p.index, enabled })
      }
    }
    const webUsers: NonNullable<ApplyTr069OnuConfigBody['webUsers']> = []
    for (const u of c.webUsers) {
      const d = userDraft[u.index]
      if (!d) continue
      const patch: (typeof webUsers)[number] = { index: u.index }
      let changed = false
      if (d.username && d.username !== (u.username ?? '')) {
        patch.username = d.username
        changed = true
      }
      if (d.password) {
        patch.password = d.password
        changed = true
      }
      if (changed) webUsers.push(patch)
    }
    return { wifi, ethernet, webUsers }
  }

  const c = configQuery.data
  const onuUnlockEnabled = !!modulesQuery.data?.find(
    (m) => m.id === 'onu_unlock',
  )?.contracted
  const tabs: { id: Tab; label: string }[] = [
    { id: 'wifi', label: 'Wi‑Fi' },
    ...(onuUnlockEnabled
      ? ([{ id: 'users', label: 'Usuario web' }] as const)
      : []),
    { id: 'ethernet', label: 'Ethernet' },
    { id: 'info', label: 'Info ACS' },
  ]

  useEffect(() => {
    if (!onuUnlockEnabled && tab === 'users') {
      setTab('wifi')
    }
  }, [onuUnlockEnabled, tab])

  return (
    <ModalPortal><div className="fixed inset-0 z-[60] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">Configurar ONU (TR069)</h3>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {c?.mgmtIp ? (
                <>
                  Mgmt IP{' '}
                  <span className="font-mono text-[var(--text)]">{c.mgmtIp}</span>
                  {c.inAcs ? (
                    <span className="ml-2 text-emerald-400">· En ACS</span>
                  ) : (
                    <span className="ml-2 text-amber-400">· Sin Inform</span>
                  )}
                </>
              ) : (
                'Sin Mgmt IP'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm"
          >
            Cerrar
          </button>
        </div>

        <nav className="flex gap-4 border-b border-[var(--border)] px-5 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                '-mb-px border-b-2 pb-2 text-sm font-medium',
                tab === t.id
                  ? 'border-[var(--accent)] text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)]',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {configQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">
              Consultando GenieACS…
            </p>
          )}
          {c?.message && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {c.message}
            </p>
          )}
          {error && (
            <p className="mb-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          {msg && (
            <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {msg}
            </p>
          )}

          {c && tab === 'info' && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">SN</dt>
                <dd className="font-mono">{c.sn ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">ACS device ID</dt>
                <dd className="break-all font-mono text-xs">
                  {c.acsDeviceId ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Modelo</dt>
                <dd>{c.model ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Fabricante</dt>
                <dd>{c.manufacturer ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Software</dt>
                <dd>{c.softwareVersion ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Data model</dt>
                <dd>{c.dataModel}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--text-muted)]">Último Inform</dt>
                <dd className="font-mono text-xs">{c.lastInform ?? '—'}</dd>
              </div>
            </dl>
          )}

          {c && tab === 'wifi' && (
            <div className="space-y-4">
              {c.wifi.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Sin radios Wi‑Fi en el árbol TR069 (o aún no refresçado).
                </p>
              ) : (
                c.wifi.map((r) => {
                  const d = wifiDraft[r.index] ?? {
                    ssid: '',
                    key: '',
                    enabled: true,
                  }
                  return (
                    <div
                      key={r.index}
                      className="rounded-lg border border-[var(--border)] p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium">
                          WLAN {r.index}
                          {r.standard ? (
                            <span className="ml-2 text-xs text-[var(--text-muted)]">
                              {r.standard}
                            </span>
                          ) : null}
                        </p>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={d.enabled}
                            disabled={!canWrite || !c.inAcs}
                            onChange={(e) =>
                              setWifiDraft((prev) => ({
                                ...prev,
                                [r.index]: {
                                  ...d,
                                  enabled: e.target.checked,
                                },
                              }))
                            }
                          />
                          Activo
                        </label>
                      </div>
                      <label className="mb-2 block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          SSID
                        </span>
                        <input
                          className={inputClass}
                          value={d.ssid}
                          disabled={!canWrite || !c.inAcs}
                          onChange={(e) =>
                            setWifiDraft((prev) => ({
                              ...prev,
                              [r.index]: { ...d, ssid: e.target.value },
                            }))
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Contraseña Wi‑Fi
                        </span>
                        <input
                          className={inputClass}
                          type="text"
                          placeholder={
                            r.key ? '(dejar vacío para no cambiar)' : ''
                          }
                          value={d.key}
                          disabled={!canWrite || !c.inAcs || !r.keyPath}
                          onChange={(e) =>
                            setWifiDraft((prev) => ({
                              ...prev,
                              [r.index]: { ...d, key: e.target.value },
                            }))
                          }
                        />
                      </label>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {c && tab === 'users' && (
            <div className="space-y-4">
              {c.webUsers.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Sin usuarios web detectados en el data model.
                </p>
              ) : (
                c.webUsers.map((u) => {
                  const d = userDraft[u.index] ?? {
                    username: '',
                    password: '',
                  }
                  return (
                    <div
                      key={u.index}
                      className="rounded-lg border border-[var(--border)] p-3"
                    >
                      <p className="mb-2 text-sm font-medium">
                        Usuario {u.index}
                      </p>
                      <label className="mb-2 block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Usuario
                        </span>
                        <input
                          className={inputClass}
                          value={d.username}
                          disabled={!canWrite || !c.inAcs}
                          onChange={(e) =>
                            setUserDraft((prev) => ({
                              ...prev,
                              [u.index]: {
                                ...d,
                                username: e.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          Nueva contraseña
                        </span>
                        <input
                          className={inputClass}
                          type="password"
                          placeholder="(vacío = no cambiar)"
                          value={d.password}
                          disabled={!canWrite || !c.inAcs}
                          onChange={(e) =>
                            setUserDraft((prev) => ({
                              ...prev,
                              [u.index]: {
                                ...d,
                                password: e.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {c && tab === 'ethernet' && (
            <div className="space-y-2">
              {c.ethernet.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Sin puertos Ethernet en el árbol TR069.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)]">
                      <th className="py-1 font-medium">Puerto</th>
                      <th className="py-1 font-medium">Estado</th>
                      <th className="py-1 font-medium">MAC</th>
                      <th className="py-1 font-medium">Activo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.ethernet.map((p) => (
                      <tr
                        key={p.index}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="py-2">{p.name ?? `ETH${p.index}`}</td>
                        <td className="py-2 text-[var(--text-muted)]">
                          {p.status ?? '—'}
                        </td>
                        <td className="py-2 font-mono text-xs">
                          {p.mac ?? '—'}
                        </td>
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={ethDraft[p.index] ?? true}
                            disabled={
                              !canWrite || !c.inAcs || !p.enablePath
                            }
                            onChange={(e) =>
                              setEthDraft((prev) => ({
                                ...prev,
                                [p.index]: e.target.checked,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            disabled={
              !canWrite || applyMutation.isPending || !c?.inAcs
            }
            onClick={() => {
              setError(null)
              void applyMutation.mutateAsync({ refresh: true })
            }}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
          >
            Refrescar desde ONU
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={
                !canWrite || applyMutation.isPending || !c?.inAcs
              }
              onClick={() => {
                setError(null)
                const body = buildPatch()
                if (
                  !(body.wifi?.length ||
                    body.ethernet?.length ||
                    body.webUsers?.length)
                ) {
                  setError('No hay cambios para guardar')
                  return
                }
                void applyMutation.mutateAsync(body)
              }}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {applyMutation.isPending ? 'Aplicando…' : 'Aplicar vía TR069'}
            </button>
          </div>
        </div>
      </div>
    </div></ModalPortal>
  )
}
