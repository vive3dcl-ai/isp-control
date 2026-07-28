import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { OnuDiscoverResponse, OnuDiscoverOnu } from '../lib/onu-connected'
import { ModalPortal } from './ModalPortal'

type Phase = 'loading' | 'prompt' | 'importing' | 'done' | 'error'

export function OnuImportModal({
  oltId,
  oltName,
  open,
  onClose,
}: {
  oltId: string
  oltName?: string
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [discover, setDiscover] = useState<OnuDiscoverResponse | null>(null)
  const [progress, setProgress] = useState(0)
  const [currentIf, setCurrentIf] = useState<string | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!open) return
    cancelRef.current = false
    setPhase('loading')
    setError(null)
    setDiscover(null)
    setProgress(0)
    setCurrentIf(null)

    void (async () => {
      try {
        const data = await apiFetch<OnuDiscoverResponse>('/app/onus/discover', {
          method: 'POST',
          body: JSON.stringify({ oltId }),
        })
        if (cancelRef.current) return
        setDiscover(data)
        if (data.total === 0) {
          setPhase('done')
          return
        }
        setPhase('prompt')
      } catch (e) {
        if (cancelRef.current) return
        setError((e as Error).message)
        setPhase('error')
      }
    })()

    return () => {
      cancelRef.current = true
    }
  }, [open, oltId])

  async function skip() {
    try {
      await apiFetch('/app/onus/import-skip', {
        method: 'POST',
        body: JSON.stringify({ oltId }),
      })
    } catch {
      /* still close */
    }
    onClose()
  }

  async function startImport() {
    if (!discover?.onus.length) return
    setPhase('importing')
    setError(null)
    const list = discover.onus
    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) return
      const snap = list[i] as OnuDiscoverOnu
      setCurrentIf(snap.onuIf)
      setProgress(i)
      try {
        await apiFetch('/app/onus/import-one', {
          method: 'POST',
          body: JSON.stringify({ oltId, ...snap }),
        })
      } catch (e) {
        setError(
          `Error en ${snap.onuIf}: ${(e as Error).message}. Se detuvo en ${i + 1}/${list.length}.`,
        )
        setPhase('error')
        void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
        return
      }
    }
    setProgress(list.length)
    setCurrentIf(null)
    setPhase('done')
    void queryClient.invalidateQueries({ queryKey: ['app', 'onus'] })
    void queryClient.invalidateQueries({
      queryKey: ['app', 'topology', 'device', oltId],
    })
  }

  if (!open) return null

  const total = discover?.total ?? 0
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[95] modal-backdrop flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-4">
      <div className="h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-none border-0 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:rounded-xl sm:border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="border-b border-[var(--border)] px-5 py-3">
          <h3 className="text-lg font-semibold">ONUs conectadas detectadas</h3>
          <p className="text-sm text-[var(--text-muted)]">
            {oltName ?? 'OLT'}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          {phase === 'loading' && (
            <p className="text-[var(--text-muted)]">
              Escaneando ONUs en la OLT… Esto puede tardar un minuto.
            </p>
          )}

          {phase === 'error' && error && (
            <p className="text-[var(--danger)]">{error}</p>
          )}

          {(phase === 'prompt' || phase === 'importing' || phase === 'done') &&
            discover &&
            total > 0 && (
              <>
                <p>
                  Se detectaron <strong>{total}</strong> ONUs en{' '}
                  <strong>{discover.ports.length}</strong> puertos (
                  {discover.online} online).
                </p>
                <div className="max-h-40 overflow-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--bg)] text-[var(--text-muted)]">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">
                          Puerto
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          ONUs
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Online
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {discover.ports.map((p) => (
                        <tr
                          key={p.ifName}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="px-2 py-1 font-mono">{p.ifName}</td>
                          <td className="px-2 py-1 text-right">{p.count}</td>
                          <td className="px-2 py-1 text-right">{p.online}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

          {phase === 'importing' && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>
                  Importando {progress + 1}/{total}
                  {currentIf ? ` · ${currentIf}` : ''}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'done' && total === 0 && (
            <p className="text-[var(--text-muted)]">
              No se detectaron ONUs en esta OLT.
            </p>
          )}

          {phase === 'done' && total > 0 && (
            <p className="text-emerald-500">
              Importación completa: {total} ONUs en la base de datos.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {phase === 'prompt' && (
            <>
              <button
                type="button"
                onClick={() => void skip()}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg)]"
              >
                Ahora no
              </button>
              <button
                type="button"
                onClick={() => void startImport()}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Importar
              </button>
            </>
          )}
          {(phase === 'done' || phase === 'error' || phase === 'loading') && (
            <button
              type="button"
              disabled={phase === 'loading'}
              onClick={() => {
                if (phase === 'done' && total === 0) {
                  void skip()
                  return
                }
                onClose()
              }}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg)] disabled:opacity-50"
            >
              Cerrar
            </button>
          )}
          {phase === 'importing' && (
            <button
              type="button"
              disabled
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 opacity-50"
            >
              Importando…
            </button>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
