import { useEffect, useState, type InputHTMLAttributes } from 'react'
import {
  currencyFractionDigits,
  formatMoneyAmount,
  parseMoneyInput,
} from '../lib/currency'

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode'
> & {
  /** Canonical numeric string stored by the form (e.g. "19990" or "1250.5"). */
  value: string
  onChange: (numeric: string) => void
  currency: string
}

/**
 * Text input that shows locale-correct grouping/decimals for the company
 * currency (CLP → 19.990, EUR → 1.250,50) while keeping a plain number for the API.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  onBlur,
  onFocus,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (focused) return
    setDraft(value === '' ? '' : formatMoneyAmount(value, currency))
  }, [value, currency, focused])

  const display = focused
    ? draft
    : value === ''
      ? ''
      : formatMoneyAmount(value, currency)

  const digits = currencyFractionDigits(currency)

  return (
    <input
      {...rest}
      type="text"
      inputMode={digits === 0 ? 'numeric' : 'decimal'}
      value={display}
      onFocus={(e) => {
        setFocused(true)
        setDraft(value === '' ? '' : formatMoneyAmount(value, currency))
        onFocus?.(e)
      }}
      onChange={(e) => {
        const next = e.target.value
        setDraft(next)
        const parsed = parseMoneyInput(next, currency)
        if (parsed == null) {
          if (!next.trim()) onChange('')
          return
        }
        onChange(String(parsed))
      }}
      onBlur={(e) => {
        setFocused(false)
        const parsed = parseMoneyInput(draft, currency)
        if (parsed == null) {
          onChange('')
          setDraft('')
        } else {
          onChange(String(parsed))
          setDraft(formatMoneyAmount(parsed, currency))
        }
        onBlur?.(e)
      }}
    />
  )
}
