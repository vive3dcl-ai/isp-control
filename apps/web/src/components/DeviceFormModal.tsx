import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  CREATABLE_DEVICE_TYPES,
  deviceTypeLabel,
  INTERNET_DEVICE_TYPE,
  OLT_SELECTABLE_SUBTYPES,
  oltSubtypeLabel,
  ROUTER_SUBTYPES,
  routerSubtypeLabel,
  type NetworkDeviceType,
  type OltSubtype,
  type RouterSubtype,
  type TopologyDevice,
} from '../lib/topology'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

export function DeviceFormModal({
  open,
  onClose,
  device,
}: {
  open: boolean
  onClose: () => void
  device?: TopologyDevice | null
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<NetworkDeviceType>('router')
  const [routerSubtype, setRouterSubtype] = useState<RouterSubtype>('mikrotik')
  const [oltSubtype, setOltSubtype] = useState<OltSubtype>('zte_c320')
  const [note, setNote] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [initialPortCount, setInitialPortCount] = useState('4')

  useEffect(() => {
    if (!open) return
    if (device) {
      setName(device.name)
      setType(device.type)
      if (device.type === 'olt') {
        const sub = (device.subtype as OltSubtype) || 'zte_c320'
        setOltSubtype(sub === 'zte_c3xx' ? 'zte_c320' : sub)
      } else {
        setRouterSubtype((device.subtype as RouterSubtype) || 'mikrotik')
      }
      setNote(device.note)
      setIsActive(device.isActive)
    } else {
      setName('')
      setType('router')
      setRouterSubtype('mikrotik')
      setOltSubtype('zte_c320')
      setNote('')
      setIsActive(true)
      setInitialPortCount('4')
    }
  }, [open, device])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const subtypeForPayload =
    type === 'router' ? routerSubtype : type === 'olt' ? oltSubtype : null

  const mutation = useMutation({
    mutationFn: () => {
      if (device) {
        if (device.type === INTERNET_DEVICE_TYPE) {
          return apiFetch(`/app/topology/devices/${device.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ note }),
          })
        }
        return apiFetch(`/app/topology/devices/${device.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            type,
            subtype: subtypeForPayload,
            note,
            isActive,
          }),
        })
      }
      return apiFetch('/app/topology/devices', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type,
          subtype: subtypeForPayload ?? undefined,
          note,
          isActive,
          initialPortCount:
            (type === 'router' && routerSubtype === 'mikrotik') ||
            type === 'olt'
              ? 0
              : Number(initialPortCount) || 0,
        }),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'topology'] })
      if (device) {
        void queryClient.invalidateQueries({
          queryKey: ['app', 'topology', 'device', device.id],
        })
      }
      onClose()
    },
  })

  if (!open) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate()
  }

  const hidePorts =
    (type === 'router' && routerSubtype === 'mikrotik') || type === 'olt'

  return (
    <ModalPortal><div className="fixed inset-0 z-[70] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-md rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {device ? 'Editar activo' : 'Agregar activo'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          {device?.type === INTERNET_DEVICE_TYPE ? (
            <p className="text-sm text-[var(--text-muted)]">
              Activo fijo del sistema (nube WAN). Solo puedes editar la nota y
              gestionar puertos / conexiones.
            </p>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre
                </span>
                <input
                  required
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">Tipo</span>
                <select
                  className={inputClass}
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as NetworkDeviceType)
                  }
                >
                  {CREATABLE_DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {deviceTypeLabel[t]}
                    </option>
                  ))}
                </select>
              </label>
              {type === 'router' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Fabricante / modelo
                  </span>
                  <select
                    className={inputClass}
                    value={routerSubtype}
                    onChange={(e) =>
                      setRouterSubtype(e.target.value as RouterSubtype)
                    }
                  >
                    {ROUTER_SUBTYPES.map((s) => (
                      <option key={s} value={s}>
                        {routerSubtypeLabel[s]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {type === 'olt' && (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Modelo exacto
                  </span>
                  <select
                    className={inputClass}
                    value={oltSubtype}
                    onChange={(e) =>
                      setOltSubtype(e.target.value as OltSubtype)
                    }
                  >
                    {OLT_SELECTABLE_SUBTYPES.map((s) => (
                      <option key={s} value={s}>
                        {oltSubtypeLabel[s]}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">
                    El firmware se detecta al probar la conexión (v1.2 / v2.0 /
                    v2.1).
                  </span>
                </label>
              )}
            </>
          )}
          {!device && !hidePorts && (
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Puertos iniciales
              </span>
              <input
                type="number"
                min={0}
                max={64}
                className={inputClass}
                value={initialPortCount}
                onChange={(e) => setInitialPortCount(e.target.value)}
              />
            </label>
          )}
          {!device && type === 'router' && routerSubtype === 'mikrotik' && (
            <p className="text-xs text-[var(--text-muted)]">
              Los puertos físicos se sincronizan solos al configurar la conexión
              (solo lectura).
            </p>
          )}
          {!device && type === 'olt' && (
            <p className="text-xs text-[var(--text-muted)]">
              Configura la conexión Telnet/SSH en el detalle del OLT (solo
              lectura por ahora).
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Nota</span>
            <textarea
              className={inputClass}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {device?.type !== INTERNET_DEVICE_TYPE && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Activo
            </label>
          )}
          {mutation.error && (
            <p className="text-sm text-[var(--danger)]">
              {mutation.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:border-[var(--accent)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}
