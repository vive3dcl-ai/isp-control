import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import {
  chargeKindLabel,
  chargeStatusLabel,
  formatDate,
  formatUsd,
  type ExtraBlocksQuote,
  type PlanChangeQuote,
  type PlatformChargeRow,
  type TenantSubscription,
  type UserPlanCode,
} from '../lib/platform'
import {
  DesktopTableWrap,
  MobileList,
  MobileListCard,
  MobileListMeta,
} from './MobileList'

export function SuscripcionSettingsPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<UserPlanCode | ''>('')
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null)
  const [blocksInput, setBlocksInput] = useState(0)
  const [blocksQuote, setBlocksQuote] = useState<ExtraBlocksQuote | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'subscription'],
    queryFn: () =>
      apiFetch<TenantSubscription>('/app/settings/subscription'),
  })

  const sub = query.data
  const charges = sub?.charges ?? []
  const pending = charges.find((c) => c.canPay)
  const currentCode = (sub?.planCode ?? sub?.billingCycle ?? null) as
    | UserPlanCode
    | null

  useEffect(() => {
    if (!sub) return
    setSelected(currentCode ?? '')
    setBlocksInput(sub.extraBlocks ?? 0)
  }, [sub, currentCode])

  useEffect(() => {
    if (!selected || !canWrite || sub?.isInternalCompany) {
      setQuote(null)
      return
    }
    if (
      currentCode === selected &&
      (sub?.status === 'active' ||
        sub?.status === 'lifetime' ||
        sub?.status === 'internal')
    ) {
      setQuote(null)
      return
    }
    let cancelled = false
    void apiFetch<PlanChangeQuote>(
      `/app/settings/subscription/quote?code=${selected}`,
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
  }, [selected, canWrite, currentCode, sub?.status, sub?.isInternalCompany])

  useEffect(() => {
    if (
      !canWrite ||
      !currentCode ||
      sub?.status === 'none' ||
      sub?.isInternalCompany ||
      sub?.isLifetime ||
      sub?.status === 'lifetime'
    ) {
      setBlocksQuote(null)
      return
    }
    if (blocksInput === (sub?.extraBlocks ?? 0)) {
      setBlocksQuote(null)
      return
    }
    let cancelled = false
    void apiFetch<ExtraBlocksQuote>(
      `/app/settings/subscription/extra-blocks/quote?blocks=${blocksInput}`,
    )
      .then((q) => {
        if (!cancelled) setBlocksQuote(q)
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setBlocksQuote(null)
          setMsg(err.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    blocksInput,
    canWrite,
    currentCode,
    sub?.extraBlocks,
    sub?.status,
    sub?.isInternalCompany,
    sub?.isLifetime,
  ])

  const planMutation = useMutation({
    mutationFn: () =>
      apiFetch('/app/settings/subscription/change-plan', {
        method: 'POST',
        body: JSON.stringify({ code: selected }),
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

  const blocksMutation = useMutation({
    mutationFn: () =>
      apiFetch('/app/settings/subscription/extra-blocks', {
        method: 'POST',
        body: JSON.stringify({ blocks: blocksInput }),
      }),
    onSuccess: () => {
      setMsg('Usuarios extra actualizados')
      setBlocksQuote(null)
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
    sub?.status === 'internal' || sub?.isInternalCompany
      ? 'Empresa interna'
      : sub?.status === 'lifetime' || sub?.isLifetime
        ? 'Lifetime'
        : sub?.status === 'active'
          ? 'Activa'
          : sub?.status === 'past_due'
            ? 'En mora'
            : 'Sin plan'

  const isInternal = !!(sub?.isInternalCompany || sub?.status === 'internal')
  const isLifetime = !!(sub?.isLifetime || sub?.status === 'lifetime')
  const blockSize = sub?.extraBlockSize ?? 50
  const invoiceOverdue = !!sub?.invoiceOverdue
  const accessBlocked = !!sub?.accessBlocked
  const graceDaysLeft =
    sub?.graceEndsAt != null
      ? Math.max(
          0,
          Math.ceil(
            (new Date(sub.graceEndsAt).getTime() - Date.now()) / 86_400_000,
          ),
        )
      : null

  return (
    <div>
      {!isInternal && (
        <p className="mb-5 text-sm text-[var(--text-muted)]">
          {isLifetime
            ? 'Plan Lifetime: pago único sin renovación mensual. El cupo queda activo de forma permanente.'
            : `Suscripción mensual por aniversario de contrato (cupo de ONUs). La factura se genera ${sub?.invoiceLeadDays ?? 10} días antes del vencimiento; tienes ${sub?.graceDays ?? 5} días de gracia tras vencer. Puedes sumar usuarios extra en bloques de ${blockSize}.`}
        </p>
      )}

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      {invoiceOverdue && !accessBlocked && (
        <div className="mb-5 rounded-xl border-2 border-amber-400/60 bg-amber-500/15 px-4 py-4 text-sm text-amber-50">
          <p className="font-semibold text-amber-100">
            Factura vencida — período de gracia
          </p>
          <p className="mt-1 text-amber-50/90">
            Paga antes del{' '}
            {sub?.graceEndsAt
              ? formatDate(sub.graceEndsAt)
              : 'fin de la gracia'}
            {graceDaysLeft != null ? (
              <>
                {' '}
                ({graceDaysLeft} día{graceDaysLeft === 1 ? '' : 's'} restante
                {graceDaysLeft === 1 ? '' : 's'})
              </>
            ) : null}{' '}
            para evitar el bloqueo del panel.
          </p>
        </div>
      )}

      {accessBlocked && (
        <div className="mb-5 rounded-xl border-2 border-red-400/50 bg-red-500/10 px-4 py-4 text-sm text-red-100">
          <p className="font-semibold">Acceso bloqueado por mora</p>
          <p className="mt-1 opacity-90">
            La gracia terminó. Paga las facturas pendientes para recuperar el
            panel.
          </p>
        </div>
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
            msg.includes('actualizado') ||
            msg.includes('renovada') ||
            msg.includes('extra')
              ? 'text-emerald-400'
              : 'text-[var(--danger)]'
          }`}
        >
          {msg}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Estado actual</h3>
            <span
              className={[
                'rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
                isInternal
                  ? 'bg-sky-500/15 text-sky-300'
                  : isLifetime || sub?.status === 'active'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : sub?.status === 'past_due'
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-zinc-500/15 text-zinc-400',
              ].join(' ')}
            >
              {statusLabel}
            </span>
          </div>

          {isInternal ? (
            <p className="text-sm text-[var(--text-muted)]">
              Acceso permanente sin facturación de plataforma.
            </p>
          ) : currentCode ? (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-muted)]">Plan</dt>
                <dd className="text-right font-medium">
                  {sub?.plans.find((p) => p.code === currentCode)?.label ??
                    currentCode}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text-muted)]">ONUs / cupo</dt>
                <dd className="text-right font-medium">
                  {sub?.onuUsed ?? 0} / {sub?.onuLimit ?? '—'}
                </dd>
              </div>
              {!isLifetime && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Bloques extra</dt>
                  <dd className="text-right">
                    {sub?.extraBlocks ?? 0} × {blockSize} ={' '}
                    {(sub?.extraBlocks ?? 0) * blockSize} usuarios
                  </dd>
                </div>
              )}
              {!isLifetime && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Período</dt>
                  <dd className="text-right">
                    {formatDate(sub?.periodStart)} → {formatDate(sub?.periodEnd)}
                  </dd>
                </div>
              )}
              {sub?.daysUntilEnd != null && sub.status === 'active' && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Vigencia</dt>
                  <dd className="text-right">
                    {sub.daysUntilEnd >= 0
                      ? `${sub.daysUntilEnd} días restantes`
                      : `vencida hace ${Math.abs(sub.daysUntilEnd)} días`}
                  </dd>
                </div>
              )}
              {!isLifetime && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Mensual base</dt>
                  <dd className="text-right font-medium">
                    {formatUsd(sub?.baseMonthlyUsd)}
                  </dd>
                </div>
              )}
              {sub && sub.recurringModules.length > 0 && !isLifetime && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text-muted)]">Módulos</dt>
                  <dd className="text-right">
                    {formatUsd(sub.modulesMonthlyUsd)}/mes
                  </dd>
                </div>
              )}
              {sub?.nextCycleEstimateUsd != null && (
                <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-2.5">
                  <dt className="text-[var(--text-muted)]">
                    Estimado próximo mes
                  </dt>
                  <dd className="text-right font-semibold">
                    {formatUsd(sub.nextCycleEstimateUsd)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Aún no tienes un plan contratado. Elige uno a la derecha.
            </p>
          )}
        </section>

        <section className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
          <h3 className="mb-4 text-sm font-semibold">
            {isInternal
              ? 'Plan'
              : currentCode
                ? 'Cambiar plan'
                : 'Contratar plan'}
          </h3>

          {isInternal ? (
            <p className="text-sm text-[var(--text-muted)]">
              Este es una empresa interna de ISPControl
            </p>
          ) : (
            <>
              <label className="mb-3 block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Plan (usuarios / ONUs)
                </span>
                <select
                  disabled={!canWrite || planMutation.isPending}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                  value={selected}
                  onChange={(e) => {
                    setMsg(null)
                    setSelected(e.target.value as UserPlanCode | '')
                  }}
                >
                  <option value="">Selecciona un plan…</option>
                  {(sub?.plans ?? []).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label} ·{' '}
                      {p.isFree
                        ? 'Gratis'
                        : p.isLifetime || p.code === 'lifetime'
                          ? `${formatUsd(p.priceUsd)} pago único`
                          : `${formatUsd(p.priceUsd)}/mes`}
                    </option>
                  ))}
                </select>
              </label>

              {quote ? (
                <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
                  <div className="flex justify-between gap-4">
                    <span>
                      Plan <strong>{quote.label}</strong>
                    </span>
                    <span>
                      {quote.isLifetime || selected === 'lifetime'
                        ? `${formatUsd(quote.chargeUsd)} pago único`
                        : `${formatUsd(quote.newMonthlyUsd)}/mes`}
                    </span>
                  </div>
                  {!(quote.isLifetime || selected === 'lifetime') && (
                    <>
                      <div className="mt-1 flex justify-between gap-4">
                        <span>Crédito período actual</span>
                        <span>{formatUsd(quote.creditUsd)}</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-4 border-t border-sky-500/20 pt-1 font-semibold">
                        <span>A cobrar ahora (prorrateo)</span>
                        <span>{formatUsd(quote.chargeUsd)}</span>
                      </div>
                    </>
                  )}
                  {(quote.isLifetime || selected === 'lifetime') && (
                    <div className="mt-1 flex justify-between gap-4 border-t border-sky-500/20 pt-1 font-semibold">
                      <span>A cobrar ahora</span>
                      <span>{formatUsd(quote.chargeUsd)}</span>
                    </div>
                  )}
                  <p className="mt-2 text-xs opacity-80">
                    {quote.note ??
                      (quote.isLifetime || selected === 'lifetime'
                        ? 'Pago único sin renovaciones.'
                        : `Hasta ${formatDate(quote.periodEnd)} · cupo ${quote.onuLimit} (usas ${quote.onuUsed})`)}
                  </p>
                </div>
              ) : (
                <p className="mb-4 flex-1 text-xs text-[var(--text-muted)]">
                  Elige un plan distinto al actual para ver el cobro
                  prorrateado.
                </p>
              )}

              {canWrite && (
                <button
                  type="button"
                  disabled={
                    !selected ||
                    planMutation.isPending ||
                    (currentCode === selected &&
                      (sub?.status === 'active' ||
                        sub?.status === 'lifetime' ||
                        sub?.status === 'past_due'))
                  }
                  onClick={() => planMutation.mutate()}
                  className="mt-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {planMutation.isPending
                    ? 'Procesando…'
                    : sub?.status === 'active' ||
                        sub?.status === 'lifetime' ||
                        sub?.status === 'past_due'
                      ? 'Cambiar plan'
                      : 'Contratar plan'}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {!isInternal &&
        !isLifetime &&
        currentCode &&
        (sub?.status === 'active' || sub?.status === 'past_due') && (
          <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Usuarios extra</h3>
            <p className="mb-4 text-xs text-[var(--text-muted)]">
              Bloques de {blockSize} ONUs a {formatUsd(sub?.extraBlockPriceUsd)}
              /mes cada uno. Puedes subir o bajar solo si tu cantidad de ONUs
              cabe en el nuevo cupo.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--text-muted)]">
                  Bloques extra
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  disabled={!canWrite || blocksMutation.isPending}
                  className="w-28 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                  value={blocksInput}
                  onChange={(e) => {
                    setMsg(null)
                    setBlocksInput(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                  }}
                />
              </label>
              <p className="pb-2.5 text-sm text-[var(--text-muted)]">
                = {blocksInput * blockSize} usuarios extra · cupo total{' '}
                {(sub?.plans.find((p) => p.code === currentCode)?.userLimit ??
                  0) +
                  blocksInput * blockSize}
              </p>
              {canWrite && (
                <button
                  type="button"
                  disabled={
                    blocksMutation.isPending ||
                    blocksInput === (sub?.extraBlocks ?? 0) ||
                    !blocksQuote
                  }
                  onClick={() => blocksMutation.mutate()}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
                >
                  {blocksMutation.isPending
                    ? 'Aplicando…'
                    : blocksInput > (sub?.extraBlocks ?? 0)
                      ? 'Agregar usuarios'
                      : 'Bajar usuarios'}
                </button>
              )}
            </div>
            {blocksQuote && (
              <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
                <div className="flex justify-between gap-4">
                  <span>Nuevo mensual base</span>
                  <span>{formatUsd(blocksQuote.newMonthlyUsd)}</span>
                </div>
                {blocksQuote.chargeUsd > 0 && (
                  <div className="mt-1 flex justify-between gap-4 font-semibold">
                    <span>A cobrar ahora</span>
                    <span>{formatUsd(blocksQuote.chargeUsd)}</span>
                  </div>
                )}
                {blocksQuote.creditUsd > 0 && (
                  <div className="mt-1 flex justify-between gap-4">
                    <span>Crédito</span>
                    <span>{formatUsd(blocksQuote.creditUsd)}</span>
                  </div>
                )}
                <p className="mt-2 text-xs opacity-80">{blocksQuote.note}</p>
              </div>
            )}
          </section>
        )}

      {!isInternal && (
        <ChargesHistory
          charges={charges}
          canWrite={canWrite}
          paying={payMutation.isPending}
          onPay={(id) => payMutation.mutate(id)}
        />
      )}
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
        Renovaciones, altas, cambios de plan, bloques extra y módulos.
      </p>

      {charges.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Aún no hay cobros registrados.
        </p>
      ) : (
        <>
          <MobileList>
            {charges.map((c) => (
              <MobileListCard
                key={c.id}
                className={c.canPay ? 'bg-amber-500/5' : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{c.description}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {chargeKindLabel(c.kind)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium">
                    {formatUsd(c.amountUsd)}
                  </span>
                </div>
                <MobileListMeta>
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
                  <span>·</span>
                  <span>
                    {c.coversFrom && c.coversTo
                      ? `${formatDate(c.coversFrom)} → ${formatDate(c.coversTo)}`
                      : 'Sin ciclo'}
                  </span>
                  <span>·</span>
                  <span>
                    {c.paidAt
                      ? `Pagado ${formatDate(c.paidAt)}`
                      : c.dueAt
                        ? `Vence ${formatDate(c.dueAt)}`
                        : formatDate(c.createdAt)}
                  </span>
                </MobileListMeta>
                {c.canPay && canWrite && (
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={paying}
                      onClick={() => onPay(c.id)}
                      className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-60"
                    >
                      Pagar
                    </button>
                  </div>
                )}
              </MobileListCard>
            ))}
          </MobileList>

          <DesktopTableWrap>
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
          </DesktopTableWrap>
        </>
      )}
    </div>
  )
}
