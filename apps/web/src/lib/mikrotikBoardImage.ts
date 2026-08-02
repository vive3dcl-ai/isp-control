/**
 * Map MikroTik board-name → product image.
 *
 * Lookup order:
 *  1. solustic SVG stencils (routers + classic CRS)
 *  2. The Dude PNG pack (SOHO routers)
 *  3. Official MikroTik CDN (CRS/CSS switches + modern boards)
 *  4. Family fallback (CRS3xx → CRS326, CSS → CSS610, …)
 *
 * CDN ids scraped from mikrotik.com product pages (rb_images/{id}_lg.webp).
 */

const SOLUSTIC_BASE =
  'https://cdn.jsdelivr.net/gh/solustic/stencils@master/mikrotik'

/** Exact / known board-name fragments → solustic filename (without path) */
const SOLUSTIC_FILES = [
  'Mikrotik_CCR1009-7G-1C-PC.svg',
  'Mikrotik_CCR1009-8G-1S-1S+.svg',
  'Mikrotik_CCR1016-12G.svg',
  'Mikrotik_CCR1016-12S-1S+.svg',
  'Mikrotik_CCR1036-12G-4S.svg',
  'Mikrotik_CCR1036-8G-2S+.svg',
  'Mikrotik_CCR1072-1G-8S+.svg',
  'Mikrotik_CCR2004-1G-12S+2XS.svg',
  'Mikrotik_CRS125-24G-1S-RM.svg',
  'Mikrotik_CRS317-1G-16S+.svg',
  'Mikrotik_CRS326-24G-2S+RM.svg',
  'Mikrotik_CRS326-24S+2Q+RM.svg',
  'Mikrotik_CRS354-48G-4S+2Q+RM.svg',
  'Mikrotik_RB1100AHx4.svg',
  'Mikrotik_RB2011UiAS-2HnD-IN.svg',
  'Mikrotik_RB2011UiAS-IN.svg',
  'Mikrotik_RB2011UiAS-RM.svg',
  'Mikrotik_RB3011UiAS-RM.svg',
] as const

/** Secondary PNGs from The Dude pack (broader coverage of SOHO models) */
const DUDE_BASE =
  'https://cdn.jsdelivr.net/gh/MrakoMaks/Images-for-The-Dude-MikroTik-Ubiquiti@main/Pictures'

const DUDE_FILES = [
  'MikroTIk CCR1016-12G.png',
  'MikroTik CCR1036-12G-4S.png',
  'MikroTik CRS106-1C-5S.png',
  'MikroTik RB2011UiAS-IN.png',
  'MikroTik RB2011iL-IN.png',
  'MikroTik RB2011iLS-IN.png',
  'MikroTik RB3011UiAS-RM.png',
  'MikroTik RB4011iGS.png',
  'MikroTik RB750.png',
  'MikroTik RB951G-2nD.png',
  'MikroTik RB951Ui-2HnD.png',
  'MikroTik hAP (RB951Ui-2nD).png',
  'MikroTik hAP ac lite (RB952Ui-5ac2nD).png',
  'MikroTik hAP lite.png',
  'MikroTik hEX Lite.png',
  'MikroTik hEX Poe Lite.png',
  'MikroTik hEX Poe.png',
  'MikroTik hEX S.png',
  'MikroTik hEX.png',
] as const

const MIKROTIK_CDN_BASE = 'https://cdn.mikrotik.com/web-assets/rb_images'

/**
 * Official product codes → MikroTik CDN image id (`{id}_lg.webp`).
 * Prefer product-code match; covers modern CRS/CSS that solustic lacks.
 */
