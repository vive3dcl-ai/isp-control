import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { Tenant } from '../lib/tenants'
import {
  formatClp,
  formatModulePrice,
  type TenantModuleAdmin,
  type TenantModulesAdminResponse,
} from '../lib/modules'
import {
  ModalShell,
  modalBodyClass,
  modalFooterClass,
  modalHeaderClass,
} from './ModalShell'

export function TenantModulesModal({
  tenant,
  onClose,
}: {
  tenant: Tenant | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [local, setLocal] = useState<TenantModuleAdmin[]>([])
  const [aiInternalEnabled, setAiInternalEnabled] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const open = !!tenant

  const query = useQuery({
    queryKey: ['admin', 'tenants', tenant?.id, 'modules'],
    queryFn: () =>
      apiFetch<TenantModulesAdminResponse>(
        `/admin/tenants/${tenant!.id}/modules`,
      ),
    enabled: open,
  })

  useEffect(() => {
    if (!query.data) return
    setLocal(query.data.modules)
    setAiInternalEnabled(query.data.aiInternalEnabled !== false)
  }, [query.data])

  const asistenteEnabled = !!local.find(
    (m) => m.id === 'asistente_ia' && m.enabled,
  )

  const mutation = useMutation({
    mutationFn: async () => {
      return apiFetch<TenantModulesAdminResponse>(
        `/admin/tenants/${tenant!.id}/modules`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabledModules: local.filter((m) => m.enabled).map((m) => m.id),
            aiInternalEnabled,
          }),
        },
      )
    },
    onSuccess: (data) => {
      setLocal(data.modules)
      setAiInternalEnabled(data.aiInternalEnabled !== false)
      setMsg('Módulos actualizados')
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'tenants', tenant?.id, 'modules'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  function toggle(id: string, enabled: boolean) {
    setMsg(null)
    const mod = local.find((m) => m.id === id)
    if (enabled && mod && mod.available === false) {
      setMsg(mod.unavailableReason || 'Módulo no disponible para esta empresa.')
      return
    }
    setLocal((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled } : m)),
    )
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      panelClassName="max-w-lg"
      labelledBy="tenant-modules-title"
    >
      <div className={modalHeaderClass}>
        <div>
          <h2 id="tenant-modules-title" className="text-lg font-semibold">
            Módulos
          </h2>
          <p className="text-sm text-[var(--text-muted)]">{tenant?.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
        >
          ✕
        </button>
      </div>

      <div className={`${modalBodyClass} space-y-3`}>
        <p className="text-sm text-[var(--text-muted)]">
          Activa o desactiva módulos para esta empresa. Los precios globales se
          configuran en el menú <strong>Módulos</strong>. Mercado Pago (Checkout
          Pro) depende del país de la empresa.
        </p>

        {query.isLoading && (
          <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
        )}
        {query.error && (
          <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
        )}

        <ul className="space-y-2">
          {local.map((m) => {
            const blocked = !m.alwaysEnabled && m.available === false
            return (
              <li
                key={m.id}
                className={[
                  'flex items-start gap-3 rounded-lg border px-3 py-3',
                  blocked
                    ? 'border-[var(--border)] opacity-60'
                    : 'border-[var(--border)]',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={m.enabled && !blocked}
                  disabled={m.alwaysEnabled || mutation.isPending || blocked}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.name}</span>
                    {m.alwaysEnabled && (
                      <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        Obligatorio
                      </span>
                    )}
                    {m.billable && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                        De pago
                      </span>
                    )}
                    {m.id === 'mercadopago' && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                        Checkout Pro
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {m.description}
                  </p>
                  {blocked && m.unavailableReason && (
                    <p className="mt-1 text-xs text-amber-300">
                      {m.unavailableReason}
                    </p>
                  )}
                  {m.billable && (
                    <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                      {m.id === 'mercadopago' ? (
                        <>
                          Precio:{' '}
                          {formatModulePrice(m.priceMonthly, 'USD') ?? '—'}
                          /mes
                          {m.priceClp != null && (
                            <> · ref. {formatClp(m.priceClp)}</>
                          )}
                        </>
                      ) : (
                        <>
                          Precio:{' '}
                          {formatModulePrice(m.priceMonthly, m.priceCurrency) ??
                            '—'}
                          /mes
                        </>
                      )}
                    </p>
                  )}
                  {m.id === 'asistente_ia' && m.enabled && !blocked && (
                    <label className="mt-3 flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={aiInternalEnabled}
                        disabled={mutation.isPending}
                        onChange={(e) => {
                          setMsg(null)
                          setAiInternalEnabled(e.target.checked)
                        }}
                      />
                      <span>
                        <span className="font-medium text-[var(--text)]">
                          Proveedor interno
                        </span>
                        <span className="mt-0.5 block text-[var(--text-muted)]">
                          Si está activo, la empresa puede usar las keys y cupos
                          de Admin → Ajustes → IA. Si no, solo API propia.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {asistenteEnabled && !aiInternalEnabled && (
          <p className="text-xs text-amber-300">
            Con el proveedor interno desactivado, el tenant solo podrá configurar
            API propia en Asistente IA.
          </p>
        )}

        {msg && (
          <p
            className={`text-sm ${msg.includes('actualizados') ? 'text-emerald-400' : 'text-[var(--danger)]'}`}
          >
            {msg}
          </p>
        )}
      </div>

      <div className={modalFooterClass}>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
        >
          Cerrar
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </ModalShell>
  )
}
