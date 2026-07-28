import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Client } from '../lib/crm'
import type { CompanyProfile } from '../lib/company'
import {
  companyDocumentType,
  formatDocument,
  personalDocumentTypes,
} from '../lib/documents'
import { clientDisplayName } from '../lib/crm'
import { AddressLocationFields } from './AddressLocationFields'
import {
  CalendarEventFormModal,
  type CalendarEventFormDefaults,
} from './CalendarEventFormModal'
import { ScheduleLeadPromptModal } from './ScheduleLeadPromptModal'
import type { Zone } from './ZonasSettingsTab'
import { ModalPortal } from './ModalPortal'


const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2'

type ClientForm = {
  firstName: string
  lastName: string
  companyName: string
  documentType: string
  documentNumber: string
  isCompany: boolean
  companyTaxId: string
  email: string
  phone: string
  street: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
  note: string
  isLead: boolean
  isActive: boolean
  zoneId: string | null
}

const empty: ClientForm = {
  firstName: '',
  lastName: '',
  companyName: '',
  documentType: '',
  documentNumber: '',
  isCompany: false,
  companyTaxId: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  zipCode: '',
  latitude: null,
  longitude: null,
  note: '',
  isLead: false,
  isActive: true,
  zoneId: null,
}

export function ClientFormModal({
  open,
  onClose,
  client,
}: {
  open: boolean
  onClose: () => void
  client?: Client | null
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ClientForm>(empty)
  const [schedulePromptClient, setSchedulePromptClient] =
    useState<Client | null>(null)
  const [scheduleDefaults, setScheduleDefaults] =
    useState<CalendarEventFormDefaults | null>(null)
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false)

  const companyQuery = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
    staleTime: 5 * 60_000,
  })
  const zonesQuery = useQuery({
    queryKey: ['app', 'zones'],
    queryFn: () => apiFetch<Zone[]>('/app/zones'),
    enabled: open,
    staleTime: 60_000,
  })
  const country = companyQuery.data?.country ?? ''
  const docTypes = personalDocumentTypes(country)
  const companyDoc = companyDocumentType(country)
  const selectedDocType =
    docTypes.find((t) => t.id === form.documentType) ?? docTypes[0]

  useEffect(() => {
    if (!open) return
    if (client) {
      setForm({
        firstName: client.firstName,
        lastName: client.lastName,
        companyName: client.companyName,
        documentType: client.documentType ?? '',
        documentNumber: client.documentNumber ?? '',
        isCompany: client.isCompany ?? !!client.companyName,
        companyTaxId: client.companyTaxId ?? '',
        email: client.email,
        phone: client.phone,
        street: client.street,
        city: client.city,
        zipCode: client.zipCode,
        latitude: client.latitude ?? null,
        longitude: client.longitude ?? null,
        note: client.note,
        isLead: client.isLead,
        isActive: client.isActive,
        zoneId: client.zoneId ?? null,
      })
    } else {
      setForm(empty)
    }
  }, [open, client])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const mutation = useMutation({
    mutationFn: (payload: ClientForm) => {
      if (client) {
        return apiFetch<Client>(`/app/clients/${client.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      return apiFetch<Client>('/app/clients', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['app', 'clients'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['app', 'zones'] })
      if (client) {
        void queryClient.invalidateQueries({
          queryKey: ['app', 'clients', client.id],
        })
      }
      onClose()
      if (!client && saved.isLead) {
        setSchedulePromptClient(saved)
      }
    },
  })

  const showScheduleUi = schedulePromptClient !== null || scheduleFormOpen

  if (!open && !showScheduleUi) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate({
      ...form,
      documentType: form.documentNumber.trim()
        ? (selectedDocType?.id ?? form.documentType)
        : '',
      // Si se desmarca «Empresa», se limpian los datos de empresa.
      companyName: form.isCompany ? form.companyName : '',
      companyTaxId: form.isCompany ? form.companyTaxId : '',
    })
  }

  function set<K extends keyof ClientForm>(key: K, value: ClientForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
    {open && (
    <ModalPortal><div className="fixed inset-0 z-[100] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {client ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Nombre
                </span>
                <input
                  className={inputClass}
                  value={form.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Apellido
                </span>
                <input
                  className={inputClass}
                  value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Tipo de documento
                </span>
                <select
                  className={inputClass}
                  value={selectedDocType?.id ?? ''}
                  onChange={(e) => set('documentType', e.target.value)}
                >
                  {docTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  {selectedDocType?.label ?? 'Documento'}
                </span>
                <input
                  className={inputClass}
                  placeholder={selectedDocType?.placeholder}
                  value={form.documentNumber}
                  onChange={(e) => set('documentNumber', e.target.value)}
                  onBlur={(e) =>
                    set(
                      'documentNumber',
                      formatDocument(
                        country,
                        selectedDocType?.id ?? '',
                        e.target.value,
                      ),
                    )
                  }
                />
              </label>
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isCompany}
                onChange={(e) => set('isCompany', e.target.checked)}
              />
              Empresa
            </label>
            {form.isCompany && (
              <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    Nombre empresa
                  </span>
                  <input
                    className={inputClass}
                    value={form.companyName}
                    onChange={(e) => set('companyName', e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--text-muted)]">
                    {companyDoc.label}
                  </span>
                  <input
                    className={inputClass}
                    placeholder={companyDoc.placeholder}
                    value={form.companyTaxId}
                    onChange={(e) => set('companyTaxId', e.target.value)}
                    onBlur={(e) =>
                      set(
                        'companyTaxId',
                        formatDocument(country, companyDoc.id, e.target.value),
                      )
                    }
                  />
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Email
                </span>
                <input
                  type="email"
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Teléfono
                </span>
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </label>
            </div>

            <AddressLocationFields
              value={{
                street: form.street,
                city: form.city,
                zipCode: form.zipCode,
                latitude: form.latitude,
                longitude: form.longitude,
              }}
              onChange={(next) =>
                setForm((prev) => ({
                  ...prev,
                  street: next.street,
                  city: next.city,
                  zipCode: next.zipCode,
                  latitude: next.latitude,
                  longitude: next.longitude,
                }))
              }
            />

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Zona</span>
              <select
                className={inputClass}
                value={form.zoneId ?? ''}
                onChange={(e) =>
                  set('zoneId', e.target.value ? e.target.value : null)
                }
              >
                <option value="">Sin zona</option>
                {(zonesQuery.data ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                Las zonas se gestionan en Ajustes → Zonas.
              </span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-[var(--text-muted)]">Nota</span>
              <textarea
                className={inputClass}
                rows={2}
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isLead}
                  onChange={(e) => set('isLead', e.target.checked)}
                />
                Lead
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                />
                Activo
              </label>
            </div>

            {mutation.error && (
              <p className="text-sm text-[var(--danger)]">
                {mutation.error.message}
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
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
    )}

    <ScheduleLeadPromptModal
      open={!!schedulePromptClient && !scheduleFormOpen}
      client={schedulePromptClient}
      onDecline={() => setSchedulePromptClient(null)}
      onAccept={() => {
        const lead = schedulePromptClient
        if (!lead) return
        const addr = [lead.street, lead.city].filter(Boolean).join(', ')
        setScheduleDefaults({
          type: 'installation',
          title: `Instalación — ${clientDisplayName(lead)}`,
          clientId: lead.id,
          address: addr,
        })
        setScheduleFormOpen(true)
      }}
    />

    <CalendarEventFormModal
      open={scheduleFormOpen}
      defaults={scheduleDefaults}
      onClose={() => {
        setScheduleFormOpen(false)
        setScheduleDefaults(null)
        setSchedulePromptClient(null)
      }}
    />
    </>
  )
}
