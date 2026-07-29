import { useState, type FormEvent } from 'react'
import { usePortalAuth } from './PortalAuthContext'
import {
  portalChangePassword,
  portalUpdateMe,
} from '../lib/client-portal'

export function PortalAccountPage() {
  const { user, refresh } = usePortalAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    try {
      await portalUpdateMe({ name, email })
      await refresh()
      setMsg('Perfil actualizado')
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Error')
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    if (newPassword !== confirm) {
      setErr('Las contraseñas no coinciden')
      return
    }
    try {
      await portalChangePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setMsg('Contraseña actualizada')
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Error')
    }
  }

  if (!user) return null

  return (
    <div className="max-w-lg">
      <h1 className="portal-brand mb-1 text-2xl font-semibold">Cuenta</h1>
      <p className="mb-6 text-sm text-[var(--portal-muted)]">
        Ajustes de tu acceso al portal
      </p>
      {msg && <p className="mb-3 text-sm text-emerald-400">{msg}</p>}
      {err && <p className="mb-3 text-sm text-red-400">{err}</p>}

      <form
        onSubmit={saveProfile}
        className="mb-8 space-y-4 rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-elevated)]/60 p-5"
      >
        <h2 className="font-medium">Perfil</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--portal-muted)]">Nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2 outline-none focus:border-[var(--portal-accent)]"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--portal-muted)]">Correo</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2 outline-none focus:border-[var(--portal-accent)]"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-[var(--portal-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Guardar
        </button>
      </form>

      <form
        onSubmit={savePassword}
        className="space-y-4 rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-elevated)]/60 p-5"
      >
        <h2 className="font-medium">Contraseña</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--portal-muted)]">
            Contraseña actual
          </span>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2 outline-none focus:border-[var(--portal-accent)]"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--portal-muted)]">
            Nueva contraseña
          </span>
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2 outline-none focus:border-[var(--portal-accent)]"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--portal-muted)]">Confirmar</span>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-bg)] px-3 py-2 outline-none focus:border-[var(--portal-accent)]"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-[var(--portal-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Cambiar contraseña
        </button>
      </form>
    </div>
  )
}
