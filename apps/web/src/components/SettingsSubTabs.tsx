type TabItem<T extends string> = {
  id: T
  label: string
}

/** Shared underline sub-tabs used across Ajustes sections. */
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
      className="flex flex-wrap gap-4 border-b border-[var(--border)]"
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
              '-mb-px border-b-2 pb-2 text-sm font-medium',
              active
                ? 'border-[var(--accent)] text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