const MIKROTIK_CDN_PRODUCTS: ReadonlyArray<{ code: string; id: string }> = [
  // Cloud Router Switches
  { code: 'CRS112-8P-4S-IN', id: '1466' },
  { code: 'CRS125-24G-1S-RM', id: '798' },
  { code: 'CRS304-4XG-IN', id: '2369' },
  { code: 'CRS305-1G-4S+IN', id: '1659' },
  { code: 'CRS305-1G-4S+OUT', id: '2218' },
  { code: 'CRS309-1G-8S+IN', id: '1730' },
  { code: 'CRS310-1G-5S-4S+IN', id: '2147' },
  { code: 'CRS310-1G-5S-4S+OUT', id: '2109' },
  { code: 'CRS310-8G+2S+IN', id: '2280' },
  { code: 'CRS312-4C+8XG-RM', id: '1825' },
  { code: 'CRS317-1G-16S+RM', id: '1324' },
  { code: 'CRS318-1Fi-15Fr-2S-OUT', id: '1923' },
  { code: 'CRS318-16P-2S+OUT', id: '1951' },
  { code: 'CRS320-8P-8B-4S+RM', id: '2355' },
  { code: 'CRS326-24G-2S+IN', id: '1938' },
  { code: 'CRS326-24S+2Q+RM', id: '1831' },
  { code: 'CRS326-4C+20G+2Q+RM', id: '2321' },
  { code: 'CRS328-24P-4S+RM', id: '1493' },
  { code: 'CRS328-4C-20S-4S+RM', id: '1526' },
  { code: 'CRS354-48G-4S+2Q+RM', id: '1899' },
  { code: 'CRS354-48P-4S+2Q+RM', id: '1909' },
  { code: 'CRS418-8P-8G-2S+RM', id: '2477' },
  { code: 'CRS418-8P-8G-2S+5axQ2axQ-RM', id: '2490' },
  { code: 'CRS504-4XQ-IN', id: '2156' },
  { code: 'CRS504-4XQ-OUT', id: '2235' },
  { code: 'CRS510-8XS-2XQ-IN', id: '2232' },
  { code: 'CRS518-16XS-2XQ-RM', id: '2196' },
  { code: 'CRS520-4XS-16XQ-RM', id: '2352' },
  { code: 'CRS804-4DDQ-hRM', id: '2549' },
  { code: 'CRS812-8DS-2DQ-2DDQ-RM', id: '2483' },
  // Cloud Smart Switches (SwOS)
  { code: 'CSS318-16G-2S+IN', id: '2423' },
  { code: 'CSS610-8G-2S+IN', id: '1980' },
  { code: 'CSS610-8P-2S+IN', id: '2193' },
  { code: 'CSS610-1Gi-7R-2S+OUT', id: '1973' },
  { code: 'CSS610-8P-2S+OUT', id: '2513' },
  { code: 'CSS606-1G-2Gi-3S+OUT', id: '2494' },
  // Routers that Dude/solustic miss or cover poorly
  { code: 'CCR2004-16G-2S+PC', id: '2634' },
  { code: 'CCR2004-16G-2S+', id: '2563' },
  { code: 'CCR2004-1G-12S+2XS', id: '1935' },
  { code: 'CCR2116-12G-4S+', id: '2625' },
  { code: 'CCR2216-1G-12XS-2XQ', id: '2122' },
  { code: 'RB1100x4', id: '1344' },
  { code: 'RB1100AHx4', id: '1344' },
  { code: 'RB4011iGS+RM', id: '1633' },
  { code: 'RB4011iGS+', id: '1633' },
  { code: 'RB5009UG+S+IN', id: '2065' },
  { code: 'RB5009UPr+S+IN', id: '2190' },
  { code: 'RB5009UPr+S+OUT', id: '2250' },
  { code: 'L009UiGS-RM', id: '2267' },
  { code: 'RB760iGS', id: '1539' },
  { code: 'E50UG', id: '2408' },
  { code: 'E60iUGS', id: '2458' },
]

/** When no exact model is known, pick a representative image for the family. */
const FAMILY_FALLBACKS: ReadonlyArray<{ match: RegExp; id: string }> = [
  { match: /^css6/i, id: '1980' }, // CSS610
  { match: /^css3/i, id: '2423' }, // CSS318
  { match: /^css/i, id: '1980' },
  { match: /^crs5/i, id: '2156' }, // CRS504
  { match: /^crs4/i, id: '2477' }, // CRS418
  { match: /^crs3/i, id: '1938' }, // CRS326
  { match: /^crs2/i, id: '1938' },
  { match: /^crs1/i, id: '798' }, // CRS125
  { match: /^crs/i, id: '1938' },
  { match: /^ccr22/i, id: '2122' },
  { match: /^ccr21/i, id: '2625' },
  { match: /^ccr20/i, id: '1935' },
  { match: /^ccr10/i, id: '1935' },
  { match: /^rb50/i, id: '2065' },
  { match: /^rb40/i, id: '1633' },
]

