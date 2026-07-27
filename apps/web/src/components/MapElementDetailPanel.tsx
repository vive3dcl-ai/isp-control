import type { MapElementDetail } from '../lib/map-element-detail'

export function MapElementDetailPanel({
  detail,
  emptyHint = 'Haz clic en un elemento del mapa para ver su detalle.',
}: {
  detail: MapElementDetail | null
  emptyHint?: string
}) {
  if (!detail) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--text-muted)]">
        {emptyHint}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
          {detail.kind}
        </p>
        <h3 className="mt-0.5 text-base font-semibold text-[var(--text)]">
          {detail.name}
        </h3>
      </header>

      {detail.fields.length > 0 && (
        <dl className="space-y-2">
          {detail.fields.map((f) => (
            <div
              key={`${f.label}:${f.value}`}
              className="flex items-start justify-between gap-3 text-sm"
            >
              <dt className="shrink-0 text-[var(--text-muted)]">{f.label}</dt>
              <dd className="text-right break-words text-[var(--text)]">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {detail.sections.map((section) => (
        <section key={section.title} className="space-y-1.5">
          <h4 className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
            {section.title}
          </h4>
          {section.items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Ninguno</p>
          ) : (
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <li
                  key={`${section.title}:${item}`}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs leading-snug text-[var(--text)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
