/**
 * Map MikroTik board-name → product image.
 * Primary catalog: https://github.com/solustic/stencils (SVG stencils)
 * CDN: jsDelivr
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

function normalizeBoard(board: string) {
  return board
    .toLowerCase()
    .replace(/^mikrotik[_\s-]*/i, '')
    .replace(/[^a-z0-9+]/g, '')
}

function scoreMatch(boardNorm: string, fileLabel: string): number {
  const fileNorm = normalizeBoard(fileLabel)
  if (!boardNorm || !fileNorm) return 0
  if (boardNorm === fileNorm) return 1000
  if (fileNorm.includes(boardNorm) || boardNorm.includes(fileNorm)) {
    return Math.min(boardNorm.length, fileNorm.length)
  }
  // Token overlap (RB3011, UiAS, RM…)
  const boardTokens = boardNorm.match(/[a-z]+\d+[a-z0-9]*|[a-z]{2,}/g) ?? []
  let score = 0
  for (const t of boardTokens) {
    if (t.length >= 3 && fileNorm.includes(t)) score += t.length
  }
  return score
}

function bestFile(
  board: string,
  files: readonly string[],
): string | null {
  const boardNorm = normalizeBoard(board)
  let best: string | null = null
  let bestScore = 0
  for (const file of files) {
    const label = file.replace(/\.(svg|png|jpg)$/i, '')
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

  return null
}
