import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { SpeedProfile } from '../lib/speed-profiles'
import type { TopologyGraph } from '../lib/topology'
import { useNotify } from './NotifyProvider'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import { ModalPortal } from './ModalPortal'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from './MobileList'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

type FormState = {
  name: string
  downloadMbps: string
  uploadMbps: string
  description: string
  isActive: boolean
}

const empty: FormState = {
  name: '',
  downloadMbps: '100',
  uploadMbps: '50',
  description: '',
  isActive: true,
}

function SpeedProfileFormModal({
  open,
  onClose,
  profile,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  profile?: SpeedProfile | null
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [form, setForm] = useState<FormState>(empty)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [syncModal, setSyncModal] = useState<{
    olt: { id: string; name: string }
    steps: ProgressStep[]
    running: boolean
    failed: boolean
    allDone: boolean
  } | null>(null)
  const editing = !!profile

  const detailQuery = useQuery({
    queryKey: ['app', 'speed-profiles', profile?.id],
    queryFn: () =>
      apiFetch<SpeedProfile>(`/app/speed-profiles/${profile!.id}`),
    enabled: open && !!profile?.id,
  })

  const topologyQuery = useQuery({
    queryKey: ['app', 'topology'],
    queryFn: () => apiFetch<TopologyGraph>('/app/topology'),
    enabled: open,
  })

  const current = detailQuery.data ?? profile
  const assignedIds = new Set(current?.oltIds ?? [])

  const olts = useMemo(() => {
    return (topologyQuery.data?.devices ?? []).filter((d) => d.type === 'olt')
  }, [topologyQuery.data?.devices])

  const checkingOlts =
    !!busy ||
    (editing &&
      detailQuery.isFetching &&
      (current?.oltIds?.length ?? 0) > 0)

  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(null)
    if (profile) {
      setForm({
        name: profile.name,
        downloadMbps: String(profile.downloadMbps),
        uploadMbps: String(profile.uploadMbps),
        description: profile.description ?? '',
        isActive: profile.isActive,
      })
    } else {
      setForm(empty)
    }
  }, [open, profile])

  function invalidateList() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'speed-profiles'],
      exact: true,
    })
  }

  function mergeProfileDetail(updated: SpeedProfile) {
    if (!profile?.id) return
    queryClient.setQueryData<SpeedProfile>(
      ['app', 'speed-profiles', profile.id],
      (prev) => {
        if (!prev) return updated
        const prevById = new Map((prev.olts ?? []).map((o) => [o.id, o]))
        const oltsMerged = (updated.olts ?? []).map((o) => {
          const old = prevById.get(o.id)
          // Keep previous known presence when this response didn't probe that OLT
          if (o.present == null && old && old.present != null) {
            return {
              ...o,
              present: old.present,
              error: old.error,
              needsSync: old.present !== true,
            }
          }
          return o
        })
        return { ...updated, olts: oltsMerged }
      },
    )
    invalidateList()
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        downloadMbps: Number(form.downloadMbps),
        uploadMbps: Number(form.uploadMbps),
        description: form.description.trim(),
        isActive: form.isActive,
      }
      if (editing && profile) {
        return apiFetch<SpeedProfile>(`/app/speed-profiles/${profile.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      }
      return apiFetch<SpeedProfile>('/app/speed-profiles', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      invalidateList()
      if (profile?.id) {
        void queryClient.invalidateQueries({
          queryKey: ['app', 'speed-profiles', profile.id],
        })
      }
      if (!editing) onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  async function assignOlt(oltId: string) {
    if (!profile) return
    const oltName =
      olts.find((o) => o.id === oltId)?.name ?? 'la OLT'
    setError(null)
    setBusy(`Añadiendo ${oltName} y comprobando perfil…`)
    try {
      const updated = await apiFetch<SpeedProfile>(
        `/app/speed-profiles/${profile.id}/assign-olt`,
        {
          method: 'POST',
          body: JSON.stringify({ oltId }),
        },
      )
      mergeProfileDetail(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function unassignOlt(oltId: string, oltName: string) {
    if (!profile) return
    const ok = await confirm(`¿Quitar ${oltName} de este perfil?`, {
      title: 'Quitar OLT',
      confirmLabel: 'Quitar',
    })
    if (!ok) return
    setError(null)
    setBusy(`Quitando ${oltName}…`)
    try {
      const updated = await apiFetch<SpeedProfile>(
        `/app/speed-profiles/${profile.id}/unassign-olt`,
        {
          method: 'POST',
          body: JSON.stringify({ oltId }),
        },
      )
      mergeProfileDetail(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function runSync(oltId: string, steps: ProgressStep[]) {
    if (!profile) return
    setSyncModal((m) => (m ? { ...m, running: true, failed: false } : m))
    const result = await runProgressSteps(
      steps,
      (next) => setSyncModal((m) => (m ? { ...m, steps: next } : m)),
      {
        apply: async () => {
          const res = await apiFetch<SpeedProfile>(
            `/app/speed-profiles/${profile.id}/sync-olt`,
            { method: 'POST', body: JSON.stringify({ oltId }) },
          )
          mergeProfileDetail(res)
          const st = (res.olts ?? []).find((o) => o.id === oltId)
          if (st?.present === true) {
            return res.syncMessage || 'Perfiles aplicados y verificados'
          }
          return res.syncMessage || 'Perfiles aplicados'
        },
        verify: async () => {
          const cached = queryClient.getQueryData<SpeedProfile>([
            'app',
            'speed-profiles',
            profile.id,
          ])
          const st = (cached?.olts ?? []).find((o) => o.id === oltId)
          if (st?.present === true) return `Sincronizado en ${st.name}`
          // Re-check only this OLT
          const fresh = await apiFetch<SpeedProfile>(
            `/app/speed-profiles/${profile.id}?onlyOltId=${encodeURIComponent(oltId)}`,
          )
          mergeProfileDetail(fresh)
          const again = (fresh.olts ?? []).find((o) => o.id === oltId)
          if (!again) throw new Error('La OLT no está asignada al perfil')
          if (again.error) throw new Error(again.error)
          if (again.present !== true)
            throw new Error('El perfil no aparece en la OLT')
          return `Sincronizado en ${again.name}`
        },
      },
    )
    setSyncModal((m) =>
      m
        ? {
            ...m,
            steps: result.steps,
            running: false,
            failed: !result.ok,
            allDone: result.ok,
          }
        : m,
    )
    invalidateList()
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'devices', oltId, 'speed-profiles'],
    })
  }

  function syncOlt(oltId: string, oltName: string) {
    setError(null)
    const steps: ProgressStep[] = [
      {
        id: 'apply',
        label: `Crear ${oltBaseName}-UP y ${oltBaseName}-DOWN en la OLT`,
        status: 'pending',
      },
      { id: 'verify', label: 'Verificar perfiles en la OLT', status: 'pending' },
    ]
    setSyncModal({
      olt: { id: oltId, name: oltName },
      steps,
      running: true,
      failed: false,
      allDone: false,
    })
    void runSync(oltId, steps)
  }

  if (!open) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Nombre requerido')
      return
    }
    saveMutation.mutate()
  }

  const oltStatus = current?.olts ?? []

  // Preview del nombre con que se crea en la OLT (prefijo de sistema TLG-)
  const oltBaseName =
    current?.oltProfileName ||
    (() => {
      const clean = form.name
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-(UP|DOWN)$/i, '')
        .replace(/^TLG-/i, '')
      return `TLG-${clean || 'NOMBRE'}`.slice(0, 26).replace(/-+$/, '')
    })()

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div className="relative h-[100dvh] max-h-[100dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl">
        {checkingOlts && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 p-6 backdrop-blur-[1px]">
            <span
              className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
              aria-hidden
            />
            <p className="text-center text-sm font-medium">
              {busy ?? 'Consultando estado en las OLTs…'}
            </p>
            <p className="text-center text-xs text-[var(--text-muted)]">
              Puede tardar unos segundos por cada OLT
            </p>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h3 className="text-lg font-semibold">
            {editing ? 'Perfil del sistema' : 'Nuevo perfil de velocidad'}
          </h3>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4 text-sm">
          <label className="block">
            <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
            <input
              className={inputClass}
              value={form.name}
              disabled={editing}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ej. ISPCTRL-100M"
              required
            />
            <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
              En la OLT se crean {oltBaseName}-UP y {oltBaseName}-DOWN
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[var(--text-muted)]">
                Descarga (Mbps)
              </span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.downloadMbps}
                onChange={(e) =>
                  setForm((f) => ({ ...f, downloadMbps: e.target.value }))
                }
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[var(--text-muted)]">
                Subida (Mbps)
              </span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.uploadMbps}
                onChange={(e) =>
                  setForm((f) => ({ ...f, uploadMbps: e.target.value }))
                }
                required
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[var(--text-muted)]">
              Descripción
            </span>
            <input
              className={inputClass}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm((f) => ({ ...f, isActive: e.target.checked }))
              }
            />
            Activo
          </label>

          {editing && (
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <p className="font-medium">OLTs asignadas</p>
              <p className="text-xs text-[var(--text-muted)]">
                Solo perfiles del sistema. Si la OLT no lo tiene, sincroniza.
              </p>
              {detailQuery.isFetching && !busy && (
                <p className="text-xs text-[var(--text-muted)]">
                  Verificando OLTs…
                </p>
              )}
              <ul className="space-y-2">
                {oltStatus.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">{o.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {o.present === true
                          ? 'Sincronizado en la OLT'
                          : o.present === false
                            ? 'No está en la OLT'
                            : o.error
                              ? `Error: ${o.error}`
                              : 'Pendiente de verificar'}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {canWrite && o.needsSync && (
                        <button
                          type="button"
                          disabled={!!syncModal || !!busy}
                          onClick={() => syncOlt(o.id, o.name)}
                          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          Sincronizar
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void unassignOlt(o.id, o.name)}
                          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {oltStatus.length === 0 && (
                  <li className="text-xs text-[var(--text-muted)]">
                    Ninguna OLT asignada todavía.
                  </li>
                )}
              </ul>
              {canWrite && (
                <label className="block">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Añadir OLT
                  </span>
                  <select
                    className={inputClass}
                    defaultValue=""
                    disabled={!!busy}
                    onChange={(e) => {
                      const id = e.target.value
                      e.target.value = ''
                      if (id) void assignOlt(id)
                    }}
                  >
                    <option value="">
                      {busy ? 'Trabajando…' : 'Seleccionar OLT…'}
                    </option>
                    {olts
                      .filter((o) => !assignedIds.has(o.id))
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2"
            >
              Cerrar
            </button>
            {canWrite && (
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 font-medium text-white disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            )}
          </div>
        </form>
      </div>

      <OperationProgressModal
        open={!!syncModal}
        title={`Sincronizar con ${syncModal?.olt.name ?? 'la OLT'}`}
        steps={syncModal?.steps ?? []}
        running={syncModal?.running ?? false}
        failed={syncModal?.failed ?? false}
        allDone={syncModal?.allDone ?? false}
        onRetry={
          syncModal
            ? () => void runSync(syncModal.olt.id, syncModal.steps)
            : undefined
        }
        onClose={() => setSyncModal(null)}
      />
    </div></ModalPortal>
  )
}

export function SpeedProfilesSettingsTab({ canWrite }: { canWrite: boolean }) {
  const { confirm } = useNotify()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [edit, setEdit] = useState<SpeedProfile | null>(null)
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressTitle, setProgressTitle] = useState('Eliminar perfil')
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const [progressRunners, setProgressRunners] = useState<
    Record<string, () => Promise<string | void>>
  >({})
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'speed-profiles'],
    queryFn: () => apiFetch<SpeedProfile[]>('/app/speed-profiles'),
  })

  function invalidateAll(oltIds: string[] = []) {
    void queryClient.invalidateQueries({ queryKey: ['app', 'speed-profiles'] })
    for (const oltId of oltIds) {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'topology', 'devices', oltId, 'speed-profiles'],
      })
    }
  }

  async function executeProgress(
    steps: ProgressStep[],
    runners: Record<string, () => Promise<string | void>>,
  ) {
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    const result = await runProgressSteps(steps, setProgressSteps, runners)
    setProgressRunning(false)
    if (result.ok) {
      setProgressDone(true)
      setProgressFailed(false)
    } else {
      setProgressFailed(true)
      setProgressDone(false)
    }
  }

  function startProgress(
    title: string,
    steps: ProgressStep[],
    runners: Record<string, () => Promise<string | void>>,
  ) {
    setProgressTitle(title)
    setProgressSteps(steps)
    setProgressRunners(runners)
    setProgressOpen(true)
    setProgressRunning(true)
    setProgressFailed(false)
    setProgressDone(false)
    void executeProgress(steps, runners)
  }

  async function startDelete(p: SpeedProfile) {
    const proceed = await confirm(
      `¿Eliminar el perfil ${p.name} del sistema?`,
      {
        title: 'Eliminar perfil',
        danger: true,
        confirmLabel: 'Continuar',
        cancelLabel: 'Cancelar',
      },
    )
    if (!proceed) return

    const assigned = p.olts ?? []
    // Prefer OLTs that already have the profile; if status unknown, still offer all assigned
    const onOlts =
      assigned.filter((o) => o.present === true).length > 0
        ? assigned.filter((o) => o.present === true)
        : assigned
    let fromOlts = false
    if (onOlts.length > 0) {
      fromOlts = await confirm(
        `¿Eliminar también de las OLTs que lo tengan?\n\n${onOlts
          .map((o) => `• ${o.name}`)
          .join('\n')}`,
        {
          title: 'Eliminar de las OLTs',
          danger: true,
          confirmLabel: 'Sí',
          cancelLabel: 'No',
        },
      )
    }

    const oltName =
      p.oltProfileName || `TLG-${p.name}`.replace(/^TLG-TLG-/i, 'TLG-')
    const oltTargets = fromOlts ? onOlts : []
    const steps: ProgressStep[] = []
    const runners: Record<string, () => Promise<string | void>> = {}

    for (const olt of oltTargets) {
      const stepId = `olt-${olt.id}`
      steps.push({
        id: stepId,
        label: `Eliminar ${oltName} de ${olt.name}`,
        status: 'pending',
      })
      runners[stepId] = async () => {
        const res = await apiFetch<{ message?: string }>(
          `/app/topology/devices/${olt.id}/speed-profiles/${encodeURIComponent(oltName)}`,
          { method: 'DELETE' },
        )
        return res.message || `Eliminado de ${olt.name}`
      }
    }

    steps.push({
      id: 'catalog',
      label: 'Eliminar del catálogo del sistema',
      status: 'pending',
    })
    runners.catalog = async () => {
      await apiFetch(`/app/speed-profiles/${p.id}`, { method: 'DELETE' })
      return 'Eliminado del catálogo'
    }

    setDeletingId(p.id)
    startProgress(`Eliminar ${p.name}`, steps, runners)
  }

  const profiles = query.data ?? []

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Catálogo del sistema. Asigna OLTs y sincroniza solo los que falten —
          no se listan perfiles locales de cada OLT.
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Nuevo perfil
          </button>
        )}
      </div>

      {query.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <MobileList>
        {query.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!query.isLoading && profiles.length === 0 && (
          <MobileListEmpty>
            No hay perfiles del sistema todavía.
          </MobileListEmpty>
        )}
        {profiles.map((p) => {
          const olts = p.olts ?? []
          const known = olts.filter((o) => o.present != null)
          const pending = known.filter((o) => o.needsSync).length
          const ok = known.filter((o) => o.present === true).length
          return (
            <MobileListCard key={p.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                {p.oltProfileName ? (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    OLT: {p.oltProfileName}
                  </p>
                ) : null}
                {p.description ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    {p.description}
                  </p>
                ) : null}
              </div>
              <MobileListMeta>
                <span>
                  ↓{p.downloadMbps} / ↑{p.uploadMbps} Mbps
                </span>
                <span>·</span>
                <span>
                  {olts.length === 0
                    ? 'Sin OLTs'
                    : known.length === 0
                      ? `${olts.length} OLT(s)`
                      : `${ok}/${olts.length} sync${pending > 0 ? ` (${pending} pend.)` : ''}`}
                </span>
                <span>·</span>
                <span>{p.isActive ? 'Activo' : 'Inactivo'}</span>
              </MobileListMeta>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setEdit(p)}
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {canWrite ? 'Editar / OLTs' : 'Ver'}
                </button>
                {canWrite && (
                  <button
                    type="button"
                    disabled={progressOpen}
                    onClick={() => void startDelete(p)}
                    className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </MobileListCard>
          )
        })}
      </MobileList>

      <DesktopTableWrap>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Velocidad</th>
              <th className="px-4 py-3 font-medium">OLTs</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!query.isLoading && profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-[var(--text-muted)]">
                  No hay perfiles del sistema todavía.
                </td>
              </tr>
            )}
            {profiles.map((p) => {
              const olts = p.olts ?? []
              const known = olts.filter((o) => o.present != null)
              const pending = known.filter((o) => o.needsSync).length
              const ok = known.filter((o) => o.present === true).length
              return (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.name}</div>
                    {p.oltProfileName ? (
                      <div className="text-[11px] text-[var(--text-muted)]">
                        OLT: {p.oltProfileName}
                      </div>
                    ) : null}
                    {p.description ? (
                      <div className="text-xs text-[var(--text-muted)]">
                        {p.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    ↓{p.downloadMbps} / ↑{p.uploadMbps} Mbps
                  </td>
                  <td className="px-4 py-3">
                    {olts.length === 0 ? (
                      <span className="text-[var(--text-muted)]">—</span>
                    ) : known.length === 0 ? (
                      <span>{olts.length} OLT(s)</span>
                    ) : (
                      <span>
                        {ok}/{olts.length} sync
                        {pending > 0 ? (
                          <span className="ml-1 text-amber-300">
                            ({pending} pend.)
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.isActive ? 'Activo' : 'Inactivo'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEdit(p)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        {canWrite ? 'Editar / OLTs' : 'Ver'}
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          disabled={progressOpen}
                          onClick={() => void startDelete(p)}
                          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DesktopTableWrap>

      <SpeedProfileFormModal
        open={createOpen}
        canWrite={canWrite}
        onClose={() => setCreateOpen(false)}
      />
      <SpeedProfileFormModal
        open={!!edit}
        profile={edit}
        canWrite={canWrite}
        onClose={() => setEdit(null)}
      />

      <OperationProgressModal
        open={progressOpen}
        title={progressTitle}
        steps={progressSteps}
        running={progressRunning}
        failed={progressFailed}
        allDone={progressDone}
        onRetry={() => void executeProgress(progressSteps, progressRunners)}
        onClose={() => {
          if (progressRunning) return
          const id = deletingId
          setProgressOpen(false)
          setDeletingId(null)
          invalidateAll()
          if (progressDone && id) {
            setEdit((e) => (e?.id === id ? null : e))
          }
        }}
      />
    </div>
  )
}