function normalizeBoard(board: string) {
  return board
    .toLowerCase()
    .replace(/^mikrotik[_\s-]*/i, '')
    .replace(/[^a-z0-9+]/g, '')
}

/** Strip enclosure suffixes so CRS326-24G-2S+ matches …-RM / …-IN. */
function stripVariant(norm: string) {
  return norm.replace(/(rm|in|out|pc|em)$/i, '')
}

function scoreMatch(boardNorm: string, fileLabel: string): number {
  const fileNorm = normalizeBoard(fileLabel)
  if (!boardNorm || !fileNorm) return 0
  if (boardNorm === fileNorm) return 1000

  const boardCore = stripVariant(boardNorm)
  const fileCore = stripVariant(fileNorm)
  if (boardCore && fileCore && boardCore === fileCore) return 900

  if (fileNorm.includes(boardNorm) || boardNorm.includes(fileNorm)) {
    return 500 + Math.min(boardNorm.length, fileNorm.length)
  }
  if (fileCore.includes(boardCore) || boardCore.includes(fileCore)) {
    return 400 + Math.min(boardCore.length, fileCore.length)
  }

  // Token overlap (CRS326, 24G, 2S…)
  const boardTokens = boardNorm.match(/[a-z]+\d+[a-z0-9]*|[a-z]{2,}|\d+[a-z]*/g) ?? []
  let score = 0
  for (const t of boardTokens) {
    if (t.length >= 3 && fileNorm.includes(t)) score += t.length
  }
  return score
}

function bestFile(board: string, files: readonly string[]): string | null {
  const boardNorm = normalizeBoard(board)
  let best: string | null = null
  let bestScore = 0
  for (const file of files) {
    const label = file.replace(/\.(svg|png|jpg|webp)$/i, '')
    const s = scoreMatch(boardNorm, label)
    if (s > bestScore) {
      bestScore = s
      best = file
    }
  }
  // Require a meaningful match (avoid random weak hits)
  if (bestScore < 5) return null
  return best
}

function bestCdnProduct(board: string): { code: string; id: string } | null {
  const boardNorm = normalizeBoard(board)
  let best: { code: string; id: string } | null = null
  let bestScore = 0
  for (const product of MIKROTIK_CDN_PRODUCTS) {
    const s = scoreMatch(boardNorm, product.code)
    if (s > bestScore) {
      bestScore = s
      best = product
    }
  }
  if (bestScore < 5) return null
  return best
}

function familyFallbackId(board: string): string | null {
  const raw = board.trim()
  for (const row of FAMILY_FALLBACKS) {
    if (row.match.test(raw)) return row.id
  }
  // Also try normalized form without dashes
  const norm = normalizeBoard(board)
  for (const row of FAMILY_FALLBACKS) {
    if (row.match.test(norm)) return row.id
  }
  return null
}

function cdnUrl(id: string) {
  return `${MIKROTIK_CDN_BASE}/${id}_lg.webp`
}

export function mikrotikBoardImageUrl(
  boardName?: string | null,
): string | null {
  if (!boardName?.trim()) return null

  const solustic = bestFile(boardName, SOLUSTIC_FILES)
  if (solustic) {
    return `${SOLUSTIC_BASE}/${encodeURIComponent(solustic)}`
  }

  const dude = bestFile(boardName, DUDE_FILES)
  if (dude) {
    return `${DUDE_BASE}/${encodeURIComponent(dude)}`
  }

  const cdn = bestCdnProduct(boardName)
  if (cdn) return cdnUrl(cdn.id)

  const family = familyFallbackId(boardName)
  if (family) return cdnUrl(family)

  return null
}

/** Local placeholder when the board is unknown (switches vs routers). */
export function mikrotikFallbackImageUrl(kind: 'router' | 'switch' = 'router') {
  return kind === 'switch' ? '/mikrotik-switch.svg' : '/mikrotik-generic.svg'
}
