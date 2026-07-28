/** Input de búsqueda en vivo para listas / tarjetas. */
export function ListSearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      className={[
        'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none ring-[var(--accent)] placeholder:text-[var(--text-muted)] focus:ring-2',
        className,
      ].join(' ')}
    />
  )
}

/** True si `query` vacío o aparece en alguno de los textos. */
export function matchesSearch(
  query: string,
  ...parts: Array<string | null | undefined | number | boolean>
) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return parts.some((p) =>
    String(p ?? '')
      .toLowerCase()
      .includes(q),
  )
}
