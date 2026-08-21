import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OnuTypesResponse } from '../lib/onu-settings'
import {
  deleteFirmwareImage,
  firmwareTargets,
  formatFileSize,
  listFirmwareImages,
  upgradeFirmware,
  uploadFirmwareImage,
  type FirmwareImage,
  type FirmwareTarget,
} from '../lib/onu-firmware'
import { useNotify } from './NotifyProvider'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from './MobileList'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'
const btnPrimary =
  'rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60'
const btnGhost =
  'rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-60'

export function OnuFirmwarePanel({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient()
  const { confirm } = useNotify()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [version, setVersion] = useState('')
  const [note, setNote] = useState('')

  const imagesQuery = useQuery({
    queryKey: ['app', 'onus', 'firmware'],
    queryFn: listFirmwareImages,
  })
  const typesQuery = useQuery({
    queryKey: ['app', 'settings', 'onus', 'types'],
    queryFn: () => apiFetch<OnuTypesResponse>('/app/settings/onus/types'),
  })
  const targetsQuery = useQuery({
    queryKey: ['app', 'onus', 'firmware', selectedId, 'targets'],
    queryFn: () => firmwareTargets(selectedId!),
    enabled: Boolean(selectedId),
  })

  const images = imagesQuery.data?.images ?? []
  const types = typesQuery.data?.types ?? []
  const selected = images.find((i) => i.id === selectedId) ?? null
  const targets = targetsQuery.data?.targets ?? []
  const modelOptions = useMemo(() => {
    const names = types.map((t) => t.name).filter(Boolean)
    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }, [types])

  const uploadMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Selecciona un archivo')
      if (!modelKey.trim()) throw new Error('Selecciona un modelo')
      if (!version.trim()) throw new Error('Indica la versión')
      return uploadFirmwareImage({
        file,
        modelKey: modelKey.trim(),
        version: version.trim(),
        note: note.trim() || undefined,
      })
    },
    onSuccess: (r) => {
      setErr(null)
      setMsg(r.acsWarning ?? `Imagen ${r.image.fileName} guardada`)
      setFile(null)
      setVersion('')
      setNote('')
      setSelectedId(r.image.id)
      void qc.invalidateQueries({ queryKey: ['app', 'onus', 'firmware'] })
    },
    onError: (e: Error) => {
      setMsg(null)
      setErr(e.message)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFirmwareImage(id),
    onSuccess: () => {
      setErr(null)
      setMsg('Imagen eliminada')
      setSelectedId(null)
      void qc.invalidateQueries({ queryKey: ['app', 'onus', 'firmware'] })
    },
    onError: (e: Error) => {
      setMsg(null)
      setErr(e.message)
    },
  })

  const upgradeMut = useMutation({
    mutationFn: (body: { onuId?: string; allOnlineOfModel?: boolean }) => {
      if (!selectedId) throw new Error('Elige una imagen')
      return upgradeFirmware(selectedId, body)
    },
    onSuccess: (r) => {
      setErr(null)
      setMsg(
        r.failed
          ? `Encoladas ${r.queued}; fallidas ${r.failed}`
          : r.queued === 1
            ? r.results[0]?.message ?? 'Tarea encolada'
            : `${r.queued} tarea(s) Download encoladas`,
      )
      void qc.invalidateQueries({
        queryKey: ['app', 'onus', 'firmware', selectedId, 'targets'],
      })
    },
    onError: (e: Error) => {
      setMsg(null)
      setErr(e.message)
    },
  })

  function askUpgradeOne(t: FirmwareTarget) {
    void confirm(
      `¿Actualizar firmware de ${t.sn ?? t.onuId} a ${selected?.version}? La ONU descargará la imagen por TR-069.`,
      {
        title: 'Actualizar firmware',
        confirmLabel: 'Actualizar',
      },
    ).then((ok) => {
      if (ok) upgradeMut.mutate({ onuId: t.onuId })
    })
  }

  function askUpgradeOnline() {
    const n = targets.filter((t) => t.canUpgrade).length
    void confirm(
      `¿Actualizar las ${n} ONU(s) online de ${selected?.modelKey} a ${selected?.version}? Solo se encola Download en ACS; no hay upgrade automático.`,
      {
        title: 'Actualizar las online de este modelo',
        confirmLabel: 'Actualizar online',
        danger: true,
      },
    ).then((ok) => {
      if (ok) upgradeMut.mutate({ allOnlineOfModel: true })
    })
  }

  function askDelete(img: FirmwareImage) {
    void confirm(
      `¿Eliminar la imagen ${img.fileName} (${img.modelKey} ${img.version})?`,
      {
        title: 'Eliminar imagen',
        confirmLabel: 'Eliminar',
        danger: true,
      },
    ).then((ok) => {
      if (ok) deleteMut.mutate(img.id)
    })
  }

  const loading = imagesQuery.isLoading
  const busy = uploadMut.isPending || upgradeMut.isPending || deleteMut.isPending

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-muted)]">
        Inventario opcional: subes el archivo, lo asocias a un modelo y pulsas{' '}
        <strong>Actualizar</strong>. No hay job automático ni firmware aprobado
        obligatorio. Solo HGUs ACS (Download TR-069).
      </p>

      {msg && (
        <p className="text-sm text-emerald-500">{msg}</p>
      )}
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}

      {canWrite && (
        <form
          className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault()
            uploadMut.mutate()
          }}
        >
          <label className="text-xs text-[var(--text-muted)] sm:col-span-2">
            Archivo
            <input
              type="file"
              className={`${inputClass} mt-1`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)]">
            Modelo
            <select
              className={`${inputClass} mt-1`}
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
            >
              <option value="">Elegir tipo…</option>
              {modelOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)]">
            Versión
            <input
              className={`${inputClass} mt-1`}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="p. ej. V3.0.0"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] sm:col-span-2 lg:col-span-3">
            Nota (opcional)
            <input
              className={`${inputClass} mt-1`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy || !file || !modelKey || !version.trim()}
              className={btnPrimary}
            >
              {uploadMut.isPending ? 'Subiendo…' : 'Subir imagen'}
            </button>
          </div>
        </form>
      )}

      <MobileList>
        {loading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {!loading && images.length === 0 && (
          <MobileListEmpty>
            No hay imágenes. Sube un firmware y asócialo a un modelo.
          </MobileListEmpty>
        )}
        {images.map((img) => {
          const active = img.id === selectedId
          return (
            <MobileListCard
              key={img.id}
              className={`cursor-pointer ${
                active ? 'ring-1 ring-[var(--accent)]' : ''
              }`}
              onClick={() => setSelectedId(img.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {img.modelKey}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--text-muted)]">
                    {img.version}
                  </p>
                </div>
                {canWrite && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--danger)] hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      askDelete(img)
                    }}
                  >
                    Borrar
                  </button>
                )}
              </div>
              <MobileListMeta>
                <span className="truncate">{img.fileName}</span>
                <span>·</span>
                <span>{formatFileSize(img.byteSize)}</span>
                <span>·</span>
                {img.acsRegistered ? (
                  <span className="text-emerald-500">Registrada</span>
                ) : (
                  <span className="text-amber-500">Solo disco</span>
                )}
                <span>·</span>
                <span>{new Date(img.createdAt).toLocaleString()}</span>
              </MobileListMeta>
            </MobileListCard>
          )
        })}
      </MobileList>

      <DesktopTableWrap>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--bg)] text-xs uppercase text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Modelo</th>
              <th className="px-3 py-2 font-medium">Versión</th>
              <th className="px-3 py-2 font-medium">Archivo</th>
              <th className="px-3 py-2 font-medium">ACS</th>
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && images.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-[var(--text-muted)]">
                  No hay imágenes. Sube un firmware y asócialo a un modelo.
                </td>
              </tr>
            )}
            {images.map((img) => {
              const active = img.id === selectedId
              return (
                <tr
                  key={img.id}
                  className={`cursor-pointer border-t border-[var(--border)] ${
                    active ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg)]'
                  }`}
                  onClick={() => setSelectedId(img.id)}
                >
                  <td className="px-3 py-2 font-medium">{img.modelKey}</td>
                  <td className="px-3 py-2 font-mono text-xs">{img.version}</td>
                  <td className="px-3 py-2">
                    <span className="block truncate max-w-[220px]">
                      {img.fileName}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {formatFileSize(img.byteSize)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {img.acsRegistered ? (
                      <span className="text-emerald-500">Registrada</span>
                    ) : (
                      <span className="text-amber-500">Solo disco</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                    {new Date(img.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && (
                      <button
                        type="button"
                        className="text-xs text-[var(--danger)] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          askDelete(img)
                        }}
                      >
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DesktopTableWrap>

      {selected && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              ONUs {selected.modelKey} · destino {selected.version}
            </h3>
            {canWrite && (
              <button
                type="button"
                className={btnGhost}
                disabled={busy || !targets.some((t) => t.canUpgrade)}
                onClick={askUpgradeOnline}
              >
                Actualizar las online de este modelo
              </button>
            )}
          </div>
          {targetsQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando ONUs…</p>
          )}
          <MobileList>
            {targets.length === 0 && !targetsQuery.isLoading && (
              <MobileListEmpty>
                No hay ONUs Conectadas de este modelo.
              </MobileListEmpty>
            )}
            {targets.map((t) => (
              <MobileListCard key={t.onuId}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold">
                      {t.sn ?? '—'}
                    </p>
                    {t.name ? (
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {t.name}
                      </p>
                    ) : null}
                  </div>
                  {t.online ? (
                    <span className="shrink-0 text-xs text-emerald-500">
                      Online
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      Offline
                    </span>
                  )}
                </div>
                <MobileListMeta>
                  <span>{t.oltName || '—'}</span>
                  <span>·</span>
                  <span className="font-mono">ACS {t.acsVersion ?? '—'}</span>
                </MobileListMeta>
                {(canWrite || (!t.canUpgrade && t.skipReason)) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {canWrite && (
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={busy || !t.canUpgrade}
                        title={t.skipReason ?? 'Encolar Download TR-069'}
                        onClick={() => askUpgradeOne(t)}
                      >
                        Actualizar
                      </button>
                    )}
                    {!t.canUpgrade && t.skipReason && (
                      <span className="text-xs text-[var(--text-muted)]">
                        {t.skipReason}
                      </span>
                    )}
                  </div>
                )}
              </MobileListCard>
            ))}
          </MobileList>
          <DesktopTableWrap>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--bg)] text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">SN</th>
                  <th className="px-3 py-2 font-medium">OLT</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Versión ACS</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {targets.length === 0 && !targetsQuery.isLoading && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-[var(--text-muted)]"
                    >
                      No hay ONUs Conectadas de este modelo.
                    </td>
                  </tr>
                )}
                {targets.map((t) => (
                  <tr
                    key={t.onuId}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.sn ?? '—'}
                      {t.name ? (
                        <span className="mt-0.5 block font-sans text-[var(--text-muted)]">
                          {t.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{t.oltName || '—'}</td>
                    <td className="px-3 py-2">
                      {t.online ? (
                        <span className="text-emerald-500">Online</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">Offline</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.acsVersion ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canWrite && (
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={busy || !t.canUpgrade}
                          title={t.skipReason ?? 'Encolar Download TR-069'}
                          onClick={() => askUpgradeOne(t)}
                        >
                          Actualizar
                        </button>
                      )}
                      {!t.canUpgrade && t.skipReason && (
                        <span className="ml-2 text-xs text-[var(--text-muted)]">
                          {t.skipReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableWrap>
        </div>
      )}
    </div>
  )
}
