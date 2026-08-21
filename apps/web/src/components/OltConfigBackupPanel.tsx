import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatBytes } from '../lib/topology'
import {
  captureOltConfigBackup,
  diffOltConfigBackups,
  downloadOltConfigBackup,
  listOltConfigBackups,
  setOltTechnicianMode,
  type OltConfigSnapshot,
} from '../lib/olt-config-backup'
import { useNotify } from './NotifyProvider'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListEmpty,
  MobileListMeta,
} from './MobileList'

const btnPrimary =
  'rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60'
const btnGhost =
  'rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-60'

export function OltConfigBackupPanel({
  deviceId,
  canWrite,
  technicianMode,
}: {
  deviceId: string
  canWrite: boolean
  technicianMode: boolean
}) {
  const qc = useQueryClient()
  const { confirm } = useNotify()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  const listQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'config-backups'],
    queryFn: () => listOltConfigBackups(deviceId),
  })
  const snapshots = listQuery.data?.snapshots ?? []

  const aId = picked[0] ?? null
  const bId = picked[1] ?? null
  const diffQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'config-backups', 'diff', aId, bId],
    queryFn: () => diffOltConfigBackups(deviceId, aId!, bId!),
    enabled: Boolean(aId && bId),
  })

  const captureMut = useMutation({
    mutationFn: () => captureOltConfigBackup(deviceId),
    onSuccess: (row) => {
      setErr(null)
      setMsg(
        row.complete
          ? 'Respaldo guardado'
          : 'Respaldo guardado (dump incompleto o truncado)',
      )
      void qc.invalidateQueries({
        queryKey: ['app', 'topology', 'devices', deviceId, 'config-backups'],
      })
    },
    onError: (e: Error) => {
      setMsg(null)
      setErr(e.message)
    },
  })

  const techMut = useMutation({
    mutationFn: (on: boolean) => setOltTechnicianMode(deviceId, on),
    onSuccess: (r) => {
      setErr(null)
      setMsg(
        r.technicianMode
          ? 'Modo técnico ON: el poller no escribe T-CONT/WAN'
          : 'Modo técnico OFF',
      )
      void qc.invalidateQueries({ queryKey: ['topology'] })
      void qc.invalidateQueries({ queryKey: ['app', 'topology'] })
    },
    onError: (e: Error) => {
      setMsg(null)
      setErr(e.message)
    },
  })

  const busy = captureMut.isPending || techMut.isPending
  const techOn = techMut.data?.technicianMode ?? technicianMode

  function togglePick(id: string) {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= 2) return [cur[1], id]
      return [...cur, id]
    })
  }

  const pickedSet = useMemo(() => new Set(picked), [picked])

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Copia del running-config en disco (no en Postgres). Restaurar: activa
        Técnico en OLT y aplica el archivo en CLI. El dump CLI a veces se trunca.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={techOn}
          disabled={!canWrite || techMut.isPending}
          onChange={(e) => {
            const on = e.target.checked
            void confirm(
              on
                ? '¿Activar Técnico en OLT? El poller dejará de escribir T-CONT y VLAN de uplink.'
                : '¿Quitar modo técnico? El poller volverá a curar T-CONT/WAN.',
              {
                title: 'Técnico en OLT',
                confirmLabel: on ? 'Activar' : 'Quitar',
              },
            ).then((ok) => {
              if (ok) techMut.mutate(on)
            })
          }}
        />
        Técnico en OLT
        <span className="text-xs text-[var(--text-muted)]">
          (poller no escribe T-CONT/WAN)
        </span>
      </label>

      {msg && <p className="text-sm text-emerald-500">{msg}</p>}
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}

      {canWrite && (
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={() => captureMut.mutate()}
        >
          {captureMut.isPending ? 'Respaldando…' : 'Respaldar ahora'}
        </button>
      )}

      <MobileList>
        {listQuery.isLoading && <MobileListEmpty>Cargando…</MobileListEmpty>}
        {!listQuery.isLoading && snapshots.length === 0 && (
          <MobileListEmpty>
            Aún no hay copias. Pulsa Respaldar ahora o espera el job diario.
          </MobileListEmpty>
        )}
        {snapshots.map((row: OltConfigSnapshot) => (
          <MobileListCard key={row.id}>
            <div className="flex items-start justify-between gap-2">
              <label className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={pickedSet.has(row.id)}
                  onChange={() => togglePick(row.id)}
                  aria-label="Elegir para diff"
                />
                <span className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums">
                    {new Date(row.createdAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {row.source === 'manual' ? 'Manual' : 'Programado'}
                  </p>
                </span>
              </label>
              <button
                type="button"
                className={`${btnGhost} shrink-0`}
                onClick={() => {
                  void downloadOltConfigBackup(
                    deviceId,
                    row.id,
                    row.fileName || 'olt.cfg',
                  ).catch((e: Error) => setErr(e.message))
                }}
              >
                Descargar
              </button>
            </div>
            <MobileListMeta>
              <span>{formatBytes(row.byteSize)}</span>
              <span>·</span>
              {row.complete ? (
                <span className="text-emerald-500">Completo</span>
              ) : (
                <span className="text-amber-500">Truncado</span>
              )}
            </MobileListMeta>
          </MobileListCard>
        ))}
      </MobileList>

      <DesktopTableWrap>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--bg)] text-xs uppercase text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Diff</th>
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Origen</th>
              <th className="px-3 py-2 font-medium">Tamaño</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!listQuery.isLoading && snapshots.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-[var(--text-muted)]">
                  Aún no hay copias. Pulsa Respaldar ahora o espera el job diario.
                </td>
              </tr>
            )}
            {snapshots.map((row: OltConfigSnapshot) => (
              <tr key={row.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={pickedSet.has(row.id)}
                    onChange={() => togglePick(row.id)}
                    aria-label="Elegir para diff"
                  />
                </td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.source === 'manual' ? 'Manual' : 'Programado'}
                </td>
                <td className="px-3 py-2 text-xs">{formatBytes(row.byteSize)}</td>
                <td className="px-3 py-2 text-xs">
                  {row.complete ? (
                    <span className="text-emerald-500">Completo</span>
                  ) : (
                    <span className="text-amber-500">Truncado</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      void downloadOltConfigBackup(
                        deviceId,
                        row.id,
                        row.fileName || 'olt.cfg',
                      ).catch((e: Error) => setErr(e.message))
                    }}
                  >
                    Descargar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTableWrap>

      {aId && bId && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            Diff
            {diffQuery.data
              ? ` · +${diffQuery.data.added} / −${diffQuery.data.removed}`
              : ''}
          </h4>
          {diffQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Comparando…</p>
          )}
          {diffQuery.data && (
            <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-5">
              {diffQuery.data.hunks
                .filter((h) => h.kind !== 'same')
                .slice(0, 300)
                .map((h, i) => (
                  <div
                    key={`${h.kind}-${i}`}
                    className={
                      h.kind === 'add'
                        ? 'text-emerald-500'
                        : h.kind === 'del'
                          ? 'text-[var(--danger)]'
                          : ''
                    }
                  >
                    {h.kind === 'add' ? '+ ' : h.kind === 'del' ? '- ' : '  '}
                    {h.text}
                  </div>
                ))}
              {diffQuery.data.truncated ? (
                <div className="text-[var(--text-muted)]">… truncado</div>
              ) : null}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
