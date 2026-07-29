/**
 * OLT product images for dashboard cards.
 * ZTE: existing CDN catalog. Huawei: local SVG placeholder under /public/olt.
 */

const SMARTOLT_IMG_BASE = 'https://raio.smartolt.com/content/img'

const BY_SUBTYPE: Record<string, string> = {
  zte_c220: 'ZTE-C220.png',
  zte_c300: 'ZTE-C300.png',
  zte_c320: 'ZTE-C320.png',
  zte_c350: 'ZTE-C350.png',
  zte_c3xx: 'ZTE-C320.png',
  zte_c610: 'ZTE-C320.png',
  zte_c620: 'ZTE-C320.png',
  zte_c650: 'ZTE-C320.png',
  zte_c600: 'ZTE-C320.png',
  zte_c680: 'ZTE-C320.png',
  huawei_ma5608t: 'huawei-olt.svg',
  huawei_ma5683t: 'huawei-olt.svg',
  huawei_ma5680t: 'huawei-olt.svg',
  huawei_ma5800_x2: 'huawei-olt.svg',
  huawei_ma5800_x7: 'huawei-olt.svg',
  huawei_ma5800_x15: 'huawei-olt.svg',
  huawei_ma5800_x17: 'huawei-olt.svg',
}

const BY_PRODUCT: Array<{ match: RegExp; file: string }> = [
  { match: /c350m/i, file: 'ZTE-C350M.png' },
  { match: /c350/i, file: 'ZTE-C350.png' },
  { match: /c320/i, file: 'ZTE-C320.png' },
  // C6xx before C300 so C600 ≠ C300
  { match: /c680|c650|c620|c610|c600/i, file: 'ZTE-C320.png' },
  { match: /c300/i, file: 'ZTE-C300.png' },
  { match: /c220/i, file: 'ZTE-C220.png' },
  { match: /ma5800|ma5608|ma5680|ma5683|huawei/i, file: 'huawei-olt.svg' },
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

function isLocalAsset(file: string) {
  return file.endsWith('.svg') || file.startsWith('huawei')
}

/** Primary image URL (CDN for ZTE PNGs; local for Huawei). */
export function oltBoardImageUrl(
  subtype?: string | null,
  boardName?: string | null,
): string {
  const file = resolveFile(subtype, boardName)
  if (isLocalAsset(file)) return `/olt/${file}`
  return `${SMARTOLT_IMG_BASE}/${file}`
}

/** Local mirror under /public/olt. */
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
  'huawei-olt.svg',
] as const
