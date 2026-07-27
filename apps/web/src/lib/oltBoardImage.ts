/**
 * ZTE OLT product images — SmartOLT catalog
 * https://raio.smartolt.com/content/img/ZTE-C320.png
 *
 * Prefer CDN (same source as SmartOLT). Local /public/olt mirrors are optional.
 */

const SMARTOLT_IMG_BASE = 'https://raio.smartolt.com/content/img'

const BY_SUBTYPE: Record<string, string> = {
  zte_c220: 'ZTE-C220.png',
  zte_c300: 'ZTE-C300.png',
  zte_c320: 'ZTE-C320.png',
  zte_c350: 'ZTE-C350.png',
  zte_c3xx: 'ZTE-C320.png',
}

const BY_PRODUCT: Array<{ match: RegExp; file: string }> = [
  { match: /c350m/i, file: 'ZTE-C350M.png' },
  { match: /c350/i, file: 'ZTE-C350.png' },
  { match: /c320/i, file: 'ZTE-C320.png' },
  { match: /c300/i, file: 'ZTE-C300.png' },
  { match: /c220/i, file: 'ZTE-C220.png' },
]

function resolveFile(
  subtype?: string | null,
  boardName?: string | null,
): string {
  if (subtype && BY_SUBTYPE[subtype]) return BY_SUBTYPE[subtype]
  const label = boardName ?? ''
  for (const row of BY_PRODUCT) {
    if (row.match.test(label)) return row.file
  }
  return 'ZTE-C320.png'
}

/** SmartOLT CDN (primary — works without mounting public/). */
export function oltBoardImageUrl(
  subtype?: string | null,
  boardName?: string | null,
): string {
  return `${SMARTOLT_IMG_BASE}/${resolveFile(subtype, boardName)}`
}

/** Local mirror under /public/olt (when volume is mounted). */
export function oltBoardImageLocalUrl(
  subtype?: string | null,
  boardName?: string | null,
): string {
  return `/olt/${resolveFile(subtype, boardName)}`
}

export const OLT_BOARD_IMAGE_FILES = [
  'ZTE-C220.png',
  'ZTE-C300.png',
  'ZTE-C320.png',
  'ZTE-C350.png',
  'ZTE-C350M.png',
] as const
