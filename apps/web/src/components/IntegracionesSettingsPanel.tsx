import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import {
  formatModulePrice,
  type TenantModuleCard,
} from '../lib/modules'
import { formatDate } from '../lib/platform'
import { SmtpConfigModal } from './SmtpConfigModal'
import { MercadoPagoConfigModal } from './MercadoPagoConfigModal'
import { WhatsAppConfigModal } from './WhatsAppConfigModal'
import { AsistenteIaConfigModal } from './AsistenteIaConfigModal'
import { ContractModuleModal } from './ContractModuleModal'

export function IntegracionesSettingsPanel({ canWrite }: { canWrite: boolean }) {
  const [smtpOpen, setSmtpOpen] = useState(false)
  const [mpOpen, setMpOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [contractId, setContractId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
  })

  const modules = query.data ?? []
  const contractMod = modules.find((m) => m.id === contractId)

  return (
    <div>
      <p className="mb-5 text-sm text-[var(--text-muted)]">
        Todos los módulos aparecen aquí. Si aún no lo contrataste, usa{' '}
        <strong>Contratar</strong>. Cada módulo usa credenciales propias de tu
        cuenta.
      </p>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="mb-4 text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((m) => {
          const price = formatModulePrice(m.priceMonthly, m.priceCurrency)
          const unavailable = m.billable && m.available === false
          return (
            <article
              key={m.id}
              className={[
                'flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4',
                unavailable ? 'opacity-60' : '',
              ].join(' ')}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{m.name}</h3>
                {m.included && (
                  <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Incluido
                  </span>
                )}
                {m.purchased && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                    Comprado
                  </span>
                )}
                {m.canContract && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                    Disponible
                  </span>
                )}
                {m.billable && !m.included && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                    De pago
                  </span>
                )}
                {m.contracted && m.configured && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                    Configurado
                  </span>
                )}
                {m.id === 'whatsapp' && m.needsAttention && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                    Requiere QR
                  </span>
                )}
              </div>
              <p className="mb-2 flex-1 text-xs text-[var(--text-muted)]">
                {m.description}
              </p>
              {unavailable && (
                <p className="mb-2 text-xs text-amber-300">
                  No disponible para el país de tu empresa.
                </p>
              )}
              {m.included && !m.alwaysEnabled && (
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  Incluido por la plataforma · sin cargo adicional
                </p>
              )}
              {price && !m.included && (
                <p className="mb-1 text-xs text-[var(--text-muted)]">
                  {price} / mes
                </p>
              )}
              {m.purchased && m.contract?.mode === 'one_time' && m.contract.expiresAt && (
                <p className="mb-2 text-xs text-amber-200">
                  Pago único · vence {formatDate(m.contract.expiresAt)}
                </p>
              )}
              {m.purchased && m.contract?.mode === 'recurring' && (
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  En tu plan de suscripción
                </p>
              )}
              <div className="mt-auto flex justify-end gap-2">
                {m.canContract && canWrite && (
                  <button
                    type="button"
                    onClick={() => setContractId(m.id)}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    Contratar
                  </button>
                )}
                {m.canConfigure && (
                  <button
                    type="button"
                    onClick={() => {
                      if (m.id === 'smtp') setSmtpOpen(true)
                      if (m.id === 'mercadopago') setMpOpen(true)
                      if (m.id === 'whatsapp') setWaOpen(true)
                      if (m.id === 'asistente_ia') setAiOpen(true)
                    }}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-elevated)]"
                  >
                    Configurar
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <SmtpConfigModal
        open={smtpOpen}
        canWrite={canWrite}
        onClose={() => setSmtpOpen(false)}
      />
      <MercadoPagoConfigModal
        open={mpOpen}
        canWrite={canWrite}
        scope={{ kind: 'tenant' }}
        onClose={() => setMpOpen(false)}
      />
      <WhatsAppConfigModal
        open={waOpen}
        canWrite={canWrite}
        onClose={() => setWaOpen(false)}
      />
      <AsistenteIaConfigModal
        open={aiOpen}
        canWrite={canWrite}
        onClose={() => setAiOpen(false)}
      />
      {contractMod && (
        <ContractModuleModal
          open={!!contractId}
          moduleId={contractMod.id}
          moduleName={contractMod.name}
          canWrite={canWrite}
          onClose={() => setContractId(null)}
        />
      )}
    </div>
  )
}
