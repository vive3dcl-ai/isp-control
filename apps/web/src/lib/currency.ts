import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { CompanyProfile } from './company'

/** Locale that matches how each currency is written locally. */
const CURRENCY_LOCALES: Record<string, string> = {
  USD: 'en-US',
  EUR: 'es-ES',
  ARS: 'es-AR',
  BOB: 'es-BO',
  BRL: 'pt-BR',
  CLP: 'es-CL',
  COP: 'es-CO',
  CRC: 'es-CR',
  CUP: 'es-CU',
  DOP: 'es-DO',
  GTQ: 'es-GT',
  HNL: 'es-HN',
  MXN: 'es-MX',
  NIO: 'es-NI',
  PAB: 'es-PA',
  PEN: 'es-PE',
  PYG: 'es-PY',
  UYU: 'es-UY',
  VES: 'es-VE',
}

export function currencyLocale(currency: string): string {
  return CURRENCY_LOCALES[currency] ?? 'es'
}

/** ISO minor units for the currency (CLP/PYG = 0, USD/EUR = 2, …). */
export function currencyFractionDigits(currency: string): number {
  try {
    const opts = new Intl.NumberFormat(currencyLocale(currency), {
      style: 'currency',
      currency,
    }).resolvedOptions()
    return opts.maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? '.',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? ',',
  }
}

/** Company currency from Ajustes → Empresa (shared react-query cache). */
export function useCompanyCurrency(): string {
  const { data } = useQuery({
    queryKey: ['app', 'settings', 'company'],
    queryFn: () => apiFetch<CompanyProfile>('/app/settings/company'),
    staleTime: 5 * 60_000,
  })
  return data?.currency || 'USD'
}

/** Full money display: "$19.990" / "€1.250,50" according to the currency locale. */
export function formatMoney(value: string | number, currency: string): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return String(value)
  try {
    return new Intl.NumberFormat(currencyLocale(currency), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(n)
  } catch {
    const digits = currencyFractionDigits(currency)
    return `${currency} ${n.toFixed(digits)}`
  }
}

/** Numeric amount only (no symbol): "19.990" / "1.250,50". */
export function formatMoneyAmount(
  value: string | number,
  currency: string,
): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return ''
  const digits = currencyFractionDigits(currency)
  return new Intl.NumberFormat(currencyLocale(currency), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n)
}

/**
 * Parse a locale-formatted amount into a finite number.
 * es-CL "19.990" → 19990 · es-ES "1.250,50" → 1250.5 · en-US "1,250.50" → 1250.5
 */
export function parseMoneyInput(
  raw: string,
  currency: string,
): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const locale = currencyLocale(currency)
  const { group, decimal } = separators(locale)
  const digits = currencyFractionDigits(currency)

  // Keep digits, separators, and optional leading minus.
  let s = trimmed.replace(/[^\d.,\-]/g, '')
  if (!s || s === '-' || s === '.' || s === ',') return null

  // Remove thousand separators, then normalize decimal to ".".
  if (group) s = s.split(group).join('')
  if (decimal && decimal !== '.') {
    const i = s.lastIndexOf(decimal)
    if (i >= 0) {
      s = `${s.slice(0, i)}.${s.slice(i + 1).replace(new RegExp(`\\${decimal}`, 'g'), '')}`
    }
  }
  // Drop stray leftover grouping-style dots/commas if any remain as extras.
  const parts = s.split('.')
  if (parts.length > 2) {
    s = `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}`
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null

  if (digits === 0) return Math.round(n)
  const factor = 10 ** digits
  return Math.round(n * factor) / factor
}

/** Returns a formatter bound to the company currency. */
export function useMoney(): (value: string | number) => string {
  const currency = useCompanyCurrency()
  return (value) => formatMoney(value, currency)
}
