import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import {
  chargeKindLabel,
  chargeStatusLabel,
  formatDate,
  formatUsd,
  type BillingCycleId,
  type PlanChangeQuote,
  type PlatformChargeRow,
  type TenantSubscription,
} from '../lib/platform'

export function SuscripcionSettingsPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<BillingCycleId | ''>('')
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'subscription'],
    queryFn: () =>
      apiFetch<TenantSubscription>('/app/settings/subscription'),
  })

  const sub = query.data
  const charges = sub?.charges ?? []
  const pending = charges.find((c) => c.canPay)

  useEffect(() => {
    if (!sub) return
    setSelected(sub.billingCycle ?? '')
  }, [sub])

  useEffect(() => {
    if (!selected || !canWrite) {
      setQuote(null)
      return
    }
    if (sub?.billingCycle === selected && sub.status === 'active') {
      setQuote(null)
      return
    }
    let cancelled = false
    void apiFetch<PlanChangeQuote>(
      `/app/settings/subscription/quote?cycle=${selected}`,
    )
      .then((q) => {
        if (!cancelled) setQuote(q)
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setQuote(null)
          setMsg(err.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selected, canWrite, sub?.billingCycle, sub?.status])

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/app/settings/subscription/change-plan', {
        method: 'POST',
        body: JSON.stringify({ cycle: selected }),
      }),
    onSuccess: () => {
      setMsg('Plan actualizado')
      setQuote(null)
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'subscription'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  const payMutation = useMutation({
    mutationFn: (chargeId: string) =>
      apiFetch(`/app/settings/subscription/charges/${chargeId}/pay`, {
        method: 'POST',
      }),
    onSuccess: () => {
      setMsg('Pago registrado · suscripción renovada')
      void queryClient.invalidateQueries({
        queryKey: ['app', 'settings', 'subscription'],
      })
    },
    onError: (err: Error) => setMsg(err.message),
  })

  const statusLabel =
    sub?.status === 'active'
      ? 'Activa'
      : sub?.status === 'past_due'
        ? 'En mora'
        : 'Sin plan'

  return (
    <div>
      <p className="mb-5 text-sm text-[var(--text-muted)]">
        Plan prepago de la plataforma. 15 días antes del vencimiento se genera
        el cobro de renovación; desde 5 días antes se avisa por correo al admin
        de la empresa.
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      {pending && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-400/60 bg-amber-500/15 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-amber-100">
              Cobro pendiente de pago
            </p>
            <p className="mt-1 text-sm text-amber-50/90">
              {pending.description} · {formatUsd(pending.amountUsd)}
              {pending.dueAt && <> · vence {formatDate(pending.dueAt)}</>}
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              disabled={payMutation.isPending}
              onClick={() => payMutation.mutate(pending.id)}
              className="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-60"
            >
              {payMutation.isPending ? 'Procesando…' : 'Pagar'}
            </button>
          )}
        </div>
      )}

      {msg && (
        <p
          className={`mb-4 text-sm ${
            msg.includes('actualizado') || msg.includes('renovada')
              ? 'text-emerald-400'
              : 'text-[var(--danger)]'
          }`}
        >
          {msg}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Estado actual */}
        <section className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Estado actual</h3>
            <span
              className={[
                'rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
                sub?.status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : sub?.status === 'past_due'
                    ? 'bg-red-500/15 text-red-300'
                    : 'bg-zinc-500/15 text-zinc-400',
              ].join(' ')}
            >
              {statusLabel}
            </span>
          </div>

          {sub?.billingCycle ? (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-muted)]">Plan</dt>
                <dd className="text-right font-medium capitalize">
                  {sub.plans.find((p) => p.cycle === sub.billingCycle)?.label ??
                    sub.billingCycle}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-muted)]">Período</dt>
                <dd className="text-right">
                  {formatDate(sub.periodStart)} → {formatDate(sub.periodEnd)}
                </dd>
              </div>
              {sub.daysUntilEnd != null && sub.status === 'active' && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Vigencia</dt>
                  <dd className="text-right">
                    {sub.daysUntilEnd >= 0
                      ? `${sub.daysUntilEnd} días restantes`
                      : `vencida hace ${Math.abs(sub.daysUntilEnd)} días`}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-muted)]">Pagado este ciclo</dt>
                <dd className="text-right font-medium">
                  {formatUsd(sub.periodPriceUsd)}
                </dd>
              </div>
              {sub.recurringModules.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Módulos en plan</dt>
                  <dd className="text-right">
                    {formatUsd(sub.modulesMonthlyUsd)}/mes
                  </dd>
                </div>
              )}
              {sub.nextCycleEstimateUsd != null && (
                <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-2.5">
                  <dt className="text-[var(--text-muted)]">
                    Estimado próximo ciclo
                  </dt>
                  <dd className="text-right font-semibold">
                    {formatUsd(sub.nextCycleEstimateUsd)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Aún no tienes un plan contratado. Elige uno en la tarjeta de al
              lado.
            </p>
          )}
        </section>

        {/* Cambiar / contratar plan */}
        <section className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
          <h3 className="mb-4 text-sm font-semibold">
            {sub?.billingCycle ? 'Cambiar plan' : 'Contratar plan'}
          </h3>

          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Plan</span>
            <select
              disabled={!canWrite || mutation.isPending}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
              value={selected}
              onChange={(e) => {
                setMsg(null)
                setSelected(e.target.value as BillingCycleId | '')
              }}
            >
              <option value="">Selecciona un plan…</option>
              {(sub?.plans ?? []).map((p) => (
                <option key={p.cycle} value={p.cycle}>
                  {p.label} · {formatUsd(p.priceUsd)} / {p.months}{' '}
                  {p.months === 1 ? 'mes' : 'meses'}
                </option>
              ))}
            </select>
          </label>

          {quote ? (
            <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
              <div className="flex justify-between gap-4">
                <span>
                  Nuevo ciclo <strong>{quote.label}</strong>
                </span>
                <span>{formatUsd(quote.newPriceUsd)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-4">
                <span>Crédito período actual</span>
                <span>{formatUsd(quote.creditUsd)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-4 border-t border-sky-500/20 pt-1 font-semibold">
                <span>A cobrar ahora</span>
                <span>{formatUsd(quote.chargeUsd)}</span>
              </div>
              <p className="mt-2 text-xs opacity-80">
                Vigencia: {formatDate(quote.periodStart)} →{' '}
                {formatDate(quote.periodEnd)}
              </p>
            </div>
          ) : (
            <p className="mb-4 flex-1 text-xs text-[var(--text-muted)]">
              Selecciona un plan para ver el detalle del cobro.
            </p>
          )}

          {canWrite && (
            <button
              type="button"
              disabled={
                !selected ||
                mutation.isPending ||
                (sub?.billingCycle === selected &&
                  (sub.status === 'active' || sub.status === 'past_due'))
              }
              onClick={() => mutation.mutate()}
              className="mt-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {mutation.isPending
                ? 'Procesando…'
                : sub?.status === 'active' || sub?.status === 'past_due'
                  ? 'Cambiar plan'
                  : 'Contratar plan'}
            </button>
          )}
        </section>
      </div>

      <ChargesHistory
        charges={charges}
        canWrite={canWrite}
        paying={payMutation.isPending}
        onPay={(id) => payMutation.mutate(id)}
      />
    </div>
  )
}

