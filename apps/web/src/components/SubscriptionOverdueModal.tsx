import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSubscriptionAccess } from '../auth/useSubscriptionAccess'
import { formatDate, formatUsd } from '../lib/platform'
import {
  ModalShell,
  modalBodyClass,
  modalFooterClass,
  modalHeaderClass,
} from './ModalShell'

const DISMISS_PREFIX = 'isp-sub-overdue-dismiss:'

function dismissKey(chargeId: string) {
  return `${DISMISS_PREFIX}${chargeId}`
}

/**
 * Modal molesto pero cerrable cuando la factura de renovación ya venció
 * y aún hay días de gracia (el panel sigue usable).
 */
export function SubscriptionOverdueModal() {
  const { invoiceOverdue, subscription, enabled } = useSubscriptionAccess()
  const charge = subscription?.pendingCharge
  const chargeId = charge?.id ?? subscription?.pendingChargeId ?? null
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!enabled || !invoiceOverdue || !chargeId) {
      setOpen(false)
      return
    }
    try {
      if (sessionStorage.getItem(dismissKey(chargeId)) === '1') {
        setOpen(false)
        return
      }
    } catch {
      /* ignore */
    }
    setOpen(true)
  }, [enabled, invoiceOverdue, chargeId])

  function dismiss() {
    if (chargeId) {
      try {
        sessionStorage.setItem(dismissKey(chargeId), '1')
      } catch {
        /* ignore */
      }
    }
    setOpen(false)
  }

  if (!open || !invoiceOverdue) return null

  const amount = charge?.amountUsd
  const due = charge?.dueAt ?? subscription?.periodEnd
  const graceEnds = subscription?.graceEndsAt
  const daysLeft =
    graceEnds != null
      ? Math.max(
          0,
          Math.ceil(
            (new Date(graceEnds).getTime() - Date.now()) / 86_400_000,
          ),
        )
      : subscription?.graceDays ?? 5

  return (
    <ModalShell
      open={open}
      onClose={dismiss}
      panelClassName="max-w-md"
      labelledBy="subscription-overdue-title"
    >
      <div className={modalHeaderClass}>
        <h2
          id="subscription-overdue-title"
          className="text-base font-semibold text-[var(--text)]"
        >
          Factura de suscripción vencida
        </h2>
      </div>
      <div className={modalBodyClass}>
        <p className="text-sm text-[var(--text-muted)]">
          Tu renovación de plataforma está vencida
          {due ? <> desde el {formatDate(due)}</> : null}
          {amount != null ? (
            <>
              {' '}
              · <strong className="text-[var(--text)]">{formatUsd(amount)}</strong>
            </>
          ) : null}
          .
        </p>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Tienes{' '}
          <strong className="text-amber-200">
            {daysLeft} día{daysLeft === 1 ? '' : 's'} de gracia
          </strong>
          {graceEnds ? <> (hasta {formatDate(graceEnds)})</> : null}. Si no
          pagas a tiempo, el panel se bloqueará hasta regularizar.
        </p>
      </div>
      <div className={modalFooterClass}>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Cerrar
        </button>
        <Link
          to="/app/settings?tab=empresa&section=suscripcion"
          onClick={dismiss}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-900 hover:bg-amber-300"
        >
          Ir a pagar
        </Link>
      </div>
    </ModalShell>
  )
}
