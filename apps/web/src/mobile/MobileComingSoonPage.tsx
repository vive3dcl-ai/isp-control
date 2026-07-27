import { Link } from 'react-router-dom'

export function MobileComingSoonPage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
      <p className="mb-2 text-3xl font-semibold tracking-tight">{title}</p>
      <p className="mb-8 max-w-xs text-sm text-[var(--text-muted)]">
        {description}
      </p>
      <Link
        to="/movil"
        className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
      >
        Volver al inicio
      </Link>
    </div>
  )
}
