import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useNotify } from './NotifyProvider'
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from './OperationProgressModal'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

export type OltSpeedProfileRow = {
  name: string
  uploadProfile: string | null
  downloadProfile: string | null
  uploadMbps: number | null
  downloadMbps: number | null
  uploadKbps: number | null
  downloadKbps: number | null
}

type OltSpeedProfilesResponse = {
  deviceId: string
  probedAt: string
  profiles: OltSpeedProfileRow[]
}

type ModalMode = 'create' | 'edit'

export function OltSpeedProfilesPanel({
  deviceId,
  canWrite,
}: {
  deviceId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { confirm } = useNotify()
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [editing, setEditing] = useState<OltSpeedProfileRow | null>(null)
  const [name, setName] = useState('')
  const [downloadMbps, setDownloadMbps] = useState('100')
  const [uploadMbps, setUploadMbps] = useState('50')
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressTitle, setProgressTitle] = useState('Eliminar perfil')
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressFailed, setProgressFailed] = useState(false)
  const [progressDone, setProgressDone] = useState(false)
  const [progressRunners, setProgressRunners] = useState<
    Record<string, () => Promise<string | void>>
  >({})

  const query = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'speed-profiles'],
    queryFn: () =>
      apiFetch<OltSpeedProfilesResponse>(
        `/app/topology/devices/${deviceId}/speed-profiles`,
      ),
    retry: 1,
  })

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'devices', deviceId, 'speed-profiles'],
    })
    void queryClient.invalidateQueries({ queryKey: ['app', 'speed-profiles'] })
  }

  function openCreate() {
    setModal('create')
    setEditing(null)
    setName('')
    setDownloadMbps('100')
    setUploadMbps('50')
    setError(null)
  }

  function openEdit(p: OltSpeedProfileRow) {
    setModal('edit')
    setEditing(p)
    setName(p.name)
    setDownloadMbps(String(p.downloadMbps ?? 100))
    setUploadMbps(String(p.uploadMbps ?? 50))
    setError(null)
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
    setError(null)
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
      setMsg('Perfil eliminado de la OLT')
      invalidate()
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

  async function startDelete(p: OltSpeedProfileRow) {
    const ok = await confirm(`¿Eliminar el perfil ${p.name} de la OLT?`, {
      title: 'Eliminar perfil OLT',
      danger: true,
      confirmLabel: 'Eliminar',
    })
    if (!ok) return

    const steps: ProgressStep[] = [
      {
        id: 'remove',
        label: `Eliminar ${p.downloadProfile || `${p.name}-DOWN`} y ${p.uploadProfile || `${p.name}-UP`}`,
        status: 'pending',
      },
      { id: 'verify', label: 'Verificar en la OLT', status: 'pending' },
    ]
    const runners: Record<string, () => Promise<string | void>> = {
      remove: async () => {
        const res = await apiFetch<{ message?: string }>(
          `/app/topology/devices/${deviceId}/speed-profiles/${encodeURIComponent(p.name)}`,
          { method: 'DELETE' },
        )
        return res.message || 'Perfiles eliminados'
      },
      verify: async () => {
        const live = await apiFetch<OltSpeedProfilesResponse>(
          `/app/topology/devices/${deviceId}/speed-profiles`,
        )
        const still = (live.profiles ?? []).some(
          (x) => x.name.toLowerCase() === p.name.toLowerCase(),
        )
        if (still) throw new Error('El perfil sigue apareciendo en la OLT')
        return 'Confirmado: ya no está en la OLT'
      },
    }
    startProgress(`Eliminar ${p.name}`, steps, runners)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const down = Number(downloadMbps)
      const up = Number(uploadMbps)
      if (!name.trim()) throw new Error('Nombre requerido')
      if (!Number.isFinite(down) || down < 1 || !Number.isFinite(up) || up < 1) {
        throw new Error('Mbps inválidos')
      }
      return apiFetch<{ message?: string }>(`/app/topology/devices/${deviceId}/speed-profiles`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          downloadMbps: down,
          uploadMbps: up,
        }),
      })
    },
    onSuccess: (r: { message?: string }) => {
      setMsg(r.message ?? 'Perfil guardado en la OLT')
      closeModal()
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const profiles = query.data?.profiles ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--text-muted)]">
            Perfiles DBA de la OLT (tcont UP + traffic DOWN). Se leen y escriben
            en vivo.
          </p>
          {query.data?.probedAt && (
            <p className="mt-0.5 text-[var(--text-muted)] text-[11px]">
              Actualizado {new Date(query.data.probedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)] disabled:opacity-50"
          >
            {query.isFetching ? 'Leyendo…' : 'Refrescar'}
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Nuevo perfil
            </button>
          )}
        </div>
      </div>

      {msg && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {msg}
        </p>
      )}
      {query.error && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {query.error.message}
        </p>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Descarga</th>
              <th className="px-4 py-3 font-medium">Subida</th>
              <th className="px-4 py-3 font-medium">OLT</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-[var(--text-muted)]">
                  Leyendo perfiles de la OLT…
                </td>
              </tr>
            )}
            {!query.isLoading && profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-[var(--text-muted)]">
                  No hay perfiles (además de default).
                </td>
              </tr>
            )}
            {profiles.map((p) => (
              <tr key={p.name} className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">
                  <span className="inline-flex items-center gap-2">
                    {p.name}
                    {/^TLG-/i.test(p.name) && (
                      <span className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                        Sistema
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.downloadMbps != null ? `${p.downloadMbps} Mbps` : '—'}
                </td>
                <td className="px-4 py-3">
                  {p.uploadMbps != null ? `${p.uploadMbps} Mbps` : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                  {[p.downloadProfile, p.uploadProfile]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td className="px-4 py-3">
                  {canWrite && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={progressOpen}
                        onClick={() => void startDelete(p)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h3 className="text-lg font-semibold">
                {modal === 'create'
                  ? 'Nuevo perfil en la OLT'
                  : `Editar ${editing?.name}`}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={closeModal}
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm">
              <p className="text-xs text-[var(--text-muted)]">
                Se crean/actualizan{' '}
                <code className="text-[var(--accent)]">
                  {name.trim() || 'NOMBRE'}-DOWN
                </code>{' '}
                (traffic) y{' '}
                <code className="text-[var(--accent)]">
                  {name.trim() || 'NOMBRE'}-UP
                </code>{' '}
                (tcont).
              </p>
              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre
                </span>
                <input
                  className={inputClass}
                  value={name}
                  disabled={modal === 'edit'}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej. 100M"
                />
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
                    value={downloadMbps}
                    onChange={(e) => setDownloadMbps(e.target.value)}
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
                    value={uploadMbps}
                    onChange={(e) => setUploadMbps(e.target.value)}
                  />
                </label>
              </div>
              {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Aplicando…' : 'Guardar en OLT'}
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}

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
          setProgressOpen(false)
          invalidate()
        }}
      />
    </div>
  )
}