function ChargesHistory({
  charges,
  canWrite,
  paying,
  onPay,
}: {
  charges: PlatformChargeRow[]
  canWrite: boolean
  paying: boolean
  onPay: (id: string) => void
}) {
  return (
    <div className="mt-8">
      <h3 className="mb-1 text-sm font-semibold">Historial de cobros</h3>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Renovaciones, altas, cambios de plan y módulos. Los pendientes muestran
        el botón Pagar.
      </p>

      {charges.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Aún no hay cobros registrados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-medium">Concepto</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 text-right font-medium">Monto</th>
                <th className="px-4 py-2.5 font-medium">Ciclo</th>
                <th className="px-4 py-2.5 font-medium">Fecha</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr
                  key={c.id}
                  className={[
                    'border-b border-[var(--border)] last:border-0',
                    c.canPay ? 'bg-amber-500/5' : '',
                  ].join(' ')}
                >
                  <td className="px-4 py-3">{c.description}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {chargeKindLabel(c.kind)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatUsd(c.amountUsd)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {c.coversFrom && c.coversTo
                      ? `${formatDate(c.coversFrom)} → ${formatDate(c.coversTo)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {c.paidAt
                      ? `Pagado ${formatDate(c.paidAt)}`
                      : c.dueAt
                        ? `Vence ${formatDate(c.dueAt)}`
                        : formatDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'rounded px-2 py-0.5 text-[10px] uppercase tracking-wide',
                        c.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-200'
                          : c.status === 'paid' || c.status === 'recorded'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-zinc-500/15 text-zinc-400',
                      ].join(' ')}
                    >
                      {chargeStatusLabel(c.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.canPay && canWrite && (
                      <button
                        type="button"
                        disabled={paying}
                        onClick={() => onPay(c.id)}
                        className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-60"
                      >
                        Pagar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
