/** Select de modelo + opción de escribir uno custom si no está en la lista. */

export function AiModelPicker({
  value,
  onChange,
  models,
  loading,
  live,
  warning,
  error,
  disabled,
  className,
}: {
  value: string
  onChange: (model: string) => void
  models: string[]
  loading?: boolean
  live?: boolean
  warning?: string | null
  error?: string | null
  disabled?: boolean
  className?: string
}) {
  const inList = value !== '' && models.includes(value)
  const options =
    value && !inList ? [value, ...models.filter((m) => m !== value)] : models

  return (
    <div className="space-y-1">
      <select
        className={className}
        value={inList || options.includes(value) ? value : ''}
        disabled={disabled || loading}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom__') return
          onChange(v)
        }}
      >
        <option value="" disabled>
          {loading ? 'Cargando modelos…' : 'Selecciona un modelo'}
        </option>
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        className={className}
        value={value}
        disabled={disabled}
        placeholder="O escribe el id del modelo"
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-[var(--text-muted)]">
        {loading
          ? 'Consultando modelos del proveedor…'
          : live
            ? `${models.length} modelos desde la API`
            : models.length
              ? 'Lista sugerida (sin respuesta live de la API)'
              : 'Sin modelos — pega una API key válida'}
      </p>
      {warning && (
        <p className="text-xs text-[var(--text-muted)]">{warning}</p>
      )}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  )
}
