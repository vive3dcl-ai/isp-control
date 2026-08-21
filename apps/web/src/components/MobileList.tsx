import type { HTMLAttributes, ReactNode } from 'react'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** Lista vertical de tarjetas — solo móvil/tablet (&lt; md). */
export function MobileList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cx('space-y-3 md:hidden', className)}>{children}</div>
}

/** Tarjeta de fila para listas en móvil. */
export function MobileListCard({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cx(
        'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5',
        className,
      )}
      {...rest}
    >
      {children}
    </article>
  )
}

export function MobileListEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
      {children}
    </p>
  )
}

/** Contenedor de tabla — oculto en móvil para evitar scroll horizontal. */
export function DesktopTableWrap({
  children,
  className,
  bordered = true,
}: {
  children: ReactNode
  className?: string
  /** false cuando ya hay borde en la section padre (p. ej. TR069). */
  bordered?: boolean
}) {
  return (
    <div
      className={cx(
        'hidden overflow-x-auto md:block',
        bordered && 'rounded-xl border border-[var(--border)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Meta secundaria en tarjeta (una o dos líneas). */
export function MobileListMeta({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cx(
        'mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
