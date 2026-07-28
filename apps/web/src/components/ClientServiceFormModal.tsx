import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Client, ClientService, ServicePlan } from '../lib/crm'
import type {
  ConnectedOnu,
  ConnectedOnusResponse,
} from '../lib/onu-connected'
import { useCompanyCurrency, useMoney } from '../lib/currency'
import { MoneyInput } from './MoneyInput'
import { ChangeServiceOnuModal } from './ChangeServiceOnuModal'
import { AddressLocationFields } from './AddressLocationFields'
import { ModalPortal } from './ModalPortal'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

export function ClientServiceFormModal({
  open,
  onClose,
  clientId,
  clientName,
  client,
  service,
}: {
  open: boolean
  onClose: () => void
  clientId: string
  /** Nombre limpio del cliente (para el nombre de ONU en la OLT). */
  clientName?: string
  /** Cliente completo para poder reutilizar su dirección. */
  client?: Client | null
  /** Si viene, la modal edita este servicio en vez de crear uno nuevo. */
  service?: ClientService | null
}) {
  const queryClient = useQueryClient()
  const money = useMoney()
  const currency = useCompanyCurrency()
  const [servicePlanId, setServicePlanId] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState('active')
  const [activeFrom, setActiveFrom] = useState(
    () => new Date().toISOString().slice(0, 10),
  )
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [useClientAddr, setUseClientAddr] = useState(false)
  const [changeOnuOpen, setChangeOnuOpen] = useState(false)

  const clientHasAddress = !!(
    client &&
    (client.street.trim() ||
      (client.latitude != null && client.longitude != null))
  )

  const plansQuery = useQuery({
    queryKey: ['app', 'service-plans'],
    queryFn: () => apiFetch<ServicePlan[]>('/app/service-plans'),
    enabled: open,
  })

  const onusQuery = useQuery({
    queryKey: ['app', 'onus'],
    queryFn: () => apiFetch<ConnectedOnusResponse>('/app/onus'),
    enabled: open && !!service?.onuId,
    staleTime: 30_000,
  })

  const linkedOnu: ConnectedOnu | null =
    service?.onuId != null
      ? (onusQuery.data?.onus.find((o) => o.id === service.onuId) ?? null)
      : null

  useEffect(() => {
    if (!open) return
    setChangeOnuOpen(false)
    if (service) {
      setServicePlanId(service.servicePlanId)
      setName(service.name)
      setPrice(String(service.price))
      setStatus(service.status)
      setActiveFrom(
        service.activeFrom ?? new Date().toISOString().slice(0, 10),
      )
      setStreet(service.street)
      setCity(service.city)
      setZipCode(service.zipCode)
      setLatitude(service.latitude)
      setLongitude(service.longitude)
      setNote(service.note)
      // Al editar, marcado solo si el servicio aún no tiene dirección propia
      // o si coincide con la del cliente.
      setUseClientAddr(
        clientHasAddress &&
          (!service.street.trim() ||
            (service.street === client?.street &&
              service.city === client?.city)),
      )
    } else {
      setServicePlanId('')
      setName('')
      setPrice('')
      setStatus('active')
      setActiveFrom(new Date().toISOString().slice(0, 10))
      if (clientHasAddress && client) {
        setUseClientAddr(true)
        setStreet(client.street)
        setCity(client.city)
        setZipCode(client.zipCode)
        setLatitude(client.latitude)
        setLongitude(client.longitude)
      } else {
        setUseClientAddr(false)
        setStreet('')
        setCity('')
        setZipCode('')
        setLatitude(null)
        setLongitude(null)
      }
      setNote('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo resetear al abrir
  }, [open, service])

  function toggleUseClientAddr(checked: boolean) {
    setUseClientAddr(checked)
    if (checked && client) {
      setStreet(client.street)
      setCity(client.city)
      setZipCode(client.zipCode)
      setLatitude(client.latitude)
      setLongitude(client.longitude)
    }
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !changeOnuOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, changeOnuOpen])

  const plans = (plansQuery.data ?? []).filter(
    (p) => p.isActive || p.id === service?.servicePlanId,
  )

  function onPlanChange(id: string) {
    setServicePlanId(id)
    const plan = plans.find((p) => p.id === id)
    if (plan && !service) {
      if (!name) setName(plan.name)
      if (!price) setPrice(String(plan.price))
    }
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        servicePlanId,
        name: name.trim() || undefined,
        price: price !== '' ? Number(price) : undefined,
        status,
        activeFrom,
        street: street.trim(),
        city: city.trim(),
        zipCode: zipCode.trim(),
        note: note.trim(),
        latitude: useClientAddr && client ? client.latitude : latitude,
        longitude: useClientAddr && client ? client.longitude : longitude,
      }
      if (service) {
        return apiFetch<ClientService>(`/app/client-services/${service.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch<ClientService>(`/app/clients/${clientId}/services`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['app', 'clients', clientId],
      })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
      onClose()
    },
  })

  if (!open) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <>
      <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
            <h2 className="min-w-0 text-lg font-semibold">
              {service ? 'Editar servicio' : 'Nuevo servicio / contrato'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              ✕
            </button>
          </div>

          <form onSubmit={onSubmit} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {service && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    ONU enlazada
                  </span>
                  <button
                    type="button"
                    onClick={() => setChangeOnuOpen(true)}
                    className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    Cambiar
                  </button>
                </div>
                {onusQuery.isLoading && service.onuId ? (
                  <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
                ) : linkedOnu ? (
                  <div className="text-sm">
                    <p className="font-mono text-xs">{linkedOnu.sn || '—'}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {linkedOnu.name || 'Sin nombre en OLT'}
                      {' · '}
                      {linkedOnu.oltName} · {linkedOnu.onuIf}
                      {linkedOnu.mgmtVlanId != null
                        ? ` · mgmt VLAN ${linkedOnu.mgmtVlanId}`
                        : ''}
                      {linkedOnu.wanVlanId != null
                        ? ` · WAN VLAN ${linkedOnu.wanVlanId}`
                        : ''}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">
                    {service.onuId
                      ? 'ONU no encontrada en Conectadas (puede haberse liberado).'
                      : 'Este servicio aún no tiene ONU. Usa Cambiar para aprovisionar una huérfana.'}
                  </p>
                )}
              </div>
            )}

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Plan</span>
              <select
                required
                className={inputClass}
                value={servicePlanId}
                onChange={(e) => onPlanChange(e.target.value)}
              >
                <option value="">Seleccionar plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {money(p.price)} (
                    {p.speedProfile
                      ? `${p.speedProfile.name} · ↓${p.speedProfile.downloadMbps}/↑${p.speedProfile.uploadMbps}`
                      : `${p.downloadSpeed}/${p.uploadSpeed} Mbps`}
                    )
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Por defecto: nombre del plan"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Precio (override, {currency})
                </span>
                <MoneyInput
                  className={inputClass}
                  currency={currency}
                  value={price}
                  onChange={setPrice}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">Estado</span>
                <select
                  className={inputClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="prepared">Preparando</option>
                  <option value="active">Activo</option>
                  <option value="suspended">Suspendido</option>
                  <option value="ended">Finalizado</option>
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">
                Activo desde
              </span>
              <input
                type="date"
                className={inputClass}
                value={activeFrom}
                onChange={(e) => setActiveFrom(e.target.value)}
              />
            </label>
            {clientHasAddress && (
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={useClientAddr}
                  onChange={(e) => toggleUseClientAddr(e.target.checked)}
                />
                <span>
                  Usar dirección del cliente
                  <span className="block text-xs text-[var(--text-muted)]">
                    {[client?.street, client?.city]
                      .filter(Boolean)
                      .join(', ') || 'Ubicación marcada en el mapa'}
                  </span>
                </span>
              </label>
            )}
            {useClientAddr ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
                Se usará la dirección y GPS del cliente.
                {client?.latitude != null && client?.longitude != null
                  ? ` (${client.latitude.toFixed(5)}, ${client.longitude.toFixed(5)})`
                  : ''}
              </p>
            ) : (
              <AddressLocationFields
                value={{ street, city, zipCode, latitude, longitude }}
                onChange={(next) => {
                  setStreet(next.street)
                  setCity(next.city)
                  setZipCode(next.zipCode)
                  setLatitude(next.latitude)
                  setLongitude(next.longitude)
                }}
                mapClassName="h-48 w-full rounded-lg"
              />
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

            {mutation.error && (
              <p className="text-sm text-[var(--danger)]">
                {mutation.error.message}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={mutation.isPending || !servicePlanId}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {mutation.isPending
                  ? 'Guardando…'
                  : service
                    ? 'Guardar cambios'
                    : 'Crear servicio'}
              </button>
            </div>
          </form>
        </div>
      </div></ModalPortal>

      {service && (
        <ChangeServiceOnuModal
          open={changeOnuOpen}
          onClose={() => {
            setChangeOnuOpen(false)
            void queryClient.invalidateQueries({
              queryKey: ['app', 'clients', clientId],
            })
            void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
          }}
          clientId={clientId}
          clientName={
            clientName ||
            [service.name].filter(Boolean).join(' ') ||
            'Cliente'
          }
          service={service}
          currentOnu={linkedOnu}
        />
      )}
    </>
  )
}
