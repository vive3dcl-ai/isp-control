import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import type { TenantModuleCard } from '../lib/modules'
import { WhatsAppConfigModal } from './WhatsAppConfigModal'

/**
 * Banner + modal si Baileys necesita QR / está desconectado.
 * Solo para usuarios tenant con módulo whatsapp contratado.
 */
export function WhatsAppAttentionBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [open, setOpen] = useState(false)

  const query = useQuery({
    queryKey: ['app', 'settings', 'modules'],
    queryFn: () => apiFetch<TenantModuleCard[]>('/app/settings/modules'),
    refetchInterval: 60_000,
  })

  const wa = query.data?.find((m) => m.id === 'whatsapp')
  const show =
    !!wa?.contracted && !!wa.needsAttention && !dismissed && !open

  if (!show && !open) return null

  return (
    <>
      {show && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-amber-100">
                WhatsApp Baileys requiere atención
              </p>
              <p className="mt-1 text-xs text-amber-100/80">
                La sesión se desconectó o hay que escanear el QR de nuevo. También
                se envió un aviso al correo del administrador (si SMTP está
                configurado).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Reconectar
              </button>
              <Link
                to="/app/settings?section=integraciones"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)]"
              >
                Integraciones
              </Link>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)]"
              >
                Ahora no
              </button>
            </div>
          </div>
        </div>
      )}
      <WhatsAppConfigModal
        open={open}
        canWrite
        onClose={() => {
          setOpen(false)
          void query.refetch()
        }}
      />
    </>
  )
}
