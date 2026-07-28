import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2'

type AddressRow = {
  key: string
  id?: string
  address: string
}

type PortAddressesResponse = {
  portId: string
  portName: string
  interfaceName?: string
  source: 'device' | 'local' | 'cache'
  warning?: string
  addresses: Array<{ id?: string; address: string }>
}

function newKey() {
  return `row-${Math.random().toString(36).slice(2, 9)}`
}

function addressesUrl(portId: string, interfaceName?: string | null) {
  const base = `/app/topology/ports/${portId}/addresses`
  if (!interfaceName) return base
  return `${base}?interface=${encodeURIComponent(interfaceName)}`
}

export function PortIpsModal({
  open,
  portId,
  portName,
  interfaceName,
  canWrite,
  onClose,
}: {
  open: boolean
  portId: string | null
  /** Display title override (e.g. "VLAN 10") */
  portName?: string
  /** MikroTik iface to edit; omit for the physical port itself */
  interfaceName?: string | null
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<AddressRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const listQuery = useQuery({
    queryKey: [
      'app',
      'topology',
      'port-addresses',
      portId,
      interfaceName ?? null,
    ],
    queryFn: () =>
      apiFetch<PortAddressesResponse>(
        addressesUrl(portId!, interfaceName),
      ),
    enabled: open && !!portId,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!open) {
      setRows([])
      setLoaded(false)
      return
    }
    setLoaded(false)
  }, [open, portId, interfaceName])

  useEffect(() => {
    if (!listQuery.data || listQuery.isFetching) return
    setRows(
      listQuery.data.addresses.map((a) => ({
        key: a.id || newKey(),
        id: a.id,
        address: a.address,
      })),
    )
    setLoaded(true)
  }, [listQuery.data, listQuery.isFetching, listQuery.dataUpdatedAt])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<PortAddressesResponse>(
        addressesUrl(portId!, interfaceName),
        {
          method: 'PUT',
          body: JSON.stringify({
            addresses: rows
              .map((r) => ({
                id: r.id,
                address: r.address.trim(),
              }))
              .filter((r) => r.address.length > 0),
          }),
        },
      ),
    onSuccess: (data) => {
      setRows(
        data.addresses.map((a) => ({
          key: a.id || newKey(),
          id: a.id,
          address: a.address,
        })),
      )
      void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
      void queryClient.invalidateQueries({
        queryKey: [
          'app',
          'topology',
          'port-addresses',
          portId,
          interfaceName ?? null,
        ],
      })
    },
  })

  if (!open || !portId) return null

  const titleName =
    portName ?? listQuery.data?.portName ?? interfaceName ?? 'puerto'
  const ready = loaded && !listQuery.isFetching

  return (
    <ModalPortal><div className="fixed inset-0 z-[65] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">IPs · {titleName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {listQuery.isLoading && (
            <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
          )}
          {listQuery.error && (
            <p className="text-sm text-[var(--danger)]">
              {listQuery.error.message}
            </p>
          )}

          {ready && (
            <>
              {rows.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">
                  Sin direcciones
                </p>
              )}

              <ul className="space-y-2">
                {rows.map((row, index) => (
                  <li key={row.key} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-xs text-[var(--text-muted)]">
                      {index + 1}.
                    </span>
                    <input
                      className={inputClass}
                      value={row.address}
                      placeholder="192.168.1.1/24"
                      disabled={!canWrite || saveMutation.isPending}
                      onChange={(e) => {
                        const value = e.target.value
                        setRows((prev) =>
                          prev.map((r) =>
                            r.key === row.key ? { ...r, address: value } : r,
                          ),
                        )
                      }}
                    />
                    {canWrite && (
                      <button
                        type="button"
                        disabled={saveMutation.isPending}
                        onClick={() =>
                          setRows((prev) =>
                            prev.filter((r) => r.key !== row.key),
                          )
                        }
                        className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-60"
                      >
                        Quitar
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canWrite && (
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={() =>
                    setRows((prev) => [
                      ...prev,
                      { key: newKey(), address: '' },
                    ])
                  }
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                >
                  Agregar IP
                </button>
              )}
            </>
          )}

          {saveMutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {saveMutation.error.message}
            </p>
          )}
          {saveMutation.isSuccess && !saveMutation.isPending && (
            <p className="text-sm text-emerald-600">Guardado en el equipo</p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:border-[var(--accent)]"
          >
            Cerrar
          </button>
          {canWrite && (
            <button
              type="button"
              disabled={!ready || saveMutation.isPending || listQuery.isError}
              onClick={() => saveMutation.mutate()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {saveMutation.isPending ? 'Guardando…' : 'Guardar en el equipo'}
            </button>
          )}
        </div>
      </div>
    </div></ModalPortal>
  )
}
