import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch, type LoginResponse } from '../lib/api'
import {
  ModalShell,
  modalBodyClass,
  modalFooterClass,
  modalHeaderClass,
} from './ModalShell'

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-2'

export function AccountSettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { user, applySession } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [profileOk, setProfileOk] = useState<string | null>(null)
  const [passwordOk, setPasswordOk] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setName(user.name || '')
    setEmail(user.email || '')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setProfileError(null)
    setPasswordError(null)
    setProfileOk(null)
    setPasswordOk(null)
  }, [open, user])

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault()
    setProfileError(null)
    setProfileOk(null)
    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    if (trimmedName.length < 2) {
      setProfileError('El nombre debe tener al menos 2 caracteres')
      return
    }
    if (!trimmedEmail.includes('@')) {
      setProfileError('Correo inválido')
      return
    }
    setSavingProfile(true)
    try {
      const result = await apiFetch<LoginResponse>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
      })
      applySession(result)
      setProfileOk('Datos actualizados')
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : 'No se pudo guardar',
      )
    } finally {
      setSavingProfile(false)
    }
  }

  async function onSavePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordOk(null)
    if (newPassword.length < 8) {
      setPasswordError('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('La confirmación no coincide')
      return
    }
    if (currentPassword === newPassword) {
      setPasswordError('La nueva contraseña debe ser distinta a la actual')
      return
    }
    setSavingPassword(true)
    try {
      await apiFetch<{ ok: true }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOk('Contraseña actualizada')
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'No se pudo cambiar la contraseña',
      )
    } finally {
      setSavingPassword(false)
    }
  }

  if (!open) return null

  return createPortal(
    <ModalShell
      open={open}
      onClose={onClose}
      zClass="z-[1000]"
      panelClassName="max-w-lg"
      labelledBy="account-settings-title"
    >
      <div className={modalHeaderClass}>
        <div>
          <h2 id="account-settings-title" className="text-lg font-semibold">
            Ajustes de cuenta
          </h2>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Nombre, correo y contraseña
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm transition hover:border-[var(--accent)]"
        >
          Cerrar
        </button>
      </div>

      <div className={modalBodyClass}>
        <form className="space-y-3" onSubmit={onSaveProfile}>
          <p className="text-sm font-medium">Perfil</p>
          <label className="block space-y-1.5">
            <span className="text-xs text-[var(--text-muted)]">Nombre</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-[var(--text-muted)]">Correo</span>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {profileError && (
            <p className="text-sm text-[var(--danger)]">{profileError}</p>
          )}
          {profileOk && (
            <p className="text-sm text-[var(--accent)]">{profileOk}</p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {savingProfile ? 'Guardando…' : 'Guardar perfil'}
            </button>
          </div>
        </form>

        <hr className="my-5 border-[var(--border)]" />

        <form className="space-y-3" onSubmit={onSavePassword}>
          <p className="text-sm font-medium">Cambiar contraseña</p>
          <label className="block space-y-1.5">
            <span className="text-xs text-[var(--text-muted)]">
              Contraseña actual
            </span>
            <input
              type="password"
              className={inputClass}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-[var(--text-muted)]">
              Nueva contraseña
            </span>
            <input
              type="password"
              className={inputClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-[var(--text-muted)]">
              Confirmar nueva contraseña
            </span>
            <input
              type="password"
              className={inputClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          {passwordError && (
            <p className="text-sm text-[var(--danger)]">{passwordError}</p>
          )}
          {passwordOk && (
            <p className="text-sm text-[var(--accent)]">{passwordOk}</p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
            >
              {savingPassword ? 'Actualizando…' : 'Actualizar contraseña'}
            </button>
          </div>
        </form>
      </div>

      <div className={modalFooterClass}>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm transition hover:bg-[var(--bg)]"
        >
          Listo
        </button>
      </div>
    </ModalShell>,
    document.body,
  )
}
