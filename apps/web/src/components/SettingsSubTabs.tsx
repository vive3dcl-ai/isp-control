type TabItem<T extends string> = {
  id: T
  label: string
}

/**
 * Pestañas tipo chips con scroll horizontal (mismo patrón que filtros de Tickets).
 */
export function SettingsSubTabs<T extends string>({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  tabs: readonly TabItem<T>[]
  value: T
  onChange: (id: T) => void
  'aria-label'?: string
}) {
  return (
    <nav
      role="tablist"
      aria-label={ariaLabel}
      className="-mx-1 mb-4 flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-1 touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={[
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition',
              active
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
