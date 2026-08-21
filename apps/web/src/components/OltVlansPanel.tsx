import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OltVlanRow, OltVlansResponse } from '../lib/topology'
import { ModalPortal } from './ModalPortal'
import {
  oltBtnPrimary,
  oltBtnSecondary,
  oltMetaClass,
  oltToolbarClass,
} from './oltPanelUi'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

type ModalMode = 'create' | 'edit'

export function OltVlansPanel({
  deviceId,
  canWrite,
}: {
  deviceId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [editing, setEditing] = useState<OltVlanRow | null>(null)
  const [vlanId, setVlanId] = useState('')
  const [description, setDescription] = useState('')
  const [isolated, setIsolated] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const vlansQuery = useQuery({
    queryKey: ['app', 'topology', 'devices', deviceId, 'vlans'],
    queryFn: () =>
      apiFetch<OltVlansResponse>(`/app/topology/devices/${deviceId}/vlans`),
    retry: 1,
  })

  async function syncFromOlt() {
    setSyncing(true)
    try {
      const data = await apiFetch<OltVlansResponse>(
        `/app/topology/devices/${deviceId}/vlans?refresh=1`,
      )
      queryClient.setQueryData(
        ['app', 'topology', 'devices', deviceId, 'vlans'],
        data,
      )
    } finally {
      setSyncing(false)
    }
  }

  function openCreate() {
    setModal('create')
    setEditing(null)
    setVlanId('')
    setDescription('')
    setIsolated(true)
    setDeleteConfirm('')
    setError(null)
  }

  function openEdit(v: OltVlanRow) {
    setModal('edit')
    setEditing(v)
    setVlanId(String(v.vlanId))
    setDescription(v.description ?? '')
    setIsolated(v.isolated)
    setDeleteConfirm('')
    setError(null)
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
    setError(null)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const id = Number(vlanId)
      if (!Number.isInteger(id) || id < 1 || id > 4094) {
        throw new Error('VLAN ID inválido (1–4094)')
      }
      return apiFetch<{ message?: string }>(`/app/topology/devices/${deviceId}/vlans`, {
        method: 'PUT',
        body: JSON.stringify({
          vlanId: id,
          description,
          isolated: modal === 'create' ? true : isolated,
        }),
      })
    },
    onSuccess: (r: { message?: string }) => {
      setMsg(r.message ?? 'VLAN guardada')
      closeModal()
      void syncFromOlt()
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Sin VLAN')
      return apiFetch<{ message?: string }>(
        `/app/topology/devices/${deviceId}/vlans/${editing.vlanId}`,
        { method: 'DELETE' },
      )
    },
    onSuccess: (r: { message?: string }) => {
      setMsg(r.message ?? 'VLAN eliminada')
      closeModal()
      void syncFromOlt()
    },
    onError: (e: Error) => setError(e.message),
  })

  const vlans = vlansQuery.data?.vlans ?? []

  const deleteReady = useMemo(
    () =>
      editing != null &&
      deleteConfirm.trim() === String(editing.vlanId),
    [editing, deleteConfirm],
  )

  return (
    <div className="space-y-4">
      <div className={oltToolbarClass}>
        <button
          type="button"
          disabled={vlansQuery.isFetching || syncing}
          onClick={() => void syncFromOlt()}
          className={oltBtnPrimary}
        >
          {vlansQuery.isFetching || syncing
            ? 'Sincronizando…'
            : 'Sincronizar'}
        </button>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className={oltBtnSecondary}
          >
            + Agregar VLAN
          </button>
        )}
        {(vlansQuery.data?.syncedAt || vlansQuery.data?.probedAt) && (
          <span className={oltMetaClass}>
            Última sincronización:{' '}
            {new Date(
              vlansQuery.data.syncedAt || vlansQuery.data.probedAt,
            ).toLocaleString()}
          </span>
        )}
        {vlansQuery.data?.summary && (
          <span className={oltMetaClass}>{vlansQuery.data.summary}</span>
        )}
      </div>

      <p className="text-sm text-[var(--text)]">
        El tipo (Mgmt / Internet) lo define el pool en Ajustes → IP Pools. Aquí
        solo creas la VLAN en la OLT y controlas el aislamiento. Recuerda
        etiquetarla también en{' '}
        <span className="font-medium">Uplinks</span>.
      </p>

      {msg && <p className="text-sm text-emerald-500">{msg}</p>}
      {vlansQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {vlansQuery.error.message}
        </p>
      )}
      {vlansQuery.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">
          Sincronizando VLANs…
        </p>
      )}

      {!vlansQuery.isLoading && vlans.length === 0 && !vlansQuery.error && (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No hay VLANs en la OLT. Agrega la primera con «+ Agregar VLAN».
        </p>
      )}

      {vlans.length > 0 && (
        <>
          <MobileList>
            {vlans.map((v) => (
              <MobileListCard key={v.vlanId}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-sm font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                      onClick={() => openEdit(v)}
                    >
                      VLAN {v.vlanId}
                      {v.isSystem && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                          sistema
                        </span>
                      )}
                    </button>
                    <p className="text-xs text-[var(--text-muted)]">
                      {v.typeLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--accent)] hover:underline"
                    onClick={() => openEdit(v)}
                  >
                    Editar
                  </button>
                </div>
                <MobileListMeta>
                  <span className="line-clamp-1">{v.description || '—'}</span>
                  <span>·</span>
                  <span>{v.isolated ? 'Aislada' : 'No aislada'}</span>
                  <span>·</span>
                  <span className="text-[var(--accent)]">
                    ONUs {v.onuCount}
                  </span>
                </MobileListMeta>
              </MobileListCard>
            ))}
          </MobileList>

          <DesktopTableWrap>
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <th className="px-3 py-2 font-medium">VLAN-ID</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Descripción</th>
                  <th className="px-3 py-2 font-medium">Aislada</th>
                  <th className="px-3 py-2 font-medium">ONUs</th>
                  <th className="px-3 py-2 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {vlans.map((v) => (
                  <tr
                    key={v.vlanId}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                        onClick={() => openEdit(v)}
                      >
                        {v.vlanId}
                      </button>
                      {v.isSystem && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                          sistema
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{v.typeLabel}</td>
                    <td className="px-3 py-2.5">{v.description || '—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      <input type="checkbox" checked={v.isolated} readOnly />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[var(--accent)]">{v.onuCount}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="text-xs text-[var(--accent)] hover:underline"
                        onClick={() => openEdit(v)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableWrap>
        </>
      )}

      {modal && (
        <ModalPortal><div className="fixed inset-0 z-[110] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h3 className="text-lg font-semibold">
                {modal === 'create'
                  ? 'Agregar VLAN'
                  : `Editar VLAN ${editing?.vlanId}`}
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
                onClick={closeModal}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm">
              <div className="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                <span aria-hidden>⚠</span>
                <span>
                  Recuerda agregar esta VLAN a los puertos uplink.
                </span>
              </div>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  VLAN-ID
                </span>
                <input
                  className={inputClass}
                  value={vlanId}
                  onChange={(e) => setVlanId(e.target.value)}
                  disabled={!canWrite || modal === 'edit'}
                  inputMode="numeric"
                  placeholder="1–4094"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Descripción
                </span>
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canWrite}
                />
              </label>

              {modal === 'edit' && editing && (
                <p className="rounded-lg bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  Tipo:{' '}
                  <span className="text-[var(--text)]">{editing.typeLabel}</span>
                  {' · '}
                  definido por IP Pools
                </p>
              )}

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isolated}
                  disabled={!canWrite || modal === 'create'}
                  onChange={(e) => setIsolated(e.target.checked)}
                />
                <span>
                  VLAN aislada: las ONUs no se comunican entre sí
                  {modal === 'create' ? (
                    <span className="text-[var(--text-muted)]">
                      {' '}
                      (siempre al crear)
                    </span>
                  ) : null}
                </span>
              </label>

              {modal === 'edit' && canWrite && !editing?.isSystem && (
                <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3">
                  <p className="mb-2 font-medium text-[var(--danger)]">
                    Eliminar VLAN
                  </p>
                  <p className="mb-2 text-xs text-[var(--text-muted)]">
                    Esto borra la VLAN de la OLT (`no vlan {editing?.vlanId}`).
                    Escribe el VLAN-ID para confirmar.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${inputClass} max-w-[140px]`}
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder={String(editing?.vlanId ?? '')}
                    />
                    <button
                      type="button"
                      disabled={!deleteReady || deleteMutation.isPending}
                      className="rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      onClick={() => deleteMutation.mutate()}
                    >
                      {deleteMutation.isPending
                        ? 'Eliminando…'
                        : 'Eliminar de la OLT'}
                    </button>
                  </div>
                </div>
              )}
              {modal === 'edit' && editing?.isSystem && (
                <p className="text-xs text-[var(--text-muted)]">
                  La VLAN 1 es del sistema y no se puede eliminar.
                </p>
              )}

              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button
                type="button"
                className={oltBtnSecondary}
                onClick={closeModal}
              >
                Cancelar
              </button>
              {canWrite && (
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  className={oltBtnPrimary}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
                </button>
              )}
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
