/** Parsers and types for ZTE PON port inventory (SmartOLT-style). */

export type PonFamily = 'gpon' | 'epon'

export interface ZtePonPortRaw {
  rack: string
  shelf: string
  slot: string
  port: string
  ifName: string
  boardType: string
  ponType: PonFamily
  adminEnabled: boolean
  /** Link status: Up | Down (English, as SmartOLT) */
  status: 'Up' | 'Down'
  onuOnline: number
  onuTotal: number
  maxOnus: number
  avgSignalDbm: number | null
  description: string | null
  minRangeM: number
  maxRangeM: number
  rogueDetectEnabled: boolean | null
  txPowerDbm: number | null
}

export function isPonLineCard(
  cfgType: string,
  realType: string,
): PonFamily | null {
  const t = (realType || cfgType || '').toUpperCase()
  if (t.startsWith('ET')) return 'epon'
  if (t.startsWith('GT') || t.startsWith('XG')) return 'gpon'
  return null
}

export function buildOltIfName(
  family: PonFamily,
  rack: string,
  shelf: string,
  slot: string,
  port: number,
): string {
  const prefix = family === 'epon' ? 'epon-olt' : 'gpon-olt'
  // ZTE ifName: shelf/slot/port (C220 uses 0/…)
  const a = shelf || rack || '1'
  return `${prefix}_${a}/${slot}/${port}`
}

/** Parse `show gpon onu state gpon-olt_…` footer / rows. */
export function parseOnuStateCounts(text: string): {
  online: number
  total: number
  hasWorking: boolean
} {
  let online = 0
  let total = 0
  let hasWorking = false

  const footer =
    text.match(/ONU\s*Number\s*:\s*(\d+)\s*\/\s*(\d+)/i) ||
    text.match(/online\s*[:=]\s*(\d+).*total\s*[:=]\s*(\d+)/i)
  if (footer) {
    online = Number(footer[1])
    total = Number(footer[2])
    hasWorking = online > 0
    return { online, total, hasWorking }
  }

  for (const line of text.split(/\r?\n/)) {
    if (!/gpon-onu_|epon-onu_/i.test(line)) continue
    total += 1
    if (/\bworking\b/i.test(line)) {
      online += 1
      hasWorking = true
    }
  }

  return { online, total, hasWorking }
}

export function parseAdminShutdown(runConfigText: string): boolean {
  const lines = runConfigText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines) {
    if (/^shutdown$/i.test(line)) return false
    if (/^no\s+shutdown$/i.test(line)) return true
  }
  return true
}

export function parseDescription(runConfigText: string): string | null {
  const m = runConfigText.match(/^\s*description\s+(.+)$/im)
  return m?.[1]?.trim() || null
}

export function parseOpticalTxPower(text: string): number | null {
  const m =
    text.match(/Tx\s*Power\s*[:=]\s*(-?[\d.]+)\s*\(?\s*dbm/i) ||
    text.match(/TxPower\s*[:=]\s*(-?[\d.]+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Average ONU RX from `show pon power onu-rx …` lines. */
export function parseAvgOnuRx(text: string): number | null {
  const vals: number[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/index|----|onu\s*id|power\s*dbm/i.test(line) && !/\d+\.\d+/.test(line)) {
      continue
    }
    const m = line.match(/(-?\d+\.\d+)\s*(?:\(dbm\))?/i)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > -45 && n < 5) vals.push(n)
  }
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
}

export function parseOnuIdsFromState(text: string): string[] {
  const ids: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m =
      line.match(/gpon-onu_[\d/]+:(\d+)/i) ||
      line.match(/epon-onu_[\d/]+:(\d+)/i) ||
      line.match(/^\s*:?(\d+)\s+(?:enable|disable)\b/i)
    if (m) ids.push(m[1])
  }
  return [...new Set(ids)]
}

export function defaultMaxOnus(family: PonFamily): number {
  return family === 'epon' ? 64 : 128
}

export function parseRangeFromConfig(text: string): {
  minRangeM: number
  maxRangeM: number
} {
  const m =
    text.match(/distance\s+(\d+)\s+(\d+)/i) ||
    text.match(/range\s+(\d+)\s+(\d+)/i)
  if (m) {
    return { minRangeM: Number(m[1]), maxRangeM: Number(m[2]) }
  }
  return { minRangeM: 0, maxRangeM: 20000 }
}
