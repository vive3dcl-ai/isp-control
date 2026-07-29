export type HuaweiUplinkRaw = {
  ifName: string;
  description: string | null;
  mediaType: 'fiber' | 'copper' | 'unknown';
  adminEnabled: boolean;
  status: string;
  negotiation: string | null;
  mtu: number | null;
  wavelengthNm: number | null;
  signalDbm: number | null;
  tempC: number | null;
  pvidUntag: number | null;
  mode: string | null;
  taggedVlans: number[];
};

export function parseHuaweiUplinks(text: string): HuaweiUplinkRaw[] {
  const names = new Set<string>();
  for (const match of text.matchAll(
    /\b((?:eth-trunk|gigabitethernet|xgigabitethernet|ethernet)\s*\d+\/\d+\/\d+|\b(?:GE|XGE)\d+\/\d+\/\d+)\b/gi,
  )) {
    names.add(match[1].replace(/\s+/g, ''));
  }
  return [...names].map((ifName) => {
    const escaped = ifName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const start = text.search(
      new RegExp(`(?:interface\\s+)?${escaped}\\b`, 'i'),
    );
    const block =
      start >= 0
        ? text.slice(
            start,
            text.indexOf('\n#', start) >= 0
              ? text.indexOf('\n#', start)
              : undefined,
          )
        : '';
    const tags = [
      ...block.matchAll(/(?:port\s+)?vlan\s+(\d+(?:\s+to\s+\d+)?)/gi),
    ].flatMap((m) => expandVlans(m[1]));
    const description =
      block
        .match(/(?:description|port\s+description)\s+(.+)$/im)?.[1]
        ?.trim() ?? null;
    const enabled =
      !/\bshutdown\b/i.test(block) || /\bundo\s+shutdown\b/i.test(block);
    return {
      ifName,
      description,
      mediaType: /x?gigabit|xge/i.test(ifName) ? 'fiber' : 'unknown',
      adminEnabled: enabled,
      status: /current\s+state\s*:\s*up|line\s+protocol.*up/i.test(block)
        ? 'Up'
        : enabled
          ? 'Down'
          : 'Down',
      negotiation: null,
      mtu: Number(block.match(/\bjumboframe\s+(\d+)/i)?.[1]) || null,
      wavelengthNm:
        Number(block.match(/wavelength\s*[:=]\s*(\d+)/i)?.[1]) || null,
      signalDbm: nullableNumber(
        block.match(/(?:rx|receive)\s+power\s*[:=]\s*(-?[\d.]+)/i)?.[1],
      ),
      tempC: nullableNumber(
        block.match(/temperature\s*[:=]\s*(-?[\d.]+)/i)?.[1],
      ),
      pvidUntag: Number(block.match(/pvid\s+vlan\s+(\d+)/i)?.[1]) || null,
      mode: block.match(/port\s+link-type\s+(\S+)/i)?.[1] ?? null,
      taggedVlans: [...new Set(tags)].sort((a, b) => a - b),
    };
  });
}

function expandVlans(value: string): number[] {
  const m = value.match(/^(\d+)(?:\s+to\s+(\d+))?$/);
  if (!m) return [];
  const start = Number(m[1]);
  const end = Number(m[2] || m[1]);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
function nullableNumber(value?: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
